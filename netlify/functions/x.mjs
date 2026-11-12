// Openbaar: /api/x → de X-commentaren die de redactie heeft toegevoegd.
import { leesPosts } from "../lib/xposts.mjs";
export default async () => Response.json({ posts: await leesPosts() }, { headers: { "cache-control": "public, max-age=60", "netlify-cdn-cache-control": "public, s-maxage=120, stale-while-revalidate=600" } });
export const config = { path: "/api/x" };
