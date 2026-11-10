
import { getStore, getDeployStore } from "@netlify/blobs";
import crypto from "node:crypto";

const env = (name) =>
  globalThis.Netlify?.env?.get?.(name) ??
  process.env[name] ??
  "";

const isProduction = () => env("CONTEXT") === "production";

function store() {
  return isProduction()
    ? getStore({ name: "artikelen", consistency: "strong" })
    : getDeployStore({ name: "artikelen", consistency: "strong" });
}

function authorized(req) {
  const secret = env("ARTIKELEN_SYNC_TOKEN");
  const supplied = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "");

  if (!secret || !supplied) return false;

  const a = crypto.createHash("sha256").update(secret).digest();
  const b = crypto.createHash("sha256").update(supplied).digest();

  return crypto.timingSafeEqual(a, b);
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      let data = await store().get("actueel", { type: "json" });

      if (!data) {
        const siteUrl =
  env("DEPLOY_PRIME_URL") ||
  env("DEPLOY_URL") ||
  env("URL");

if (!siteUrl) {
  throw new Error("Geen Netlify-site-URL beschikbaar");
}

const url = new URL("/data/articles.json", siteUrl);
        const response = await fetch(url);
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
      if (!isProduction()) {
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

      const data = await req.json();

      if (!data || !Array.isArray(data.articles)) {
        return Response.json(
          { fout: "Ongeldige artikelgegevens" },
          { status: 400 }
        );
      }

      await store().setJSON("actueel", data);

      return Response.json({
        ok: true,
        aantal: data.articles.length
      });
    }

    return Response.json(
      { fout: "Methode niet toegestaan" },
      { status: 405 }
    );
  } catch (error) {
    console.error("Artikel-API:", error);
    return Response.json(
      { fout: "Interne fout" },
      { status: 500 }
    );
  }
};

export const config = { path: "/api/artikelen" };
