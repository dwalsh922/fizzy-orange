// The mailing list in D1. Tables are created, and older tables given new columns, on first use.
//   subscribers:  one row per fan (name, email, a private token for their unsubscribe link, and what
//                 the inbox check said). Rows with status "pending" come from an earlier version; nobody
//                 is pending now, so everything else counts as on the list.
//   email_checks: every paid inbox check, so the same address is never paid for twice and one visitor
//                 can't burn through the credits.
//   mail_designs: emails built in the admin's designer (the editor's project and the finished HTML).
//   mail_images:  pictures used in those emails, served from /mi/<id>.<type> the moment they're uploaded.
//   mailings:     a design as it was when it was sent.  sends: who each mailing has reached, so a send
//                 can stop at a daily limit and carry on later.

export const LIST_TABLE = "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))";
const COLUMNS = ["name TEXT", "status TEXT", "token TEXT", "confirmed_at TEXT", "confirm_sent_at TEXT", "reminded_at TEXT", "ip TEXT", "verified TEXT"];
export const ON_LIST = "(status IS NULL OR status = 'confirmed')";

let ready: D1Database | null = null;
export async function ensureList(db: D1Database): Promise<void> {
  if (ready === db) return;
  await db.batch([
    db.prepare(LIST_TABLE),
    db.prepare("CREATE TABLE IF NOT EXISTS email_checks (email TEXT PRIMARY KEY, result TEXT NOT NULL, reason TEXT, ip TEXT, checked_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS mail_designs (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', preheader TEXT NOT NULL DEFAULT '', project TEXT, html TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS mail_images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, w INTEGER, h INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS mailings (id TEXT PRIMARY KEY, design_id TEXT, name TEXT, subject TEXT NOT NULL, preheader TEXT, html TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sends (campaign_id TEXT NOT NULL, email TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), error TEXT, PRIMARY KEY (campaign_id, email))"),
  ]);
  const { results } = await db.prepare("PRAGMA table_info(subscribers)").all<{ name: string }>();
  const have = new Set(results.map((r) => r.name));
  for (const c of COLUMNS.filter((c) => !have.has(c.split(" ")[0]))) await db.prepare(`ALTER TABLE subscribers ADD COLUMN ${c}`).run();
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
