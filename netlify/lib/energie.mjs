// Energieprijzen ophalen uit officiële en indicatieve bronnen, opslaan en bewegingen bepalen.
import { getStore } from "@netlify/blobs";
import config from "../../config/energie.json";

const store = () => getStore({ name: "energie", consistency: "strong" });
const env = n => globalThis.Netlify?.env?.get?.(n) ?? process.env[n] ?? "";
const UA = { "user-agent": "Mozilla/5.0 (compatible; HAG-energie/1.0; +https://www.hetalternatievegeluid.nl)" };
const JAREN = 2;
const vanaf = () => { const d = new Date(); d.setFullYear(d.getFullYear() - JAREN); return d.toISOString().slice(0, 10); };
const getJson = async (url, opt = {}) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000), ...opt }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const getText = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const schoonReeks = punten => {
  const m = new Map();
  for (const [d, v] of punten) if (d && Number.isFinite(v) && v > 0) m.set(d, Math.round(v * 1000) / 1000);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).filter(([d]) => d >= vanaf());
};

// ---------- bronnen ----------
async function eia(route, serie, frequentie) {
  const key = env("EIA_API_KEY");
  if (!key) throw new Error("EIA_API_KEY ontbreekt in Netlify");
  const url = `https://api.eia.gov/v2/${route}/data/?api_key=${encodeURIComponent(key)}&frequency=${frequentie}&data[0]=value&facets[series][]=${serie}&start=${vanaf()}&sort[0][column]=period&sort[0][direction]=asc&length=5000`;
  const j = await getJson(url);
  const rijen = j?.response?.data || [];
  if (!rijen.length) throw new Error("geen gegevens");
  return schoonReeks(rijen.map(r => [String(r.period).slice(0, 10), Number(r.value)]));
}
async function yahoo(symbool) {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbool)}?range=${JAREN}y&interval=1d`);
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error("geen gegevens");
  const slot = r.indicators?.quote?.[0]?.close || [];
  return schoonReeks(r.timestamp.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), slot[i]]));
}
async function cbs() {
  const props = await getJson("https://opendata.cbs.nl/ODataApi/odata/80416ned/DataProperties");
  const sleutel = woord => props.value.find(p => p.Type === "Topic" && new RegExp(woord, "i").test(p.Title))?.Key;
  const kE = sleutel("Euro95"), kD = sleutel("Diesel");
  if (!kE || !kD) throw new Error("kolommen niet gevonden");
  const data = await getJson("https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet");
  const rijen = (data.value || []).map(r => {
    const m = /(\d{4})(\d{2})(\d{2})/.exec(String(r.Perioden).replace(/\D/g, "").padEnd(8, "x"));
    return m ? { d: `${m[1]}-${m[2]}-${m[3]}`, e: Number(r[kE]), di: Number(r[kD]) } : null;
  }).filter(Boolean);
  return { euro95_nl: schoonReeks(rijen.map(r => [r.d, r.e])), diesel_nl: schoonReeks(rijen.map(r => [r.d, r.di])) };
}
async function ecb() {
  const csv = await getText(`https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&startPeriod=${vanaf()}`);
  const regels = csv.trim().split(/\r?\n/);
  const kop = regels.shift().split(",");
  const iD = kop.indexOf("TIME_PERIOD"), iV = kop.indexOf("OBS_VALUE");
  return schoonReeks(regels.map(l => { const c = l.split(","); return [c[iD], Number(c[iV])]; }));
}

export const REEKSEN = {
  brent: { naam: "Brent (ruwe olie)", eenheid: "$/vat", soort: "Wereldmarkt" },
  ttf: { naam: "TTF (aardgas Europa)", eenheid: "€/MWh", soort: "Europese markt" },
  henryhub: { naam: "Henry Hub (aardgas VS)", eenheid: "$/MMBtu", soort: "Amerikaanse markt" },
  euro95_nl: { naam: "Euro95 Nederland", eenheid: "€/liter", soort: "Pompprijs" },
  diesel_nl: { naam: "Diesel Nederland", eenheid: "€/liter", soort: "Pompprijs" },
  diesel_vs: { naam: "Diesel Verenigde Staten", eenheid: "$/gallon", soort: "Pompprijs" },
  brent_eur_l: { naam: "Ruwe olie per liter", eenheid: "€/liter", soort: "Berekend" }
};

export async function verversPrijzen() {
  const oud = (await store().get("prijzen", { type: "json" })) || { reeksen: {}, bronnen: {} };
  const taken = {
    brent_yahoo: () => yahoo("BZ=F"),
    brent_eia: () => eia("petroleum/pri/spt", "RBRTE", "daily"),
    ttf: () => yahoo("TTF=F"),
    henryhub: () => eia("natural-gas/pri/fut", "RNGWHHD", "daily"),
    cbs: () => cbs(),
    diesel_vs: () => eia("petroleum/pri/gnd", "EMD_EPD2D_PTE_NUS_DPG", "weekly"),
    eurusd: () => ecb()
  };
  const namen = Object.keys(taken);
  const res = await Promise.allSettled(namen.map(n => taken[n]()));
  const r = {}, status = {};
  res.forEach((x, i) => {
    const n = namen[i];
    if (x.status === "fulfilled") { r[n] = x.value; status[n] = { ok: true, punten: n === "cbs" ? x.value.diesel_nl.length : x.value.length }; }
    else status[n] = { ok: false, fout: String(x.reason?.message || x.reason) };
  });
  const reeksen = { ...oud.reeksen };
  const bronnen = { ...oud.bronnen };
  const zet = (sleutel, punten, bron) => { if (punten?.length) { reeksen[sleutel] = punten; bronnen[sleutel] = bron; } };
  if (r.brent_yahoo?.length) zet("brent", r.brent_yahoo, { naam: "ICE Brent-future via Yahoo Finance", type: "indicatief" });
  else zet("brent", r.brent_eia, { naam: "U.S. Energy Information Administration (spotprijs, ca. een week vertraagd)", type: "officieel" });
  zet("ttf", r.ttf, { naam: "ICE TTF-future via Yahoo Finance", type: "indicatief" });
  zet("henryhub", r.henryhub, { naam: "U.S. Energy Information Administration", type: "officieel" });
  zet("euro95_nl", r.cbs?.euro95_nl, { naam: "CBS (landelijk gemiddelde, wekelijks gepubliceerd)", type: "officieel" });
  zet("diesel_nl", r.cbs?.diesel_nl, { naam: "CBS (landelijk gemiddelde, wekelijks gepubliceerd)", type: "officieel" });
  zet("diesel_vs", r.diesel_vs, { naam: "U.S. Energy Information Administration (weekgemiddelde)", type: "officieel" });
  const fx = r.eurusd?.length ? r.eurusd : oud.fx;
  if (fx?.length && reeksen.brent?.length) {
    const fxMap = new Map(fx); let laatste = fx[0][1];
    const liter = reeksen.brent.map(([d, v]) => { if (fxMap.has(d)) laatste = fxMap.get(d); return [d, v / laatste / 158.987]; });
    zet("brent_eur_l", schoonReeks(liter), { naam: "Berekend uit Brent en de ECB-wisselkoers euro-dollar", type: "berekend" });
  }
  const data = { bijgewerkt: new Date().toISOString(), reeksen, bronnen, fx, status };
  await store().setJSON("prijzen", data);
  return data;
}
export async function leesPrijzen() { return store().get("prijzen", { type: "json" }); }
export async function leesDuiding() { return (await store().get("duiding", { type: "json" })) || { stand: "", standTijd: null, bewegingen: {} }; }
export async function bewaarDuiding(d) { await store().setJSON("duiding", d); }

// Opvallende bewegingen: dagverandering boven de drempel (bij week- of pompcijfers: over 7 dagen)
export function bewegingen(reeksen) {
  const uit = [];
  for (const [sleutel, drempel] of Object.entries(config.drempels || {})) {
    const p = reeksen[sleutel]; if (!p?.length) continue;
    const zeven = ["diesel_nl", "euro95_nl"].includes(sleutel);
    for (let i = 1; i < p.length; i++) {
      let j = i - 1;
      if (zeven) { j = i - 7; if (j < 0) continue; }
      const pct = (p[i][1] - p[j][1]) / p[j][1] * 100;
      if (Math.abs(pct) >= drempel) uit.push({ sleutel: `${sleutel}-${p[i][0]}`, reeks: sleutel, datum: p[i][0], van: p[j][1], naar: p[i][1], vanDatum: p[j][0], pct: Math.round(pct * 10) / 10 });
    }
  }
  // bij pompprijzen opeenvolgende dagen samenvoegen tot één beweging
  const gefilterd = uit.sort((a, b) => a.datum.localeCompare(b.datum)).filter((b, i, arr) => {
    const vorige = arr.slice(0, i).reverse().find(x => x.reeks === b.reeks);
    return !vorige || (new Date(b.datum) - new Date(vorige.datum)) / 864e5 > 6 || !["diesel_nl", "euro95_nl"].includes(b.reeks);
  });
  return gefilterd.sort((a, b) => b.datum.localeCompare(a.datum));
}

// ---------- energie-archief met nieuwskoppen ----------
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const energieRe = new RegExp(`(^|[^\\p{L}])(${(config.energiewoorden || []).map(escRe).join("|")})(?![\\p{L}])`, "iu");
export async function archiveerEnergie(berichten) {
  const arch = (await store().get("archief", { type: "json" })) || [];
  const perUrl = new Map(arch.map(b => [b.url, b]));
  for (const b of berichten) {
    if (perUrl.has(b.url)) continue;
    if (energieRe.test(` ${b.titel} ${b.samenvatting} `)) perUrl.set(b.url, { titel: b.titel, url: b.url, bron: b.bron, label: b.label, staat: b.staat, tijd: b.tijd });
  }
  const grens = Date.now() - 400 * 864e5;
  const lijst = [...perUrl.values()].filter(b => new Date(b.tijd).getTime() > grens).sort((a, b) => b.tijd.localeCompare(a.tijd)).slice(0, 5000);
  await store().setJSON("archief", lijst);
}
export async function leesArchief() { return (await store().get("archief", { type: "json" })) || []; }
