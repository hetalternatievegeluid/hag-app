// Ververst de koersen elke 20 minuten op werkdagen.
import { verversBeurs } from "../lib/beurs.mjs";
export default async () => {
  const d = await verversBeurs();
  const fout = Object.entries(d.status).filter(([, s]) => !s.ok).map(([k, s]) => `${k}: ${s.fout}`);
  console.log(`Koersen bijgewerkt.${fout.length ? " Problemen: " + fout.join("; ") : ""}`);
};
export const config = { schedule: "*/20 6-22 * * 1-5" };
