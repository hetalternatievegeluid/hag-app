// Artikelen in Netlify Blobs: volledig archief, een lichte index (zonder tekst) en de tekst per artikel.
import { getStore, getDeployStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

export const artikelStore = (productie = true) => productie
  ? getStore({ name: "artikelen", consistency: "strong" })
  : getDeployStore({ name: "artikelen", consistency: "strong" });

export const maakIndex = data => ({
  ...data,
  articles: (data.articles || []).map(({ html, ...rest }) => ({ ...rest, heeftTekst: !!(html && html.length > 40) }))
});

export async function leesIndex(store = artikelStore()) {
  const idx = await store.get("index", { type: "json" });
  if (idx) return idx;
  const vol = await store.get("actueel", { type: "json" });
  return vol ? maakIndex(vol) : null;
}

export async function bewaarArtikelen(store, data) {
  const bestaand = await store.get("index", { type: "json" });
  const metTekst = data.articles.filter(a => a.html && a.html.length > 40).length;
  const hadTekst = bestaand ? bestaand.articles.filter(a => a.heeftTekst).length : 0;
  if (hadTekst && metTekst < hadTekst * 0.5) throw new Error(`Upload geweigerd: ${metTekst} artikelen met tekst, eerder ${hadTekst}.`);

  const hashes = (await store.get("hashes", { type: "json" })) || {};
  const teSchrijven = data.articles.filter(a => {
    if (!a.html) return false;
    const h = createHash("sha1").update(a.html).digest("hex");
    if (hashes[a.id] === h) return false;
    hashes[a.id] = h; return true;
  });
  for (let i = 0; i < teSchrijven.length; i += 20) {
    await Promise.all(teSchrijven.slice(i, i + 20).map(a => store.setJSON(`html/${a.id}`, { html: a.html })));
  }
  await store.setJSON("actueel", data);
  await store.setJSON("index", maakIndex(data));
  await store.setJSON("hashes", hashes);
  return { aantal: data.articles.length, nieuweTeksten: teSchrijven.length };
}

export async function leesTekst(store, id) {
  const los = await store.get(`html/${id}`, { type: "json" });
  if (los) return los.html;
  const vol = await store.get("actueel", { type: "json" });
  return vol?.articles?.find(a => a.id === id)?.html || "";
}
