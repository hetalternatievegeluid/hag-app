// Alleen voor de beheerder (wachtwoord in de Netlify-instelling BEHEER_WACHTWOORD).
import { json, schoon, schoonUrl, nieuwId, LABELS, isBeheerder, leesIndex, leesFlits, bewaarFlits, verwijderFlits, leesReacties, bewaarReacties } from "../lib/flitsen.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bron = b => ({ naam: schoon(b?.naam, 80), url: schoonUrl(b?.url), label: schoon(b?.label, 80) });

export default async (req) => {
  if (req.method !== "POST") return json({ fout: "Niet toegestaan" }, 405);
  if (!isBeheerder(req)) { await sleep(1200); return json({ fout: "Wachtwoord klopt niet, of BEHEER_WACHTWOORD is nog niet ingesteld in Netlify." }, 401); }
  let b;
  try { b = await req.json(); } catch { return json({ fout: "Ongeldig verzoek" }, 400); }

  switch (b.actie) {
    case "controle":
      return json({ ok: true });

    case "lijst":
      return json({ flitsen: await leesIndex() });

    case "lees": {
      const f = await leesFlits(b.id);
      return f ? json(f) : json({ fout: "Niet gevonden" }, 404);
    }

    case "opslaan": {
      const nu = new Date().toISOString();
      const f = b.id ? await leesFlits(b.id) : { id: nieuwId(), gemaakt: nu, updates: [] };
      if (!f) return json({ fout: "Niet gevonden" }, 404);
      f.titel = schoon(b.titel, 200);
      if (!f.titel) return json({ fout: "Een flits heeft een titel nodig." }, 400);
      f.context = schoon(b.context, 2000);
      f.sectie = schoon(b.sectie, 40);
      f.bron = bron(b.bron);
      f.community = schoonUrl(b.community);
      f.status = b.status === "archief" ? "archief" : "actief";
      f.chat = ["open", "gemodereerd", "gesloten"].includes(b.chat) ? b.chat : "gemodereerd";
      return json(await bewaarFlits(f));
    }

    case "verwijder":
      await verwijderFlits(b.id);
      return json({ ok: true });

    case "update": {
      const f = await leesFlits(b.flits);
      if (!f) return json({ fout: "Niet gevonden" }, 404);
      const label = LABELS.includes(b.label) ? b.label : "onbevestigd";
      const tekst = schoon(b.tekst, 1500);
      if (!tekst) return json({ fout: "De update is leeg." }, 400);
      if (b.id) {
        const u = f.updates.find(x => x.id === b.id);
        if (!u) return json({ fout: "Update niet gevonden" }, 404);
        if (u.label !== label || u.tekst !== tekst) {
          u.geschiedenis = [...(u.geschiedenis || []), { tijd: new Date().toISOString(), label: u.label }];
          u.bijgewerkt = new Date().toISOString();
        }
        Object.assign(u, { label, tekst, bron: bron(b.bron) });
      } else {
        f.updates.unshift({ id: nieuwId(), tijd: new Date().toISOString(), label, tekst, bron: bron(b.bron) });
      }
      return json(await bewaarFlits(f));
    }

    case "update-weg": {
      const f = await leesFlits(b.flits);
      if (!f) return json({ fout: "Niet gevonden" }, 404);
      f.updates = f.updates.filter(u => u.id !== b.id);
      return json(await bewaarFlits(f));
    }

    case "wachtrij": {
      const uit = [];
      for (const f of await leesIndex()) {
        for (const r of await leesReacties(f.id)) if (r.status === "wacht") uit.push({ ...r, flits: f.id, flitsTitel: f.titel });
      }
      uit.sort((a, b) => a.tijd.localeCompare(b.tijd));
      return json({ reacties: uit });
    }

    case "reactie": {
      const lijst = await leesReacties(b.flits);
      const r = lijst.find(x => x.id === b.id);
      if (!r) return json({ fout: "Reactie niet gevonden" }, 404);
      if (b.besluit === "goedkeuren") { r.status = "zichtbaar"; r.meldingen = 0; delete r.reden; }
      else if (b.besluit === "verwijderen") r.status = "verwijderd";
      await bewaarReacties(b.flits, lijst);
      return json({ ok: true });
    }

    default:
      return json({ fout: "Onbekende actie" }, 400);
  }
};

export const config = { path: "/api/beheer" };
