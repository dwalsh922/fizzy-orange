import { json, type Env } from "../_lib/env";
import { hookKey } from "../_lib/brevo";
import { ensureList } from "../_lib/list";

// Brevo calls this when an email can't be delivered (the inbox doesn't exist), is marked as spam,
// or is unsubscribed from inside the email app. Those addresses leave the list automatically.
// The admin registers this webhook with Brevo; the ?k= secret keeps anyone else from calling it.
const DROP = new Set(["hard_bounce", "hardbounce", "invalid_email", "invalid", "spam", "complaint", "unsubscribed", "unsubscribe", "blocked"]);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BREVO_API_KEY || !env.DB) return json({ ok: false }, 503);
  if (new URL(request.url).searchParams.get("k") !== (await hookKey(env))) return json({ ok: false }, 403);
  const body = await request.json().catch(() => null);
  const events = (Array.isArray(body) ? body : [body]).filter(Boolean) as { event?: string; email?: string }[];
  const gone = events.filter((e) => e.email && DROP.has(String(e.event ?? "").toLowerCase().replace(/[\s-]/g, "_"))).map((e) => String(e.email).toLowerCase());
  if (gone.length) {
    await ensureList(env.DB);
    await env.DB.batch(gone.map((e) => env.DB!.prepare("DELETE FROM subscribers WHERE email = ?").bind(e)));
  }
  return json({ ok: true, removed: gone.length });
};
