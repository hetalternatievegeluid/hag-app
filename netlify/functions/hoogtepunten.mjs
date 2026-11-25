// Openbaar: /api/hoogtepunten → hoogtepunten van vandaag, deze week en deze maand.
import { leesHoogtepunten } from "../lib/hoogtepunten.mjs";
export default async () => Response.json(await leesHoogtepunten(), {
  headers: { "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600" }
});
export const config = { path: "/api/hoogtepunten" };
