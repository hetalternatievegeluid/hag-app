// Draait automatisch elke 15 minuten en ververst de nieuwsstroom.
import { verversNieuws } from "../lib/nieuws.mjs";

export default async () => {
  const data = await verversNieuws();
  const fout = Object.values(data.status).filter(s => !s.ok).map(s => `${s.naam}: ${s.fout}`);
  console.log(`Nieuwsstroom: ${data.berichten.length} berichten.${fout.length ? " Problemen: " + fout.join("; ") : ""}`);
};

export const config = { schedule: "*/30 * * * *" };
