import { json, type Env } from "../_lib/env";
import { ensureList } from "../_lib/list";

// Leaving the list. Three ways in:
//   - the link in every email: /unsubscribe/?t=TOKEN, where the fan presses one button
//   - one-click unsubscribe from Gmail / Apple Mail (List-Unsubscribe-Post): POST /api/unsubscribe?t=TOKEN
//   - typing an address on /unsubscribe
// The answer is the same whether or not the address was on the list, so it can't be used to check who's on it.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const t = String(url.searchParams.get("t") ?? form?.get("t") ?? "");
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  if (!env.DB) return json({ ok: false, message: "Something went wrong on our side. Email the band and we'll take you off by hand." }, 503);
  await ensureList(env.DB);

  if (/^[a-f0-9]{20,64}$/.test(t)) {
    const row = await env.DB.prepare("DELETE FROM subscribers WHERE token = ? RETURNING email").bind(t).first<{ email: string }>();
    return json({ ok: true, message: row ? `Done. ${row.email} is off the list, and you won't get any more emails from us.` : "Done. You're off the list, and you won't get any more emails from us." });
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, message: "That doesn't look like an email address. Use the one our emails reach you at." }, 400);
  }
  await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(email).run();
  return json({ ok: true, message: `Done. ${email} is off the list, and you won't get any more emails from us.` });
};
