// /api/prijzen: reeksen, bronnen, opvallende bewegingen met nieuws uit dezelfde dagen, en de duiding van de redactie.
// /api/prijzen?status=1 laat zien welke bron werkt.
import { leesPrijzen, verversPrijzen, bewegingen, leesArchief, leesDuiding, REEKSEN } from "../lib/energie.mjs";

export default async (req) => {
  const url = new URL(req.url);
  let data = await leesPrijzen();
  if (!data || Date.now() - new Date(data.bijgewerkt).getTime() > 6 * 36e5) data = await verversPrijzen();
  if (url.searchParams.has("kort")) {
    const kort = {};
    for (const k of ["brent", "ttf", "diesel_nl", "euro95_nl"]) {
      const p = data.reeksen[k]; if (!p?.length) continue;
      const [d, v] = p[p.length - 1], vorige = p[p.length - 2];
      kort[k] = { naam: REEKSEN[k].naam, eenheid: REEKSEN[k].eenheid, waarde: v, datum: d, pct: vorige ? Math.round((v - vorige[1]) / vorige[1] * 1000) / 10 : null };
    }
    return Response.json({ kort }, { headers: { "cache-control": "public, max-age=600" } });
  }
  if (url.searchParams.has("status")) return Response.json({ bijgewerkt: data.bijgewerkt, status: data.status }, { headers: { "cache-control": "no-store" } });

  const [archief, duiding] = await Promise.all([leesArchief(), leesDuiding()]);
  const bew = bewegingen(data.reeksen).slice(0, 40).map(b => {
    const t = new Date(b.datum + "T12:00:00Z").getTime();
    const nieuws = archief.filter(n => Math.abs(new Date(n.tijd).getTime() - t) <= 36 * 36e5).slice(0, 8);
    return { ...b, nieuws, duiding: duiding.bewegingen[b.sleutel] || null };
  });
  return Response.json({
    bijgewerkt: data.bijgewerkt,
    reeksen: data.reeksen,
    info: Object.fromEntries(Object.entries(REEKSEN).map(([k, v]) => [k, { ...v, bron: data.bronnen[k] || null }])),
    bewegingen: bew,
    stand: duiding.stand ? { tekst: duiding.stand, tijd: duiding.standTijd } : null,
    archiefVanaf: archief.length ? archief[archief.length - 1].tijd : null
  }, { headers: { "cache-control": "public, max-age=600" } });
};
export const config = { path: "/api/prijzen" };
