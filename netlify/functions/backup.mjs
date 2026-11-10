// /api/backup: versleutelde back-up, alleen met het beheerwachtwoord (header x-beheer).
import { isBeheerder } from "../lib/flitsen.mjs";
import { maakBackup, versleutel, noteerBackup } from "../lib/backup.mjs";
export default async (req) => {
  if (!isBeheerder(req)) { await new Promise(r => setTimeout(r, 1200)); return Response.json({ fout: "Geen toegang" }, { status: 401 }); }
  const ww = globalThis.Netlify?.env?.get?.("BEHEER_WACHTWOORD") ?? process.env.BEHEER_WACHTWOORD;
  const b = versleutel(await maakBackup(), ww);
  await noteerBackup();
  return new Response(JSON.stringify(b), { headers: { "content-type": "application/json", "cache-control": "no-store", "content-disposition": `attachment; filename="hag-backup-${b.gemaakt.slice(0, 10)}.json"` } });
};
export const config = { path: "/api/backup" };
