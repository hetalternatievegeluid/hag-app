// Openbaar: /api/push (sleutel en onderwerpen), POST: aanmelden, afmelden, eigen onderwerpen opvragen.
import { publiekeSleutel, ONDERWERPEN, abonneer, afmelden, onderwerpenVan } from "../lib/push.mjs";
const json = (d, s = 200) => Response.json(d, { status: s, headers: { "cache-control": "no-store" } });
export default async (req) => {
  if (req.method === "GET") return json({ sleutel: await publiekeSleutel(), onderwerpen: ONDERWERPEN });
  let b; try { b = await req.json(); } catch { return json({ fout: "Ongeldig verzoek" }, 400); }
  try {
    if (b.actie === "abonneer") return json({ onderwerpen: await abonneer(b.abonnement, b.onderwerpen) });
    if (b.actie === "afmelden") { await afmelden(String(b.endpoint || "")); return json({ ok: true }); }
    if (b.actie === "onderwerpen") return json({ onderwerpen: await onderwerpenVan(String(b.endpoint || "")) });
  } catch (e) { return json({ fout: e.message }, 400); }
  return json({ fout: "Onbekende actie" }, 400);
};
export const config = { path: "/api/push" };
