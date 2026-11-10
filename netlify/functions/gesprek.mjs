// Openbaar: /api/gesprek (ruimtes), /api/gesprek?ruimte=... (berichten), POST (plaatsen of melden).
import { json, schoon, nieuwId, binnenLimiet, moetWachten } from "../lib/flitsen.mjs";
import { ruimtes, leesBerichten, bewaarBerichten, publiek, GERESERVEERD, bestaat } from "../lib/gesprek.mjs";

export default async (req, context) => {
  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("ruimte");
    const alle = await ruimtes();
    if (!id) {
      const lijst = await Promise.all(alle.map(async r => {
        const zichtbaar = (await leesBerichten(r.id)).filter(b => b.status === "zichtbaar");
        const laatste = zichtbaar[zichtbaar.length - 1];
        return { ...r, aantal: zichtbaar.length, laatste: laatste ? { naam: laatste.naam, tekst: laatste.tekst.slice(0, 120), tijd: laatste.tijd } : null };
      }));
      return json({ ruimtes: lijst }, 200, "public, max-age=15");
    }
    const r = alle.find(x => x.id === id);
    if (!r) return json({ fout: "Ruimte niet gevonden" }, 404);
    const berichten = (await leesBerichten(id)).filter(b => b.status === "zichtbaar").slice(-200).map(publiek);
    return json({ ruimte: r, berichten });
  }
  if (req.method !== "POST") return json({ fout: "Niet toegestaan" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ fout: "Ongeldig verzoek" }, 400); }
  if (!bestaat(body.ruimte)) return json({ fout: "Ruimte niet gevonden" }, 404);
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "onbekend";

  if (body.actie === "meld") {
    if (!(await binnenLimiet(ip, 10))) return json({ fout: "Te veel meldingen, probeer het later opnieuw." }, 429);
    const lijst = await leesBerichten(body.ruimte);
    const b = lijst.find(x => x.id === body.id);
    if (b && !b.redactie) {
      b.meldingen = (b.meldingen || 0) + 1;
      if (b.meldingen >= 3 && b.status === "zichtbaar") { b.status = "wacht"; b.reden = "gemeld"; }
      await bewaarBerichten(body.ruimte, lijst);
    }
    return json({ ok: true });
  }

  const r = (await ruimtes()).find(x => x.id === body.ruimte);
  if (r.modus === "gesloten") return json({ fout: "Deze ruimte is op dit moment gesloten." }, 403);
  if (body.website) return json({ status: "wacht" });
  if (!body.t || Date.now() - Number(body.t) < 4000) return json({ fout: "Dat ging wel erg snel. Probeer het nog eens." }, 400);
  const naam = schoon(body.naam, 40);
  const tekst = schoon(body.tekst, 1000);
  if (naam.length < 2) return json({ fout: "Vul een naam in van minstens twee tekens." }, 400);
  if (GERESERVEERD.test(naam)) return json({ fout: "Deze naam is gereserveerd. Kies een andere naam." }, 400);
  if (tekst.length < 2) return json({ fout: "Je bericht is leeg." }, 400);
  if (!(await binnenLimiet(ip))) return json({ fout: "Je hebt veel berichten geplaatst in korte tijd. Probeer het over tien minuten opnieuw." }, 429);

  const lijst = await leesBerichten(r.id);
  const antwoordOp = lijst.some(x => x.id === body.antwoordOp && x.status === "zichtbaar") ? body.antwoordOp : null;
  const status = r.modus === "open" && !moetWachten(tekst) ? "zichtbaar" : "wacht";
  lijst.push({ id: nieuwId(), naam, tekst, tijd: new Date().toISOString(), status, meldingen: 0, antwoordOp });
  await bewaarBerichten(r.id, lijst);
  return json({ status });
};

export const config = { path: "/api/gesprek" };
