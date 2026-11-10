// Geeft de nieuwsstroom aan de app: /api/nieuws
// /api/nieuws?status=1 laat per bron zien of hij werkt.
import { leesNieuws, verversNieuws } from "../lib/nieuws.mjs";

export default async (req) => {
  const url = new URL(req.url);
  let data = await leesNieuws();
  const verouderd = !data || !data.berichten?.some(b => "plaats" in b) || Date.now() - new Date(data.bijgewerkt).getTime() > 45 * 60e3;
  if (verouderd) data = await verversNieuws();

  if (url.searchParams.has("status")) {
    return Response.json({ bijgewerkt: data.bijgewerkt, berichten: data.berichten.length, bronnen: data.status }, { headers: { "cache-control": "no-store" } });
  }
  const { status, ...publiek } = data;
  return Response.json(publiek, { headers: { "cache-control": "public, max-age=120" } });
};

export const config = { path: "/api/nieuws" };
