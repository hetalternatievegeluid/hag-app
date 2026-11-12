// Elk half uur: stuurt een pushmelding bij nieuwe artikelen in de app.
import { getStore } from "@netlify/blobs";
import { stuur } from "../lib/push.mjs";
import { leesIndex } from "../lib/artikelen.mjs";
const RUBRIEK = { nieuws: "Nieuws Artikel", onderzoek: "Onderzoeks Artikel", analyse: "Analyse Artikel", anderekijk: "Een Andere Kijk" };
export default async () => {
  const idx = await leesIndex();
  const articles = idx?.articles || [];
  if (!articles.length) return console.warn("Geen artikelindex gevonden");
  const store = getStore({ name: "push", consistency: "strong" });
  const gemeld = await store.get("gemelde-artikelen", { type: "json" });
  if (!gemeld) { await store.setJSON("gemelde-artikelen", articles.map(a => a.id)); return console.log("Beginstand vastgelegd."); }
  const bekend = new Set(gemeld);
  const nieuw = articles.filter(a => !bekend.has(a.id));
  for (const a of nieuw.slice(0, 3)) {
    const res = await stuur({ onderwerpen: ["artikelen", ...(a.dossiers || [])], titel: `${RUBRIEK[a.cat] || "Nieuw artikel"}: ${a.title}`, tekst: (a.intro || "").slice(0, 200), url: `/#artikel-${a.id}`, tag: `artikel-${a.id}` });
    console.log(`Melding "${a.title}": ${res.verstuurd} van ${res.bereik} verstuurd.`);
  }
  if (nieuw.length) await store.setJSON("gemelde-artikelen", [...bekend, ...nieuw.map(a => a.id)].slice(-5000));
};
export const config = { schedule: "*/30 * * * *" };
