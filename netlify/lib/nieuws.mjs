// Haalt de nieuwsfeeds op, deelt berichten in per sectie en slaat het resultaat op in Netlify Blobs.
import { XMLParser } from "fast-xml-parser";
import { getStore } from "@netlify/blobs";
import config from "../../config/nieuws.json";
import plaatsen from "../../config/plaatsen.json";

const BEWAAR_DAGEN = 7;
const MAX_BERICHTEN = 800;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

const store = () => getStore("nieuws");

function decode(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
const tekst = v => decode(typeof v === "object" && v !== null ? (v["#text"] ?? "") : v);
function kort(s, n = 240) { return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s; }
function link(it) {
  if (typeof it.link === "string") return it.link.trim();
  const l = [].concat(it.link || []);
  const alt = l.find(x => x?.["@_rel"] === "alternate") || l[0];
  return (alt?.["@_href"] || alt?.["#text"] || it.guid?.["#text"] || (typeof it.guid === "string" ? it.guid : "") || "").trim();
}
function datum(it) {
  const d = new Date(tekst(it.pubDate || it.published || it.updated || it["dc:date"] || ""));
  return isNaN(d) ? null : d.toISOString();
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sectieRegels = config.secties.map(s => ({
  id: s.id,
  re: new RegExp(`(^|[^\\p{L}])(${s.trefwoorden.map(escRe).join("|")})`, "iu"),
}));

// Plaats bepalen voor de wereldbol: de plaatsnaam die het eerst in de kop staat, anders in de samenvatting.
const plaatsRegels = (plaatsen.plaatsen || []).map(p => ({
  naam: p.naam, lat: p.lat, lon: p.lon,
  re: new RegExp(`(^|[^\\p{L}])(${p.namen.map(escRe).join("|")})(?![\\p{L}])`, "iu"),
}));
function vindPlaats(titel, samenvatting) {
  for (const tekst of [titel, samenvatting]) {
    let beste = null, pos = Infinity;
    for (const p of plaatsRegels) {
      const m = p.re.exec(tekst || "");
      if (m && m.index < pos) { pos = m.index; beste = p; }
    }
    if (beste) return { naam: beste.naam, lat: beste.lat, lon: beste.lon };
  }
  return null;
}
function beeld(it) {
  const kandidaten = [].concat(it["media:content"] || [], it["media:thumbnail"] || [], it["media:group"]?.["media:content"] || [], it.enclosure || []);
  for (const k of kandidaten) {
    const url = k?.["@_url"] || k?.["@_href"];
    const type = k?.["@_type"] || k?.["@_medium"] || "";
    if (url && /^https?:/.test(url) && (!type || /image/.test(type))) return url;
  }
  const html = String(it["content:encoded"] || it.description || it.content?.["#text"] || it.content || "");
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m && /^https?:/.test(m[1]) ? m[1] : "";
}

async function haalBron(bron) {
  const r = await fetch(bron.feed, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; HAG-nieuwsstroom/1.0; +https://www.hetalternatievegeluid.nl)", accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = parser.parse(await r.text());
  const items = [].concat(xml?.rss?.channel?.item || xml?.["rdf:RDF"]?.item || xml?.feed?.entry || []);
  if (!items.length) throw new Error("geen berichten in de feed");
  return items.map(it => {
    const titel = tekst(it.title);
    const samenvatting = kort(tekst(it.description || it.summary || ""));
    const tijd = datum(it);
    const url = link(it);
    const hooi = ` ${titel} ${samenvatting} `;
    const secties = new Set(sectieRegels.filter(s => s.re.test(hooi)).map(s => s.id));
    if (bron.sectie) secties.add(bron.sectie);
    return { id: url, bron: bron.naam, bronId: bron.id, label: bron.label, staat: !!bron.staat, titel, samenvatting, url, tijd, secties: [...secties], plaats: vindPlaats(titel, samenvatting), beeld: beeld(it) };
  }).filter(b => b.titel && b.url && b.tijd);
}

export async function verversNieuws() {
  const bronnen = config.bronnen.filter(b => b.aan !== false);
  const resultaten = await Promise.allSettled(bronnen.map(haalBron));
  const oud = (await store().get("stroom", { type: "json" })) || { berichten: [] };
  const perUrl = new Map(oud.berichten.map(b => [b.url, b]));
  const status = {};
  resultaten.forEach((r, i) => {
    const b = bronnen[i];
    if (r.status === "fulfilled") {
      status[b.id] = { naam: b.naam, ok: true, aantal: r.value.length };
      for (const m of r.value) perUrl.set(m.url, m);
    } else {
      status[b.id] = { naam: b.naam, ok: false, fout: String(r.reason?.message || r.reason) };
    }
  });
  const grens = Date.now() - BEWAAR_DAGEN * 864e5;
  const berichten = [...perUrl.values()]
    .filter(b => b.secties.length && new Date(b.tijd).getTime() > grens && new Date(b.tijd).getTime() < Date.now() + 36e5)
    .sort((a, b) => b.tijd.localeCompare(a.tijd))
    .slice(0, MAX_BERICHTEN);
  const data = { bijgewerkt: new Date().toISOString(), secties: config.secties.map(({ id, naam }) => ({ id, naam })), berichten, status };
  await store().setJSON("stroom", data);
  return data;
}

export async function leesNieuws() {
  return store().get("stroom", { type: "json" });
}
