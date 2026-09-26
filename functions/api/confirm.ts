import { type Env } from "../_lib/env";
import { ensureList } from "../_lib/list";

// The link in the confirmation email. Moves the fan from "pending" to the list, then shows the /join page's welcome.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const t = url.searchParams.get("t") ?? "";
  let ok = false;
  if (env.DB && /^[a-f0-9]{20,64}$/.test(t)) {
    await ensureList(env.DB);
    const r = await env.DB.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, datetime('now')) WHERE token = ?").bind(t).run();
    ok = r.meta.changes > 0;
  }
  return Response.redirect(`${url.origin}/join/?${ok ? "welcome" : "expired"}=1`, 302);
};
