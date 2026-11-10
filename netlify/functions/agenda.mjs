// Openbaar: /api/agenda
import { leesAgenda } from "../lib/agenda.mjs";
export default async () => {
  const grens = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const items = (await leesAgenda()).filter(i => (i.eind || i.start) >= grens);
  return Response.json({ items }, { headers: { "cache-control": "public, max-age=120" } });
};
export const config = { path: "/api/agenda" };
