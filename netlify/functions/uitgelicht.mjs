// Openbaar: /api/uitgelicht → per dossier of sectie de artikelen die de redactie uitlicht.
import { db } from "../lib/flitsen.mjs";
export default async () => {
  const u = (await db().get("uitgelicht", { type: "json" })) || {};
  return Response.json(u, { headers: { "cache-control": "public, max-age=60", "netlify-cdn-cache-control": "public, s-maxage=120, stale-while-revalidate=600" } });
};
export const config = { path: "/api/uitgelicht" };
