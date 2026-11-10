// Haalt de nieuwsfeeds op, deelt berichten in per sectie en slaat het resultaat op in Netlify Blobs.
import { XMLParser } from "fast-xml-parser";
import { getStore } from "@netlify/blobs";
import config from "../../config/nieuws.json";
import plaatsen from "../../config/plaatsen.json";
import { archiveerEnergie } from "./energie.mjs";

const BEWAAR_DAGEN = 7;
const MAX_BERICHTEN = 1500;
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
  re: new RegExp(`(^|[^\\p{L}])(${s.trefwoorden.map(w => w.endsWith("=") ? escRe(w.slice(0, -1)) + "(?![\\p{L}])" : escRe(w)).join("|")})`, "iu"),
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

// ---------- bronvergelijking: zelfde gebeurtenis, verschillende bronnen ----------
const STOP = new Set(("the and for with from that this says said after over amid will have been more than into about what their they were also news live latest update updates report reports video watch week today year years could would should first last told between against while where when which whose being under around before because still just like make made very most some other another again them then there here only even since such those these three many much among across upon according officials official government president minister leader leaders people country countries world state states says talks deal amid calls call new old says' " +
  "voor over door naar maar niet deze wordt worden heeft hebben zijn meer tegen onder ook nog als want omdat toen waar zegt zeggen eerste laatste nieuwe land landen").split(/\s+/));
const normT = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = t => new Set(normT(t).split(" ").filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => w.length > 5 && w.endsWith("s") ? w.slice(0, -1) : w));
export function vergelijk(berichten) {
  const grens = Date.now() - 48 * 36e5;
  const items = berichten.filter(b => new Date(b.tijd).getTime() > grens).map(b => ({ b, t: tokens(b.titel + " " + (b.samenvatting || "").slice(0, 160)) })).filter(x => x.t.size >= 3);
  const clusters = [];
  const kern = c => new Set([...c.freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w));
  for (const x of items) {
    let beste = null, score = 0;
    for (const c of clusters) {
      const k = c.kernCache || (c.kernCache = kern(c));
      let gedeeld = 0; for (const w of x.t) if (k.has(w)) gedeeld++;
      const zelfdePlek = x.b.plaats && c.plaatsen.has(x.b.plaats.naam);
      const sc = gedeeld / Math.min(x.t.size, k.size);
      if ((gedeeld >= 3 || (gedeeld >= 2 && zelfdePlek)) && sc >= (zelfdePlek ? 0.25 : 0.34) && sc > score) { score = sc; beste = c; }
    }
    if (!beste) { beste = { leden: [], freq: new Map(), plaatsen: new Set() }; clusters.push(beste); }
    beste.leden.push(x);
    for (const w of x.t) beste.freq.set(w, (beste.freq.get(w) || 0) + 1);
    if (x.b.plaats) beste.plaatsen.add(x.b.plaats.naam);
    beste.kernCache = null;
  }
  return clusters.map(c => {
    const perBron = new Map();
    for (const { b } of c.leden) { const o = perBron.get(b.bron); if (!o || b.tijd > o.tijd) perBron.set(b.bron, b); }
    const k = kern(c);
    const centraal = c.leden.slice().sort((a, b) => [...b.t].filter(w => k.has(w)).length - [...a.t].filter(w => k.has(w)).length)[0].b;
    const plekTelling = {}; c.leden.forEach(({ b }) => { if (b.plaats) plekTelling[b.plaats.naam] = (plekTelling[b.plaats.naam] || 0) + 1; });
    const plaats = Object.entries(plekTelling).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const berichten = [...perBron.values()].sort((a, b) => b.tijd.localeCompare(a.tijd)).map(b => ({ bron: b.bron, label: b.label, staat: b.staat, titel: b.titel, url: b.url, tijd: b.tijd }));
    return { id: centraal.url, kop: centraal.titel, plaats, laatst: berichten[0].tijd, secties: [...new Set(c.leden.flatMap(({ b }) => b.secties))], berichten };
  }).filter(c => c.berichten.length >= 3)
    .sort((a, b) => (b.berichten.length - a.berichten.length) || b.laatst.localeCompare(a.laatst))
    .slice(0, 15);
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
    .filter(b => (b.secties.length || b.plaats) && new Date(b.tijd).getTime() > grens && new Date(b.tijd).getTime() < Date.now() + 36e5)
    .sort((a, b) => b.tijd.localeCompare(a.tijd))
    .slice(0, MAX_BERICHTEN);
  const data = { bijgewerkt: new Date().toISOString(), secties: config.secties.map(({ id, naam }) => ({ id, naam })), berichten, status, vergelijking: vergelijk(berichten) };
  await store().setJSON("stroom", data);
  try { await archiveerEnergie(berichten); } catch (e) { console.warn("Energie-archief: " + e.message); }
  return data;
}

export async function leesNieuws() {
  return store().get("stroom", { type: "json" });
}
