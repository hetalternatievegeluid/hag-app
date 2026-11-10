// Back-up van alles wat in Netlify Blobs staat (flitsen, reacties, gesprekken, agenda, duidingen, meldingen).
// De back-up wordt versleuteld met BEHEER_WACHTWOORD, zodat hij veilig in een openbare GitHub-repository kan staan.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const OPSLAG = [
  { naam: "flitsen", overslaan: k => k.startsWith("limiet/") },
  { naam: "agenda" },
  { naam: "energie", overslaan: k => k === "prijzen" },
  { naam: "push" }
];
const st = n => getStore({ name: n, consistency: "strong" });

export async function maakBackup() {
  const data = {};
  for (const o of OPSLAG) {
    data[o.naam] = {};
    const { blobs } = await st(o.naam).list();
    for (const { key } of blobs) {
      if (o.overslaan?.(key)) continue;
      data[o.naam][key] = await st(o.naam).get(key, { type: "json" });
    }
  }
  return { gemaakt: new Date().toISOString(), versie: 1, data };
}
export function versleutel(obj, wachtwoord) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(wachtwoord, salt, 32), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return { formaat: "hag-backup-1", gemaakt: obj.gemaakt, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: enc.toString("base64") };
}
export function ontsleutel(b, wachtwoord) {
  if (b?.formaat !== "hag-backup-1") throw new Error("Dit is geen back-upbestand van de app.");
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(wachtwoord, Buffer.from(b.salt, "base64"), 32), Buffer.from(b.iv, "base64"));
  d.setAuthTag(Buffer.from(b.tag, "base64"));
  try { return JSON.parse(Buffer.concat([d.update(Buffer.from(b.data, "base64")), d.final()]).toString("utf8")); }
  catch { throw new Error("Deze back-up kan niet worden geopend. Is hij gemaakt met een ander wachtwoord?"); }
}
export async function herstel(obj) {
  let n = 0;
  for (const [naam, items] of Object.entries(obj.data || {})) {
    if (!OPSLAG.some(o => o.naam === naam)) continue;
    for (const [k, v] of Object.entries(items)) if (v !== null) { await st(naam).setJSON(k, v); n++; }
  }
  return n;
}
export async function noteerBackup() { await st("flitsen").setJSON("laatste-backup", { tijd: new Date().toISOString() }); }
export async function laatsteBackup() { return (await st("flitsen").get("laatste-backup", { type: "json" }))?.tijd || null; }
