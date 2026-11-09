// Openbaar: /api/flitsen (lijst) en /api/flitsen?id=... (één flits met tijdlijn)
import { json, leesIndex, leesFlits } from "../lib/flitsen.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const f = await leesFlits(id);
    return f ? json(f, 200, "public, max-age=30") : json({ fout: "Flits niet gevonden" }, 404);
  }
  const idx = await leesIndex();
  const lijst = [...idx.filter(f => f.status === "actief"), ...idx.filter(f => f.status !== "actief").slice(0, 30)];
  return json({ flitsen: lijst }, 200, "public, max-age=30");
};

export const config = { path: "/api/flitsen" };
