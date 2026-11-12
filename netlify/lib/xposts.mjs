// X-commentaren: posts en reposts die de redactie zelf toevoegt. De tekst wordt bewaard,
// zodat een bericht leesbaar blijft als het insluiten van X ooit niet meer werkt.
import { db, schoon, schoonUrl, nieuwId } from "./flitsen.mjs";

export const EIGEN_ACCOUNT = "hetalternatieve";
export const SOORTEN = ["eigen", "repost", "quote"];
const decode = s => String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&mdash;/g, "—").trim();

export function postId(url) { const m = /(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i.exec(url || ""); return m ? { handle: m[1], id: m[2] } : null; }

export async function haalPost(url) {
  const p = postId(url);
  if (!p) throw new Error("Dit is geen geldige link naar een post op X.");
  const basis = { url: `https://x.com/${p.handle}/status/${p.id}`, postId: p.id, handle: p.handle, auteur: p.handle, tekst: "", datum: "" };
  try {
    const r = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(basis.url)}&omit_script=1&dnt=true&lang=nl`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const p1 = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(j.html || "");
    const links = [...(j.html || "").matchAll(/<a[^>]*>([^<]*)<\/a>/gi)];
    basis.tekst = decode(p1?.[1]).replace(/\s*pic\.(twitter|x)\.com\/\S+/gi, "").trim();
    basis.datum = decode(links.at(-1)?.[1] || "");
    basis.auteur = j.author_name || p.handle;
    basis.handle = (j.author_url || "").split("/").pop() || p.handle;
    basis.opgehaald = true;
  } catch (e) { basis.opgehaald = false; basis.melding = "De tekst kon niet automatisch worden opgehaald. Vul hem zelf in."; }
  basis.soort = basis.handle.toLowerCase() === EIGEN_ACCOUNT ? "eigen" : "repost";
  return basis;
}

export async function leesPosts() { return (await db().get("xposts", { type: "json" })) || []; }
export async function bewaarPost(b) {
  const p = postId(b.url);
  if (!p) throw new Error("Ongeldige link.");
  const lijst = await leesPosts();
  const item = lijst.find(x => x.postId === p.id) || { id: nieuwId(), toegevoegd: new Date().toISOString() };
  Object.assign(item, {
    url: `https://x.com/${p.handle}/status/${p.id}`, postId: p.id,
    soort: SOORTEN.includes(b.soort) ? b.soort : "eigen",
    auteur: schoon(b.auteur, 80) || p.handle, handle: schoon(b.handle, 40) || p.handle,
    tekst: schoon(b.tekst, 1200), commentaar: schoon(b.commentaar, 1200), datum: schoon(b.datum, 40),
    sectie: schoon(b.sectie, 40), bijgewerkt: new Date().toISOString()
  });
  if (!lijst.includes(item)) lijst.unshift(item);
  await db().setJSON("xposts", lijst.slice(0, 300));
  return item;
}
export async function verwijderPost(id) { await db().setJSON("xposts", (await leesPosts()).filter(x => x.id !== id)); }
