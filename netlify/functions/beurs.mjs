// /api/beurs: koersen, nieuws per bedrijf en opvallende koersbewegingen. ?kort=1 voor de startpagina, ?status=1 voor de bronnen.
import { leesBeurs, verversBeurs, bouwOverzicht, leesTechArchief } from "../lib/beurs.mjs";
export default async (req) => {
  const url = new URL(req.url);
  let data = await leesBeurs();
  if (!data || Date.now() - new Date(data.bijgewerkt).getTime() > 3 * 36e5) data = await verversBeurs();
  if (url.searchParams.has("status")) return Response.json({ bijgewerkt: data.bijgewerkt, status: data.status }, { headers: { "cache-control": "no-store" } });
  const o = bouwOverzicht(data, await leesTechArchief());
  if (url.searchParams.has("kort")) return Response.json({ aandelen: o.aandelen.filter(a => a.soort === "aandeel").map(({ symbool, naam, koers, valuta, pct }) => ({ symbool, naam, koers, valuta, pct })) }, { headers: { "cache-control": "public, max-age=300" } });
  return Response.json(o, { headers: { "cache-control": "public, max-age=300" } });
};
export const config = { path: "/api/beurs" };
