// Gespreksruimtes: opslag, instellingen en gedeelde regels.
import config from "../../config/ruimtes.json";
import { db } from "./flitsen.mjs";

export const MODI = ["open", "gemodereerd", "gesloten"];
export const GERESERVEERD = /(ilias|tahiri|alternatieve\s*geluid|\bhag\b|redactie|beheer|admin|moderator)/i;

export async function ruimtes() {
  const inst = (await db().get("ruimte-instellingen", { type: "json" })) || {};
  return config.ruimtes.map(r => ({ id: r.id, naam: r.naam, omschrijving: r.omschrijving, modus: inst[r.id] || r.modus || "gemodereerd" }));
}
export async function zetModus(id, modus) {
  if (!MODI.includes(modus) || !config.ruimtes.some(r => r.id === id)) return false;
  const inst = (await db().get("ruimte-instellingen", { type: "json" })) || {};
  inst[id] = modus;
  await db().setJSON("ruimte-instellingen", inst);
  return true;
}
export const bestaat = id => config.ruimtes.some(r => r.id === id);
export async function leesBerichten(id) { return bestaat(id) ? (await db().get(`ruimte/${id}`, { type: "json" })) || [] : []; }
export async function bewaarBerichten(id, lijst) { await db().setJSON(`ruimte/${id}`, lijst.slice(-3000)); }
export const publiek = b => ({ id: b.id, naam: b.naam, tekst: b.tekst, tijd: b.tijd, antwoordOp: b.antwoordOp || null, redactie: !!b.redactie });
