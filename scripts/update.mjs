// Werkt public/data/articles.json bij.
//   node scripts/update.mjs            → leest de Substack-feed en voegt nieuwe artikelen toe
//   node scripts/update.mjs --import   → leest daarnaast het volledige archief van de website in
// Draait automatisch elk uur via GitHub Actions (.github/workflows/update.yml).

import fs from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { XMLParser } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";

const SITE = "https://www.hetalternatievegeluid.nl";
const FEED = "https://hetalternatievegeluid.substack.com/feed";
const OUT = "public/data/articles.json";
const CATS = {
  "nieuws-artikelen": "nieuws",
  "onderzoeks-artikelen": "onderzoek",
  "analyse-artikelen": "analyse",
  "een-andere-kijk-artikelen": "anderekijk",
};
const MONTHS = { jan: 0, feb: 1, mrt: 2, maa: 2, apr: 3, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };

const quiet = new VirtualConsole(); // houdt CSS-foutmeldingen van jsdom uit het logboek
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, "0");
const iso = (y, mo, d, h = 9, mi = 0) => `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}`;

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "HAG-app-updater (+https://www.hetalternatievegeluid.nl)" } });
      if (r.ok) return await r.text();
      console.warn(`  HTTP ${r.status}: ${url}`);
      if (r.status === 404) return null;
    } catch (e) {
      console.warn(`  Fout bij ${url}: ${e.message}`);
    }
    await sleep(1500 * (i + 1));
  }
  return null;
}

// ---------- tekst-hulpjes ----------
function stripSuffix(t) { return (t || "").replace(/\s*\|\s*Het Alternatieve Geluid\s*$/i, "").replace(/\s*\/\s*(Nieuws|Onderzoeks?|Analyse|Een Andere Kijk)\s+Artikelen\s*$/i, "").trim(); }
function cleanTitle(raw) {
  return stripSuffix(raw)
    .replace(/^\s*(\([^)]*\)\s*)+/, "")            // "(Nieuws Artikel: 09/11/2026) " eraf
    .replace(/^[:\s\u2013\u2014-]+/, "")           // losse dubbele punt of streep aan het begin
    .trim();
}
function catFromText(t) {
  const s = (t || "").toLowerCase();
  if (s.includes("andere kijk")) return "anderekijk";
  if (s.includes("onderzoek")) return "onderzoek";
  if (s.includes("analyse")) return "analyse";
  return "nieuws";
}
const deelFrom = t => { const m = /deel\s+(\d+)/i.exec(t || ""); return m ? +m[1] : undefined; };
function parseNlDate(text) {
  const m = /(\d{1,2})\s+(jan|feb|mrt|maa|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i.exec(text || "");
  return m ? iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] ?? 9), +(m[5] ?? 0)) : null;
}
function dateFromPrefix(t) {
  const m = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(t || "");
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return iso(y, +m[2] - 1, +m[1]);
}
function toAmsterdam(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const textOf = html => new JSDOM(`<body>${html}</body>`, { virtualConsole: quiet }).window.document.body.textContent.replace(/\s+/g, " ").trim();

function clean(html) {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "a", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "figure", "figcaption", "img", "hr", "sup", "sub"],
    allowedAttributes: { a: ["href"], img: ["src", "alt", "width", "height"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      h1: "h2",
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener" } }),
    },
    exclusiveFilter: f => ["p", "h2", "h3", "h4", "figure"].includes(f.tag) && !f.text.trim() && !(f.mediaChildren && f.mediaChildren.length),
  });
}
function firstParagraph(html) {
  const doc = new JSDOM(`<body>${html}</body>`, { virtualConsole: quiet }).window.document;
  for (const p of doc.querySelectorAll("p")) {
    const t = p.textContent.replace(/\s+/g, " ").trim();
    if (t.length > 60) return t;
  }
  return "";
}

// ---------- archief van de website ----------
async function crawlSite() {
  const found = new Map();
  for (const [path, cat] of Object.entries(CATS)) {
    const start = `${SITE}/${path}`;
    const queue = [start];
    const seen = new Set();
    const articleRe = new RegExp(`/${path}/(\\d+)_`);
    while (queue.length && seen.size < 60) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      const html = await get(url);
      if (!html) continue;
      const doc = new JSDOM(html, { url, virtualConsole: quiet }).window.document;
      for (const a of doc.querySelectorAll("a[href]")) {
        const href = a.href.split("#")[0];
        if (!href.startsWith(start)) continue;
        if (articleRe.test(href)) { if (!found.has(href)) found.set(href, cat); }
        else if (href !== start && !seen.has(href)) queue.push(href); // paginering
      }
      await sleep(400);
    }
    console.log(`  ${path}: ${[...found.values()].filter(c => c === cat).length} artikelen, ${seen.size} overzichtspagina's`);
  }

  // Aanvulling via de sitemap, als die er is
  const sitemaps = [`${SITE}/sitemap.xml`];
  for (let i = 0; i < sitemaps.length && i < 10; i++) {
    const xml = await get(sitemaps[i]);
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = m[1];
      if (/\.xml($|\?)/.test(u)) { sitemaps.push(u); continue; }
      for (const [path, cat] of Object.entries(CATS)) {
        if (new RegExp(`/${path}/\\d+_`).test(u) && !found.has(u)) found.set(u, cat);
      }
    }
  }
  console.log(`Archief: ${found.size} artikelen gevonden, nu inlezen...`);

  const out = [];
  for (const [url, cat] of found) {
    const art = await fetchSiteArticle(url, cat);
    if (art) out.push(art);
    await sleep(400);
  }
  return out;
}

