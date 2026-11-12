// Elke ochtend om 05:30 (UTC): signalen uit het nieuws en nieuws per agendapunt bijwerken.
import { verversSignalen } from "../lib/signalen.mjs";
export default async () => { const d = await verversSignalen(); console.log(`Agenda-signalen: ${d.signalen.length} signalen, nieuws bij ${Object.keys(d.perItem).length} agendapunten.`); };
export const config = { schedule: "30 5 * * *" };
