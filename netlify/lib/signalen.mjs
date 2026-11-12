// Dagelijkse agenda-update zonder AI: koppen die op een aankomende afspraak wijzen,
// en het nieuwste nieuws bij elk bestaand agendapunt.
import { getStore } from "@netlify/blobs";
import { leesNieuws } from "./nieuws.mjs";
import { leesAgenda } from "./agenda.mjs";

const store = () => getStore({ name: "agenda", consistency: "strong" });
const SIGNAAL = /(^|[^\p{L}])(summit|summits|talks|to meet|will meet|meeting with|met with|next week|next month|state visit|to visit|will visit|negotiations?|ceasefire|truce|deadline|vote on|referendum|elections?|conference|G7|G20|APEC|BRICS|NATO summit|COP3\d|topoverleg|top in|topontmoeting|onderhandelingen|ontmoeting|bezoek aan|volgende week|volgende maand|stemming|verkiezingen|staakt-het-vuren|wapenstilstand)(?![\p{L}])/iu;
const STOP = new Set("the and for with from that this will over after amid says said into about their they talks summit meeting meet next week visit deal president minister leaders leader with between voor over door naar maar niet deze wordt worden heeft zijn top".split(" "));
const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const woorden = s => [...new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w)))];

export async function verversSignalen() {
  const nieuws = await leesNieuws();
  const berichten = (nieuws?.berichten || []).filter(b => Date.now() - new Date(b.tijd).getTime() < 48 * 36e5);
  const kort = b => ({ titel: b.titel, url: b.url, bron: b.bron, label: b.label, staat: !!b.staat, tijd: b.tijd, secties: b.secties || [] });
  const gezien = new Set();
  const signalen = berichten.filter(b => SIGNAAL.test(" " + b.titel + " ")).filter(b => { const k = norm(b.titel).slice(0, 60); if (gezien.has(k)) return false; gezien.add(k); return true; })
    .sort((a, b) => b.tijd.localeCompare(a.tijd)).slice(0, 40).map(kort);
  const vandaag = new Date().toISOString().slice(0, 10);
  const perItem = {};
  for (const i of (await leesAgenda()).filter(i => (i.eind || i.start) >= vandaag)) {
    const sleutel = woorden(i.titel + " " + (i.plaats || ""));
    if (!sleutel.length) continue;
    const treffers = berichten.map(b => { const t = norm(b.titel); return { b, n: sleutel.filter(w => t.includes(w)).length }; })
      .filter(x => x.n >= Math.min(2, sleutel.length)).sort((a, b) => b.n - a.n || b.b.tijd.localeCompare(a.b.tijd)).slice(0, 4).map(x => kort(x.b));
    if (treffers.length) perItem[i.id] = treffers;
  }
  const data = { bijgewerkt: new Date().toISOString(), signalen, perItem };
  await store().setJSON("signalen", data);
  return data;
}
export async function leesSignalen() { return store().get("signalen", { type: "json" }); }