async function fetchSiteArticle(url, cat) {
  const html = await get(url);
  if (!html) return null;
  const doc = new JSDOM(html, { url, virtualConsole: quiet }).window.document;
  const rawTitle = stripSuffix(doc.querySelector('meta[property="og:title"]')?.content || doc.title);
  const image = doc.querySelector('meta[property="og:image"]')?.content || "";
  const id = (/\/(\d+)_/.exec(url) || [])[1];
  const date = parseNlDate(doc.body?.textContent) || dateFromPrefix(rawTitle) || dateFromPrefix(url.replace(/-/g, "/"));

  const parsed = new Readability(new JSDOM(html, { url, virtualConsole: quiet }).window.document).parse();
  let body = parsed?.content || "";
  // titel bovenin de tekst weghalen (staat al in de app)
  const bdoc = new JSDOM(`<body>${body}</body>`, { virtualConsole: quiet }).window.document;
  for (const h of bdoc.querySelectorAll("h1, h2")) {
    if (norm(h.textContent) && norm(rawTitle).includes(norm(h.textContent))) { h.remove(); break; }
  }
  for (const el of bdoc.querySelectorAll("a")) if (/lees meer|ga direct naar/i.test(el.textContent)) el.remove();
  body = clean(bdoc.body.innerHTML);

  let title = cleanTitle(rawTitle);
  if (!title || /^(nieuws|onderzoeks|analyse)?\s*artikel/i.test(title)) title = "";
  const art = {
    id, cat, deel: cat === "anderekijk" ? deelFrom(rawTitle) : undefined,
    title, date, intro: firstParagraph(body), html: body, image, url, source: "site",
  };
  if (!date) console.warn(`  Geen datum gevonden: ${url}`);
  if (!title) console.warn(`  Geen bruikbare titel, vul hem in config/overrides.json in (ID ${id}): ${rawTitle}`);
  return art;
}

// ---------- Substack ----------
async function fetchSubstack() {
  const xml = await get(FEED);
  if (!xml) { console.warn("Substack-feed niet bereikbaar, bestaande artikelen blijven staan."); return []; }
  const parser = new XMLParser({ ignoreAttributes: false });
  const items = [].concat(parser.parse(xml)?.rss?.channel?.item || []);
  return items.map(it => {
    const raw = String(it.title ?? "");
    const html = clean(String(it["content:encoded"] ?? it.description ?? ""));
    const slug = (/\/p\/([^/?#]+)/.exec(it.link || "") || [])[1] || norm(raw).replace(/ /g, "-");
    return {
      id: "s-" + slug,
      cat: catFromText(raw),
      deel: catFromText(raw) === "anderekijk" ? deelFrom(raw) : undefined,
      title: cleanTitle(raw) || raw,
      date: it.pubDate ? toAmsterdam(new Date(it.pubDate)) : null,
      intro: textOf(String(it.description ?? "")) || firstParagraph(html),
      html, image: it.enclosure?.["@_url"] || "", url: it.link, source: "substack",
    };
  });
}

// ---------- samenvoegen ----------
function sameArticle(a, b) {
  if (norm(a.title) && norm(a.title) === norm(b.title)) return true;
  return a.date?.slice(0, 10) === b.date?.slice(0, 10) && norm(a.title).slice(0, 30) === norm(b.title).slice(0, 30) && norm(a.title).length > 10;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function main() {
  const current = await readJson(OUT, { articles: [] });
  const overrides = await readJson("config/overrides.json", {});
  const dossierCfg = await readJson("config/dossiers.json", { dossiers: [] });
  let articles = current.articles || [];
  const doImport = process.argv.includes("--import") || !articles.some(a => a.html);

  if (doImport) {
    console.log("Archief van de website inlezen...");
    const site = await crawlSite();
    if (site.length) {
      const byId = new Map(articles.map(a => [a.id, a]));
      for (const s of site) {
        const old = byId.get(s.id);
        byId.set(s.id, old ? { ...old, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== "" && v != null)) } : s);
      }
      articles = [...byId.values()];
    } else {
      console.warn("Geen artikelen van de website gevonden; bestaande gegevens blijven staan.");
    }
  }

  console.log("Substack-feed lezen...");
  let added = 0;
  for (const s of await fetchSubstack()) {
    const match = articles.find(a => a.id === s.id || sameArticle(a, s));
    if (match) {
      if (!match.html && s.html) match.html = s.html;
      if (!match.image && s.image) match.image = s.image;
      match.substackUrl = s.url;
    } else {
      articles.push(s);
      added++;
    }
  }
  console.log(`  ${added} nieuwe artikelen via Substack.`);

  // handmatige correcties
  for (const a of articles) if (overrides[a.id]) Object.assign(a, overrides[a.id]);

  // dossiers
  const dossiers = (dossierCfg.dossiers || []).map(({ id, name }) => ({ id, name }));
  for (const a of articles) {
    const hay = ` ${a.title} ${a.intro} `.toLowerCase();
    a.dossiers = (dossierCfg.dossiers || []).filter(d =>
      (d.altijd || []).includes(a.id) ||
      (!(d.nooit || []).includes(a.id) && (d.trefwoorden || []).some(w => hay.includes(w.toLowerCase())))
    ).map(d => d.id);
  }

  articles = articles.filter(a => a.title && a.date).sort((a, b) => b.date.localeCompare(a.date));
  const next = { dossiers, articles };
  const same = JSON.stringify({ dossiers: current.dossiers, articles: current.articles }) === JSON.stringify(next);
  if (same) { console.log("Geen wijzigingen."); return; }
  await fs.writeFile(OUT, JSON.stringify({ updated: toAmsterdam(new Date()), ...next }, null, 1));
  console.log(`Klaar: ${articles.length} artikelen opgeslagen.`);
}

main().catch(e => { console.error(e); process.exit(1); });
