// The mailing list in D1. Tables are created, and older tables given new columns, on first use.
//   subscribers: one row per fan. status "pending" = waiting to confirm; "confirmed" (or empty, for
//                sign-ups from before confirmation emails) = on the list.
//   campaigns:   emails written in the admin.  sends: who each one has gone to, so a send can resume.

export const LIST_TABLE = "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))";
const COLUMNS = ["name TEXT", "status TEXT", "token TEXT", "confirmed_at TEXT", "confirm_sent_at TEXT", "reminded_at TEXT", "ip TEXT"];
const ON_LIST = "(status IS NULL OR status = 'confirmed')";
export { ON_LIST };

let ready: D1Database | null = null;
export async function ensureList(db: D1Database): Promise<void> {
  if (ready === db) return;
  await db.batch([
    db.prepare(LIST_TABLE),
    db.prepare("CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, subject TEXT NOT NULL, message TEXT NOT NULL, button_text TEXT, button_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sends (campaign_id TEXT NOT NULL, email TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), error TEXT, PRIMARY KEY (campaign_id, email))"),
  ]);
  const { results } = await db.prepare("PRAGMA table_info(subscribers)").all<{ name: string }>();
  const have = new Set(results.map((r) => r.name));
  const missing = COLUMNS.filter((c) => !have.has(c.split(" ")[0]));
  for (const c of missing) await db.prepare(`ALTER TABLE subscribers ADD COLUMN ${c}`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS subscribers_token ON subscribers (token)").run();
  ready = db;
}

export const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40);

/** "aoife" -> "Aoife"; trims, and keeps it to a sensible length. */
export function cleanName(raw: unknown): string {
  const n = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return n && n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1) : n;
}

export async function hashIp(ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fizzy-orange:" + ip));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
