// Openbaar: reacties lezen (GET ?flits=...), plaatsen en melden (POST).
import { json, schoon, nieuwId, leesFlits, leesReacties, bewaarReacties, binnenLimiet, moetWachten } from "../lib/flitsen.mjs";

const publiek = r => ({ id: r.id, naam: r.naam, tekst: r.tekst, tijd: r.tijd });

export default async (req, context) => {
  if (req.method === "GET") {
    const flits = new URL(req.url).searchParams.get("flits");
    const f = await leesFlits(flits);
    if (!f) return json({ fout: "Flits niet gevonden" }, 404);
    const r = (await leesReacties(flits)).filter(x => x.status === "zichtbaar").map(publiek);
    return json({ chat: f.chat, reacties: r });
  }
  if (req.method !== "POST") return json({ fout: "Niet toegestaan" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ fout: "Ongeldig verzoek" }, 400); }
  const f = await leesFlits(body.flits);
  if (!f) return json({ fout: "Flits niet gevonden" }, 404);
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "onbekend";

  if (body.actie === "meld") {
    if (!(await binnenLimiet(ip, 10))) return json({ fout: "Te veel meldingen, probeer het later opnieuw." }, 429);
    const lijst = await leesReacties(f.id);
    const r = lijst.find(x => x.id === body.id);
    if (r) {
      r.meldingen = (r.meldingen || 0) + 1;
      if (r.meldingen >= 3 && r.status === "zichtbaar") { r.status = "wacht"; r.reden = "gemeld"; }
      await bewaarReacties(f.id, lijst);
    }
    return json({ ok: true });
  }

  if (f.status !== "actief" || f.chat === "gesloten") return json({ fout: "Het gesprek bij deze flits is gesloten." }, 403);
  if (body.website) return json({ status: "wacht" });                       // valstrik voor bots
  if (!body.t || Date.now() - Number(body.t) < 4000) return json({ fout: "Dat ging wel erg snel. Probeer het nog eens." }, 400);
  const naam = schoon(body.naam, 40);
  const tekst = schoon(body.tekst, 1000);
  if (naam.length < 2) return json({ fout: "Vul een naam in van minstens twee tekens." }, 400);
  if (tekst.length < 2) return json({ fout: "Je reactie is leeg." }, 400);
  if (!(await binnenLimiet(ip))) return json({ fout: "Je hebt veel gereageerd in korte tijd. Probeer het over tien minuten opnieuw." }, 429);

  const status = f.chat === "open" && !moetWachten(tekst) ? "zichtbaar" : "wacht";
  const lijst = await leesReacties(f.id);
  lijst.push({ id: nieuwId(), naam, tekst, tijd: new Date().toISOString(), status, meldingen: 0 });
  await bewaarReacties(f.id, lijst.slice(-2000));
  return json({ status });
};

export const config = { path: "/api/reacties" };
