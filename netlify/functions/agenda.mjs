// Openbaar: /api/agenda → agendapunten, signalen uit het nieuws en nieuws per agendapunt.
import { leesAgenda } from "../lib/agenda.mjs";
import { leesSignalen, verversSignalen } from "../lib/signalen.mjs";
export default async () => {
  const grens = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const items = (await leesAgenda()).filter(i => (i.eind || i.start) >= grens);
  let s = await leesSignalen();
  if (!s) s = await verversSignalen().catch(() => null);
  return Response.json({ items, signalen: s?.signalen || [], perItem: s?.perItem || {}, signalenBijgewerkt: s?.bijgewerkt || null },
    { headers: { "cache-control": "public, max-age=120", "netlify-cdn-cache-control": "public, s-maxage=600, stale-while-revalidate=1800" } });
};
export const config = { path: "/api/agenda" };
