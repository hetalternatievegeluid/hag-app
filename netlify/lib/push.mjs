// Pushmeldingen: sleutels, abonnees en verzenden. De sleutels worden bij het eerste gebruik
// automatisch aangemaakt en in Netlify Blobs bewaard, dus er hoeft niets ingesteld te worden.
import webpush from "web-push";
import { getStore } from "@netlify/blobs";
import nieuws from "../../config/nieuws.json";

const store = () => getStore({ name: "push", consistency: "strong" });
export const ONDERWERPEN = [{ id: "artikelen", naam: "Alle nieuwe artikelen" }, ...nieuws.secties.map(s => ({ id: s.id, naam: s.naam }))];
const geldig = new Set(ONDERWERPEN.map(o => o.id));

async function sleutels() {
  let k = await store().get("vapid", { type: "json" });
  if (!k) { k = webpush.generateVAPIDKeys(); await store().setJSON("vapid", k); }
  return k;
}
export async function publiekeSleutel() { return (await sleutels()).publicKey; }
export async function leesAbonnees() { return (await store().get("abonnees", { type: "json" })) || []; }
async function bewaarAbonnees(l) { await store().setJSON("abonnees", l); }

export async function abonneer(sub, onderwerpen) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Ongeldig abonnement");
  const o = [...new Set((onderwerpen || []).filter(x => geldig.has(x)))];
  let lijst = (await leesAbonnees()).filter(a => a.endpoint !== sub.endpoint);
  if (o.length) lijst.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, onderwerpen: o, sinds: new Date().toISOString() });
  await bewaarAbonnees(lijst.slice(-20000));
  return o;
}
export async function afmelden(endpoint) { await bewaarAbonnees((await leesAbonnees()).filter(a => a.endpoint !== endpoint)); }
export async function onderwerpenVan(endpoint) { return (await leesAbonnees()).find(a => a.endpoint === endpoint)?.onderwerpen || []; }

export async function stuur({ onderwerpen, titel, tekst, url, tag }) {
  const k = await sleutels();
  webpush.setVapidDetails("mailto:hetalternatievegeluid@gmail.com", k.publicKey, k.privateKey);
  const alle = await leesAbonnees();
  const doel = alle.filter(a => a.onderwerpen.some(o => onderwerpen.includes(o)));
  const payload = JSON.stringify({ titel: String(titel).slice(0, 120), tekst: String(tekst || "").slice(0, 240), url: url || "/", tag: tag || undefined });
  const weg = new Set();
  let verstuurd = 0;
  for (let i = 0; i < doel.length; i += 50) {
    const res = await Promise.allSettled(doel.slice(i, i + 50).map(a => webpush.sendNotification(a, payload, { TTL: 12 * 3600, urgency: "normal" })));
    res.forEach((r, j) => {
      if (r.status === "fulfilled") verstuurd++;
      else if ([404, 410].includes(r.reason?.statusCode)) weg.add(doel[i + j].endpoint);
    });
  }
  if (weg.size) await bewaarAbonnees(alle.filter(a => !weg.has(a.endpoint)));
  return { bereik: doel.length, verstuurd, verwijderd: weg.size };
}
