// /api/artikelen          → lichte index van alle artikelen (zonder tekst), kort gecachet
// /api/artikelen?id=123   → de tekst van één artikel
// /api/artikelen?volledig=1 → volledig archief (gebruikt door de synchronisatie op GitHub)
// POST (met ARTIKELEN_SYNC_TOKEN) → nieuw archief opslaan
import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { artikelStore, leesIndex, bewaarArtikelen, leesTekst, maakIndex } from "../lib/artikelen.mjs";

const env = n => globalThis.Netlify?.env?.get?.(n) ?? process.env[n] ?? "";
function bevoegd(req) {
  const geheim = env("ARTIKELEN_SYNC_TOKEN");
  const gegeven = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!geheim || !gegeven) return false;
  return timingSafeEqual(createHash("sha256").update(geheim).digest(), createHash("sha256").update(gegeven).digest());
}
const cdn = seconden => ({ "cache-control": "public, max-age=60", "netlify-cdn-cache-control": `public, s-maxage=${seconden}, stale-while-revalidate=600` });

async function statischBestand() {
  const site = env("URL") || env("DEPLOY_PRIME_URL") || env("DEPLOY_URL");
  const r = await fetch(new URL("/data/articles.json", site));
  return r.ok ? r.json() : null;
}

export default async (req, context) => {
  const productie = context?.deploy?.context === "production";
  const store = artikelStore(productie);
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        if (!/^[\w-]{1,80}$/.test(id)) return Response.json({ fout: "Ongeldig ID" }, { status: 400 });
        let html = await leesTekst(store, id);
        if (!html) html = (await statischBestand())?.articles?.find(a => a.id === id)?.html || "";
        return Response.json({ id, html }, { headers: cdn(3600) });
      }
      if (url.searchParams.has("volledig")) {
        const vol = (await store.get("actueel", { type: "json" })) || (await statischBestand());
        if (!vol) return Response.json({ fout: "Artikelen niet beschikbaar" }, { status: 503 });
        return Response.json(vol, { headers: { "cache-control": "no-store" } });
      }
      let idx = await leesIndex(store);
      if (!idx) { const s = await statischBestand(); idx = s ? maakIndex(s) : null; }
      if (!idx) return Response.json({ fout: "Artikelen niet beschikbaar" }, { status: 503 });
      return Response.json(idx, { headers: cdn(300) });
    }

    if (req.method === "POST") {
      if (!productie) return Response.json({ fout: "Schrijven alleen toegestaan in productie" }, { status: 403 });
      if (!bevoegd(req)) return Response.json({ fout: "Niet bevoegd" }, { status: 401 });
      const p = await req.json();
      if (p.encoding !== "gzip-base64" || typeof p.data !== "string") return Response.json({ fout: "Ongeldig uploadformaat" }, { status: 400 });
      const data = JSON.parse(gunzipSync(Buffer.from(p.data, "base64"), { maxOutputLength: 25 * 1024 * 1024 }).toString("utf8"));
      if (!Array.isArray(data.articles) || !data.articles.length || !Array.isArray(data.dossiers) || typeof data.updated !== "string")
        return Response.json({ fout: "Ongeldige artikelgegevens" }, { status: 400 });
      try { return Response.json({ ok: true, ...(await bewaarArtikelen(store, data)), bijgewerkt: data.updated }); }
      catch (e) { return Response.json({ fout: e.message }, { status: 400 }); }
    }
    return Response.json({ fout: "Methode niet toegestaan" }, { status: 405 });
  } catch (e) {
    console.error("Artikel-API:", e);
    return Response.json({ fout: "Verwerking mislukt" }, { status: 500 });
  }
};
export const config = { path: "/api/artikelen" };
