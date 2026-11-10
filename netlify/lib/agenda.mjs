// Agenda: toppen, onderhandelingen en vaststaande ontwikkelingen.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import start from "../../config/agenda-start.json";

export const STATUSSEN = ["officieel", "deels", "speculatie"];
const store = () => getStore({ name: "agenda", consistency: "strong" });

export async function leesAgenda() {
  let a = await store().get("items", { type: "json" });
  if (!a) {
    a = start.items.map(i => ({ id: crypto.randomBytes(6).toString("hex"), ...i, bijgewerkt: new Date().toISOString() }));
    await store().setJSON("items", a);
  }
  return a.sort((x, y) => x.start.localeCompare(y.start));
}
export async function bewaarAgenda(a) { await store().setJSON("items", a); }
