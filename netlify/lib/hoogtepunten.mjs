// Hoogtepunten van de dag, week en maand: de gebeurtenissen waarover de meeste bronnen
// en perspectieven berichtten. Per dag wordt een kleine lijst bewaard; week en maand
// worden daaruit samengesteld. Geen AI, geen extra ophaalrondes.
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "hoogtepunten", consistency: "strong" });
const DAGEN_BEWAREN = 40, PER_DAG = 15;
const STOP = new Set(("the and for with from that this says said after over amid will have been more than into about what their they were also news live latest update updates report reports video watch week today year years could would should first last told between against while where when which being under around before because still just like make made very most some other another again them then there here only even since such those these three many much among across upon according officials official government president minister leader leaders people country countries world state states talks deal calls call new " +
  "voor over door naar maar niet deze wordt worden heeft hebben zijn meer tegen onder ook nog als want omdat toen waar zegt zeggen eerste laatste nieuwe land landen").split(/\s+/));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = t => [...new Set(norm(t).split(" ").filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => w.length > 5 && w.endsWith("s") ? w.slice(0, -1) : w))];
const dagVan = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
function dagGrenzen(dag) {
  // middernacht Amsterdam-tijd, ruim genomen (UTC+1 of +2)
  const start = new Date(dag + "T00:00:00+01:00").getTime();
  return { vanaf: start - 36e5, tot: start + 24 * 36e5 };
}
function lijkt(a, b) {
  const A = new Set(a.woorden), gedeeld = b.woorden.filter(w => A.has(w)).length;
  const zelfdePlek = a.plaats && a.plaats === b.plaats;
  return gedeeld >= 4 || (gedeeld >= 3 && gedeeld / Math.min(a.woorden.length, b.woorden.length) >= 0.4) || (zelfdePlek && gedeeld >= 2);
}
function score(h) { return h.bronnen.length + 2 * h.perspectieven.length + 3 * (h.dagen?.length || 1) - 3; }
function naarItem(c) {
  return {
    kop: c.kop, plaats: c.plaats || null, secties: c.secties || [],
    woorden: tokens(c.berichten.map(b => b.titel).join(" ")).slice(0, 25),
    bronnen: [...new Set(c.berichten.map(b => b.bron))],
    perspectieven: [...new Set(c.berichten.map(b => b.perspectief).filter(Boolean))],
    eerst: c.berichten.map(b => b.tijd).sort()[0], laatst: c.berichten.map(b => b.tijd).sort().at(-1),
    berichten: c.berichten.slice(0, 10).map(({ bron, label, staat, perspectief, titel, url, tijd }) => ({ bron, label, staat, perspectief, titel, url, tijd }))
  };
}
function voegSamen(doel, nieuw) {
  const urls = new Set(doel.berichten.map(b => b.url));
  for (const b of nieuw.berichten) if (!urls.has(b.url) && doel.berichten.length < 12) doel.berichten.push(b);
  doel.bronnen = [...new Set([...doel.bronnen, ...nieuw.bronnen])];
  doel.perspectieven = [...new Set([...doel.perspectieven, ...nieuw.perspectieven])];
  doel.secties = [...new Set([...doel.secties, ...nieuw.secties])];
  doel.woorden = [...new Set([...doel.woorden, ...nieuw.woorden])].slice(0, 40);
  if (nieuw.eerst < doel.eerst) doel.eerst = nieuw.eerst;
  if (nieuw.laatst > doel.laatst) { doel.laatst = nieuw.laatst; if (nieuw.bronnen.length >= doel.bronnen.length / 2) doel.kop = nieuw.kop; }
  if (!doel.plaats) doel.plaats = nieuw.plaats;
}
function groepeer(items) {
  const uit = [];
  for (const it of items) {
    const g = uit.find(x => lijkt(x, it));
    if (g) { voegSamen(g, it); g.dagen = [...new Set([...(g.dagen || []), ...(it.dagen || [])])]; }
    else uit.push({ ...it, berichten: [...it.berichten], dagen: [...(it.dagen || [])] });
  }
  return uit;
}

async function bewaarDag(dag, clusters) {
  const bestaand = (await store().get(`dag/${dag}`, { type: "json" })) || [];
  const lijst = groepeer([...bestaand, ...clusters.map(naarItem)].map(i => ({ ...i, dagen: [dag] })))
    .sort((a, b) => score(b) - score(a)).slice(0, PER_DAG);
  await store().setJSON(`dag/${dag}`, lijst);
  const idx = new Set((await store().get("dagen", { type: "json" })) || []);
  idx.add(dag);
  const dagen = [...idx].sort().slice(-DAGEN_BEWAREN);
  await store().setJSON("dagen", dagen);
  for (const oud of [...idx].filter(d => !dagen.includes(d))) await store().delete(`dag/${oud}`);
}

// Na elke ververs-ronde: de dag van vandaag bijwerken, en ontbrekende dagen uit de bewaarde berichten aanvullen.
export async function bewaarHoogtepunten(berichten, vergelijk) {
  const vandaag = dagVan(new Date());
  const g = dagGrenzen(vandaag);
  await bewaarDag(vandaag, vergelijk(berichten, { vanaf: g.vanaf, tot: Date.now(), max: 30 }));
  const bekend = new Set((await store().get("dagen", { type: "json" })) || []);
  for (let i = 1; i <= 6; i++) {
    const d = dagVan(new Date(Date.now() - i * 864e5));
    if (bekend.has(d)) continue;
    const gr = dagGrenzen(d);
    const cl = vergelijk(berichten, { vanaf: gr.vanaf, tot: gr.tot, max: 30 });
    if (cl.length) await bewaarDag(d, cl);
  }
}

export async function leesHoogtepunten() {
  const dagen = ((await store().get("dagen", { type: "json" })) || []).sort();
  const lees = async d => ((await store().get(`dag/${d}`, { type: "json" })) || []).map(i => ({ ...i, dagen: i.dagen?.length ? i.dagen : [d] }));
  const vandaag = dagVan(new Date());
  const binnen = n => dagen.filter(d => d > dagVan(new Date(Date.now() - n * 864e5)) && d <= vandaag);
  const top = (items, n) => groepeer(items).sort((a, b) => score(b) - score(a)).slice(0, n)
    .map(({ woorden, ...r }) => ({ ...r, berichten: r.berichten.sort((a, b) => b.tijd.localeCompare(a.tijd)).slice(0, 8) }));
  let dagLijst = await lees(vandaag), dagLabel = vandaag;
  if (dagLijst.length < 2 && dagen.length > 1) { dagLabel = dagen.filter(d => d < vandaag).at(-1) || vandaag; dagLijst = [...dagLijst, ...(await lees(dagLabel))]; }
  const week = (await Promise.all(binnen(7).map(lees))).flat();
  const maand = (await Promise.all(binnen(31).map(lees))).flat();
  return {
    bijgewerkt: new Date().toISOString(),
    dag: { datum: dagLabel, items: top(dagLijst, 5) },
    week: { vanaf: binnen(7)[0] || vandaag, items: top(week, 7) },
    maand: { vanaf: binnen(31)[0] || vandaag, dagen: binnen(31).length, items: top(maand, 10) }
  };
}
