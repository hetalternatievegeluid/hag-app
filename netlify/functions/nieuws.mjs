// Geeft de nieuwsstroom aan de app: /api/nieuws
// /api/nieuws?status=1 laat per bron zien of hij werkt.
import { leesNieuws, verversNieuws } from "../lib/nieuws.mjs";

export default async (req, context) => {
  const url = new URL(req.url);
  let data = await leesNieuws();
  if (!data) data = await verversNieuws();
  else {
    const leeftijd = Date.now() - new Date(data.bijgewerkt).getTime();
    const oudFormaat = !data.berichten?.some(b => "plaats" in b) || !("vergelijking" in data) || !data.secties?.some(x => x.id === "tech") || !data.berichten?.some(b => "kamp" in b) || !("framing" in data);
    if (leeftijd > 45 * 60e3 || (oudFormaat && leeftijd > 2 * 60e3)) {
      // ververs op de achtergrond; de lezer krijgt meteen de bestaande berichten
      const klus = verversNieuws().catch(e => console.warn("Verversen mislukt: " + e.message));
      if (context?.waitUntil) context.waitUntil(klus); else await klus;
    }
  }

  if (url.searchParams.has("status")) {
    return Response.json({ bijgewerkt: data.bijgewerkt, berichten: data.berichten.length, secties: data.secties.map(s => s.id), perSectie: Object.fromEntries(data.secties.map(s => [s.id, data.berichten.filter(b => b.secties.includes(s.id)).length])), bronnen: data.status }, { headers: { "cache-control": "no-store" } });
  }
  const { status, ...publiek } = data;
  return Response.json(publiek, { headers: { "cache-control": "public, max-age=120", "netlify-cdn-cache-control": "public, s-maxage=120, stale-while-revalidate=600" } });
};

export const config = { path: "/api/nieuws" };
