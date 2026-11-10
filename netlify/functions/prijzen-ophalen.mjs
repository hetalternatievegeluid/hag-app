// Ververst de energieprijzen elke drie uur.
import { verversPrijzen } from "../lib/energie.mjs";
export default async () => {
  const d = await verversPrijzen();
  const fout = Object.entries(d.status).filter(([, s]) => !s.ok).map(([n, s]) => `${n}: ${s.fout}`);
  console.log(`Energieprijzen bijgewerkt.${fout.length ? " Problemen: " + fout.join("; ") : ""}`);
};
export const config = { schedule: "5 */3 * * *" };
