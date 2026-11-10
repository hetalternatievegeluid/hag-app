// Koersen van grote techbedrijven via Yahoo Finance (indicatief, enigszins vertraagd), met bijbehorend nieuws.
import { getStore } from "@netlify/blobs";
import config from "../../config/beurs.json";

const store = () => getStore({ name: "beurs", consistency: "strong" });
const UA = { "user-agent": "Mozilla/5.0 (compatible; HAG-beurs/1.0; +https://www.hetalternatievegeluid.nl)" };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const zoekRe = woorden => new RegExp(`(^|[^\\p{L}])(${woorden.map(w => w.endsWith("=") ? escRe(w.slice(0, -1)) + "(?![\\p{L}])" : escRe(w)).join("|")})`, "iu");
const ALLE = [...config.aandelen.map(a => ({ ...a, soort: "aandeel" })), ...config.indexen.map(i => ({ ...i, soort: "index", zoek: [] }))];

async function haal(symbool) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbool)}?range=1y&interval=1d`, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const res = (await r.json())?.chart?.result?.[0];
  if (!res?.timestamp) throw new Error("geen gegevens");
  const slot = res.indicators?.quote?.[0]?.close || [];
  const punten = res.timestamp.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), slot[i]]).filter(([, v]) => Number.isFinite(v)).map(([d, v]) => [d, Math.round(v * 100) / 100]);
  const m = res.meta || {};
  const koers = Number.isFinite(m.regularMarketPrice) ? m.regularMarketPrice : punten.at(-1)?.[1];
  const vorige = punten.length > 1 && punten.at(-1)[0] === new Date((m.regularMarketTime || 0) * 1000).toISOString().slice(0, 10) ? punten.at(-2)[1] : punten.at(-1)?.[1];
  return { valuta: m.currency || "", koers, vorige, tijd: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null, punten };
}

export async function verversBeurs() {
  const oud = (await store().get("koersen", { type: "json" })) || { items: {} };
  const res = await Promise.allSettled(ALLE.map(a => haal(a.symbool)));
  const items = { ...oud.items }, status = {};
  res.forEach((r, i) => {
    const a = ALLE[i];
    if (r.status === "fulfilled") { items[a.symbool] = r.value; status[a.symbool] = { ok: true }; }
    else status[a.symbool] = { ok: false, fout: String(r.reason?.message || r.reason) };
  });
  const data = { bijgewerkt: new Date().toISOString(), items, status };
  await store().setJSON("koersen", data);
  return data;
}
export async function leesBeurs() { return store().get("koersen", { type: "json" }); }

export async function archiveerTech(berichten) {
  const arch = (await store().get("archief", { type: "json" })) || [];
  const perUrl = new Map(arch.map(b => [b.url, b]));
  for (const b of berichten) if (b.secties?.includes("tech") && !perUrl.has(b.url)) perUrl.set(b.url, { titel: b.titel, url: b.url, bron: b.bron, label: b.label, staat: b.staat, tijd: b.tijd });
  const grens = Date.now() - 400 * 864e5;
  await store().setJSON("archief", [...perUrl.values()].filter(b => new Date(b.tijd).getTime() > grens).sort((a, b) => b.tijd.localeCompare(a.tijd)).slice(0, 6000));
}
export async function leesTechArchief() { return (await store().get("archief", { type: "json" })) || []; }

export function bouwOverzicht(data, archief) {
  const uit = [], bew = [];
  const grens30 = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  for (const a of ALLE) {
    const k = data.items[a.symbool]; if (!k) continue;
    const re = a.zoek.length ? zoekRe(a.zoek) : null;
    const nieuws = re ? archief.filter(n => re.test(" " + n.titel + " ")).slice(0, 8) : [];
    const p = k.punten;
    const verandering = dagen => { const ref = p[p.length - 1 - dagen]; return ref ? Math.round((k.koers - ref[1]) / ref[1] * 1000) / 10 : null; };
    uit.push({ symbool: a.symbool, naam: a.naam, soort: a.soort, valuta: k.valuta, koers: k.koers, tijd: k.tijd,
      pct: k.vorige ? Math.round((k.koers - k.vorige) / k.vorige * 1000) / 10 : null, maand: verandering(21), jaar: verandering(Math.min(p.length - 1, 250)),
      punten: p, nieuws });
    if (a.soort !== "aandeel") continue;
    for (let i = 1; i < p.length; i++) {
      if (p[i][0] < grens30) continue;
      const pct = (p[i][1] - p[i - 1][1]) / p[i - 1][1] * 100;
      if (Math.abs(pct) >= (config.drempel || 5)) {
        const t = new Date(p[i][0] + "T16:00:00Z").getTime();
        bew.push({ symbool: a.symbool, naam: a.naam, datum: p[i][0], pct: Math.round(pct * 10) / 10, van: p[i - 1][1], naar: p[i][1], valuta: k.valuta,
          nieuws: re ? archief.filter(n => re.test(" " + n.titel + " ") && Math.abs(new Date(n.tijd).getTime() - t) <= 40 * 36e5).slice(0, 5) : [] });
      }
    }
  }
  bew.sort((a, b) => b.datum.localeCompare(a.datum) || Math.abs(b.pct) - Math.abs(a.pct));
  return { bijgewerkt: data.bijgewerkt, aandelen: uit, bewegingen: bew.slice(0, 20) };
}
