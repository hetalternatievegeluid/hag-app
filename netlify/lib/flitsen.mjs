// Gedeelde hulpjes voor flitsen, reacties en de beheerpagina.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import moderatie from "../../config/moderatie.json";

export const LABELS = ["bevestigd", "claim", "onbevestigd"];
export const db = () => getStore({ name: "flitsen", consistency: "strong" });
export const json = (data, status = 200, cache = "no-store") =>
  Response.json(data, { status, headers: { "cache-control": cache } });
export const nieuwId = () => crypto.randomBytes(6).toString("hex");

export function schoon(s, max) {
  return String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n/g, "\n").trim().slice(0, max);
}
export function schoonUrl(u) {
  try { const x = new URL(String(u || "").trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; }
}
function env(naam) {
  return globalThis.Netlify?.env?.get?.(naam) ?? process.env[naam] ?? "";
}

export async function leesIndex() { return (await db().get("index", { type: "json" })) || []; }
export async function leesFlits(id) { return /^[a-f0-9]{12}$/.test(id || "") ? await db().get(`flits/${id}`, { type: "json" }) : null; }
export async function bewaarFlits(f) {
  f.bijgewerkt = new Date().toISOString();
  await db().setJSON(`flits/${f.id}`, f);
  const idx = (await leesIndex()).filter(x => x.id !== f.id);
  idx.push({ id: f.id, titel: f.titel, sectie: f.sectie, status: f.status, chat: f.chat, gemaakt: f.gemaakt, bijgewerkt: f.bijgewerkt, updates: f.updates.length, laatste: f.updates[0] || null });
  idx.sort((a, b) => b.bijgewerkt.localeCompare(a.bijgewerkt));
  await db().setJSON("index", idx);
  return f;
}
export async function verwijderFlits(id) {
  await db().delete(`flits/${id}`);
  await db().delete(`reacties/${id}`);
  await db().setJSON("index", (await leesIndex()).filter(x => x.id !== id));
}
export async function leesReacties(id) { return (await db().get(`reacties/${id}`, { type: "json" })) || []; }
export async function bewaarReacties(id, r) { await db().setJSON(`reacties/${id}`, r); }

export function isBeheerder(req) {
  const w = env("BEHEER_WACHTWOORD");
  if (w.length < 8) return false;
  const a = crypto.createHash("sha256").update(w).digest();
  const b = crypto.createHash("sha256").update(req.headers.get("x-beheer") || "").digest();
  return crypto.timingSafeEqual(a, b);
}

// Spamrem: maximaal 5 acties per 10 minuten per verbinding. Er wordt geen IP-adres bewaard,
// alleen een versleutelde code die per dag verandert en na tien minuten niet meer meetelt.
export async function binnenLimiet(ip, max = 5, venster = 10 * 60e3) {
  const dag = new Date().toISOString().slice(0, 10);
  const code = crypto.createHash("sha256").update(`${ip}|${dag}|${env("BEHEER_WACHTWOORD") || "hag"}`).digest("hex").slice(0, 24);
  const sleutel = `limiet/${code}`;
  const nu = Date.now();
  const lijst = ((await db().get(sleutel, { type: "json" })) || []).filter(t => nu - t < venster);
  if (lijst.length >= max) return false;
  lijst.push(nu);
  await db().setJSON(sleutel, lijst);
  return true;
}

export function moetWachten(tekst) {
  const t = tekst.toLowerCase();
  if (/https?:\/\/|www\.|\.[a-z]{2,4}\//i.test(tekst)) return true;
  return (moderatie.woorden || []).some(w => w && t.includes(w.toLowerCase()));
}
