
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const SITE = "https://app.hetalternatievegeluid.nl";
const FILE = "public/data/articles.json";

async function download(url) {
  const res = await fetch(url, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    throw new Error(`Download mislukt: ${res.status}`);
  }

  const data = await res.json();

  if (!Array.isArray(data.articles) || !data.articles.length) {
    throw new Error("Artikelarchief ontbreekt of is leeg");
  }

  return data;
}

function inhoud(data) {
  return JSON.stringify({
    dossiers: data.dossiers || [],
    articles: data.articles || []
  });
}

async function main() {
  console.log("Bestaand artikelarchief ophalen...");

  // Gebruik altijd de gepubliceerde gegevens als uitgangspunt.
  const bestaand = await download(
    `${SITE}/api/artikelen`
  ).catch(() => download(`${SITE}/data/articles.json`));

  // Voorkomt verlies van artikelen die niet in GitHub staan.
  await fs.writeFile(FILE, JSON.stringify(bestaand));

  console.log("Nieuwe artikelen controleren...");

  execFileSync(
    process.execPath,
    ["scripts/update.mjs"],
    { stdio: "inherit" }
  );

  const bijgewerkt = JSON.parse(
    await fs.readFile(FILE, "utf8")
  );

  if (bijgewerkt.articles.length < bestaand.articles.length) {
    throw new Error("Synchronisatie afgebroken: artikelen ontbreken");
  }

  if (
  inhoud(bestaand) === inhoud(bijgewerkt) &&
  process.env.SYNC_FORCE_SEED !== "true"
) {
  console.log("Geen wijzigingen. Geen upload nodig.");
  return;
}

  console.log("Wijzigingen gevonden.");

  // Zonder expliciete toestemming alleen controleren.
  if (process.env.SYNC_PUBLISH !== "true") {
    console.log("Testmodus: geen gegevens verstuurd.");
    return;
  }

  const token = process.env.ARTIKELEN_SYNC_TOKEN;
  if (!token) {
    throw new Error("ARTIKELEN_SYNC_TOKEN ontbreekt");
  }

  const compressed = gzipSync(
    Buffer.from(JSON.stringify(bijgewerkt))
  );

  const response = await fetch(`${SITE}/api/artikelen`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      encoding: "gzip-base64",
      data: compressed.toString("base64")
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(
      `Upload mislukt: ${response.status} ${await response.text()}`
    );
  }

  console.log("Synchronisatie geslaagd:", await response.json());
}

main().catch(error => {
  console.error("Synchronisatie mislukt:", error.message);
  process.exitCode = 1;
});
