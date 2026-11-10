// Alleen voor de beheerder (wachtwoord in de Netlify-instelling BEHEER_WACHTWOORD).
import { json, schoon, schoonUrl, nieuwId, LABELS, isBeheerder, leesIndex, leesFlits, bewaarFlits, verwijderFlits, leesReacties, bewaarReacties } from "../lib/flitsen.mjs";

import { ruimtes, zetModus, leesBerichten, bewaarBerichten, bestaat } from "../lib/gesprek.mjs";
import { leesPrijzen, bewegingen, leesDuiding, bewaarDuiding, REEKSEN } from "../lib/energie.mjs";
import { leesAgenda, bewaarAgenda, STATUSSEN } from "../lib/agenda.mjs";
import { stuur, ONDERWERPEN, leesAbonnees } from "../lib/push.mjs";
import { ontsleutel, herstel, laatsteBackup } from "../lib/backup.mjs";
import { leesNieuws } from "../lib/nieuws.mjs";

async function meld(opties) { try { return await stuur(opties); } catch (e) { console.warn("Push mislukt: " + e.message); return { fout: e.message }; } }

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
      const nieuw = !b.id;
      const opgeslagen = await bewaarFlits(f);
      if (nieuw && b.push) opgeslagen.push = await meld({ onderwerpen: [f.sectie], titel: `Nieuwe flits: ${f.titel}`, tekst: f.context, url: `/#flits-${f.id}`, tag: `flits-${f.id}` });
      return json(opgeslagen);
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
      const opgeslagen = await bewaarFlits(f);
      if (b.push && !b.id) opgeslagen.push = await meld({ onderwerpen: [f.sectie], titel: `Flits: ${f.titel}`, tekst, url: `/#flits-${f.id}`, tag: `flits-${f.id}` });
      return json(opgeslagen);
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
      for (const r of await ruimtes()) {
        for (const m of await leesBerichten(r.id)) if (m.status === "wacht") uit.push({ ...m, ruimte: r.id, ruimteNaam: r.naam });
      }
      uit.sort((a, b) => a.tijd.localeCompare(b.tijd));
      return json({ reacties: uit });
    }

    case "reactie": {
      if (b.ruimte) {
        const lijst = await leesBerichten(b.ruimte);
        const m = lijst.find(x => x.id === b.id);
        if (!m) return json({ fout: "Bericht niet gevonden" }, 404);
        if (b.besluit === "goedkeuren") { m.status = "zichtbaar"; m.meldingen = 0; delete m.reden; }
        else if (b.besluit === "verwijderen") m.status = "verwijderd";
        await bewaarBerichten(b.ruimte, lijst);
        return json({ ok: true });
      }
      const lijst = await leesReacties(b.flits);
      const r = lijst.find(x => x.id === b.id);
      if (!r) return json({ fout: "Reactie niet gevonden" }, 404);
      if (b.besluit === "goedkeuren") { r.status = "zichtbaar"; r.meldingen = 0; delete r.reden; }
      else if (b.besluit === "verwijderen") r.status = "verwijderd";
      await bewaarReacties(b.flits, lijst);
      return json({ ok: true });
    }

    case "ruimtes":
      return json({ ruimtes: await ruimtes() });

    case "ruimte-modus":
      return (await zetModus(b.ruimte, b.modus)) ? json({ ok: true }) : json({ fout: "Ongeldige ruimte of stand" }, 400);

    case "redactie-bericht": {
      if (!bestaat(b.ruimte)) return json({ fout: "Ruimte niet gevonden" }, 404);
      const tekst = schoon(b.tekst, 2000);
      if (!tekst) return json({ fout: "Het bericht is leeg." }, 400);
      const lijst = await leesBerichten(b.ruimte);
      const antwoordOp = lijst.some(x => x.id === b.antwoordOp) ? b.antwoordOp : null;
      lijst.push({ id: nieuwId(), naam: schoon(b.naam, 40) || "Redactie", tekst, tijd: new Date().toISOString(), status: "zichtbaar", meldingen: 0, redactie: true, antwoordOp });
      await bewaarBerichten(b.ruimte, lijst);
      return json({ ok: true });
    }

    case "ruimte-berichten": {
      if (!bestaat(b.ruimte)) return json({ fout: "Ruimte niet gevonden" }, 404);
      const lijst = (await leesBerichten(b.ruimte)).filter(m => m.status === "zichtbaar").slice(-60);
      return json({ berichten: lijst });
    }

    case "bericht-weg": {
      const lijst = await leesBerichten(b.ruimte);
      const m = lijst.find(x => x.id === b.id);
      if (m) { m.status = "verwijderd"; await bewaarBerichten(b.ruimte, lijst); }
      return json({ ok: true });
    }

    case "energie": {
      const p = await leesPrijzen();
      const d = await leesDuiding();
      const bew = p ? bewegingen(p.reeksen).slice(0, 40).map(x => ({ ...x, naam: REEKSEN[x.reeks]?.naam, eenheid: REEKSEN[x.reeks]?.eenheid, duiding: d.bewegingen[x.sleutel] || "" })) : [];
      return json({ stand: d.stand, standTijd: d.standTijd, bewegingen: bew, status: p?.status || null, bijgewerkt: p?.bijgewerkt || null });
    }

    case "energie-duiding": {
      const d = await leesDuiding();
      if (typeof b.stand === "string") { d.stand = schoon(b.stand, 400); d.standTijd = new Date().toISOString(); }
      if (b.sleutel) { const t = schoon(b.tekst, 1500); if (t) d.bewegingen[b.sleutel] = { tekst: t, tijd: new Date().toISOString() }; else delete d.bewegingen[b.sleutel]; }
      await bewaarDuiding(d);
      return json({ ok: true });
    }

    case "agenda":
      return json({ items: await leesAgenda(), statussen: STATUSSEN });

    case "agenda-opslaan": {
      const lijst = await leesAgenda();
      const datum = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null;
      const item = b.id ? lijst.find(i => i.id === b.id) : { id: nieuwId() };
      if (!item) return json({ fout: "Niet gevonden" }, 404);
      const startDatum = datum(b.start);
      if (!schoon(b.titel, 200) || !startDatum) return json({ fout: "Titel en (vermoedelijke) begindatum zijn verplicht." }, 400);
      Object.assign(item, {
        titel: schoon(b.titel, 200), start: startDatum, eind: datum(b.eind) || undefined, datumTekst: schoon(b.datumTekst, 60) || undefined,
        plaats: schoon(b.plaats, 80), sectie: schoon(b.sectie, 40), status: STATUSSEN.includes(b.status) ? b.status : "speculatie",
        toelichting: schoon(b.toelichting, 1500), bron: bron(b.bron), bijgewerkt: new Date().toISOString()
      });
      if (!b.id) lijst.push(item);
      await bewaarAgenda(lijst);
      const res = { ok: true, id: item.id };
      if (b.push) res.push = await meld({ onderwerpen: [item.sectie], titel: `Agenda: ${item.titel}`, tekst: `${item.datumTekst || item.start}${item.plaats ? ", " + item.plaats : ""}. ${item.toelichting}`.slice(0, 200), url: "/#agenda", tag: `agenda-${item.id}` });
      return json(res);
    }

    case "agenda-weg":
      await bewaarAgenda((await leesAgenda()).filter(i => i.id !== b.id));
      return json({ ok: true });

    case "push-info": {
      const ab = await leesAbonnees();
      return json({ onderwerpen: ONDERWERPEN.map(o => ({ ...o, aantal: ab.filter(a => a.onderwerpen.includes(o.id)).length })), totaal: ab.length });
    }

    case "push-handmatig": {
      const ond = (b.onderwerpen || []).filter(o => ONDERWERPEN.some(x => x.id === o));
      if (!ond.length || !schoon(b.titel, 120)) return json({ fout: "Kies minstens één onderwerp en vul een titel in." }, 400);
      return json(await meld({ onderwerpen: ond, titel: schoon(b.titel, 120), tekst: schoon(b.tekst, 240), url: (b.url || "/").startsWith("/") ? b.url : "/" }));
    }

    case "status": {
      const env = n => globalThis.Netlify?.env?.get?.(n) ?? process.env[n] ?? "";
      const [nieuws, prijzen, abonnees, agenda, backup] = await Promise.all([leesNieuws().catch(() => null), leesPrijzen().catch(() => null), leesAbonnees().catch(() => []), leesAgenda().catch(() => []), laatsteBackup().catch(() => null)]);
      let artikelen = null;
      try {
        const r = await fetch(`${env("URL")}/data/articles.json`, { signal: AbortSignal.timeout(10000) });
        const j = await r.json(); artikelen = { bijgewerkt: j.updated, aantal: j.articles?.length || 0, nieuwste: j.articles?.[0]?.date || null };
      } catch (e) { artikelen = { fout: e.message }; }
      let wacht = 0;
      for (const f of await leesIndex()) wacht += (await leesReacties(f.id)).filter(r => r.status === "wacht").length;
      for (const r of await ruimtes()) wacht += (await leesBerichten(r.id)).filter(m => m.status === "wacht").length;
      const vandaag = new Date().toISOString().slice(0, 10);
      return json({
        nieuws: nieuws ? { bijgewerkt: nieuws.bijgewerkt, berichten: nieuws.berichten.length, vergelijkingen: nieuws.vergelijking?.length || 0, bronnen: nieuws.status } : null,
        energie: prijzen ? { bijgewerkt: prijzen.bijgewerkt, bronnen: prijzen.status } : null,
        artikelen, meldingen: { abonnees: abonnees.length },
        agenda: { komend: agenda.filter(i => (i.eind || i.start) >= vandaag).length },
        backup, wacht, eiaSleutel: !!env("EIA_API_KEY")
      });
    }

    case "herstel": {
      const ww = globalThis.Netlify?.env?.get?.("BEHEER_WACHTWOORD") ?? process.env.BEHEER_WACHTWOORD;
      try { const n = await herstel(ontsleutel(b.bestand, ww)); return json({ ok: true, items: n }); }
      catch (e) { return json({ fout: e.message }, 400); }
    }

    default:
      return json({ fout: "Onbekende actie" }, 400);
  }
};

export const config = { path: "/api/beheer" };
