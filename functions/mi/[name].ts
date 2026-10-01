import type { Env } from "../_lib/env";

// Pictures used in emails, straight from the database: /mi/<id>.jpg (or .png, .gif).
// They never change once uploaded, so email apps and browsers may keep them for good.
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif" };

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const m = /^([a-f0-9]{8,40})\.(jpg|png|gif)$/.exec(String(params.name ?? ""));
  if (!m || !env.DB) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare("SELECT type, data FROM mail_images WHERE id = ?").bind(m[1]).first<{ type: string; data: ArrayBuffer | number[] }>().catch(() => null);
  if (!row) return new Response("Not found", { status: 404 });
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data as number[]);
  return new Response(bytes, { headers: { "content-type": TYPES[row.type] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
};
