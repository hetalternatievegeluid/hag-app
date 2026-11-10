
import { getStore, getDeployStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

const env = (name) =>
  globalThis.Netlify?.env?.get?.(name) ??
  process.env[name] ?? "";

function authorized(req) {
  const secret = env("ARTIKELEN_SYNC_TOKEN");
  const supplied = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "");

  if (!secret || !supplied) return false;

  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

export default async (req, context) => {
  const production = context?.deploy?.context === "production";

  const store = production
    ? getStore({ name: "artikelen", consistency: "strong" })
    : getDeployStore({ name: "artikelen", consistency: "strong" });

  try {
    if (req.method === "GET") {
      let data = await store.get("actueel", { type: "json" });

      if (!data) {
        const siteUrl =
          env("DEPLOY_PRIME_URL") ||
          env("DEPLOY_URL") ||
          env("URL");

        if (!siteUrl) throw new Error("Site-URL ontbreekt");

        const response = await fetch(
          new URL("/data/articles.json", siteUrl)
        );

        if (!response.ok) {
          return Response.json(
            { fout: "Artikelen niet beschikbaar" },
            { status: 503 }
          );
        }

        data = await response.json();
      }

      return Response.json(data, {
        headers: { "cache-control": "no-store" }
      });
    }

    if (req.method === "POST") {
      if (!production) {
        return Response.json(
          { fout: "Schrijven alleen toegestaan in productie" },
          { status: 403 }
        );
      }

      if (!authorized(req)) {
        return Response.json(
          { fout: "Niet bevoegd" },
          { status: 401 }
        );
      }

      const payload = await req.json();

      if (
        payload.encoding !== "gzip-base64" ||
        typeof payload.data !== "string"
      ) {
        return Response.json(
          { fout: "Ongeldig uploadformaat" },
          { status: 400 }
        );
      }

      const compressed = Buffer.from(payload.data, "base64");
      const raw = gunzipSync(compressed, {
        maxOutputLength: 25 * 1024 * 1024
      });

      const data = JSON.parse(raw.toString("utf8"));

      if (
        !Array.isArray(data.articles) ||
        data.articles.length === 0 ||
        !Array.isArray(data.dossiers) ||
        typeof data.updated !== "string"
      ) {
        return Response.json(
          { fout: "Ongeldige artikelgegevens" },
          { status: 400 }
        );
      }

      await store.setJSON("actueel", data);

      return Response.json({
        ok: true,
        aantal: data.articles.length,
        bijgewerkt: data.updated
      });
    }

    return Response.json(
      { fout: "Methode niet toegestaan" },
      { status: 405 }
    );

  } catch (error) {
    console.error("Artikel-API:", error);
    return Response.json(
      { fout: "Verwerking mislukt" },
      { status: 500 }
    );
  }
};

export const config = { path: "/api/artikelen" };
