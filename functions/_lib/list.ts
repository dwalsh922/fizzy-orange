// The mailing list table in D1, created on first use.
export const LIST_TABLE = "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))";
