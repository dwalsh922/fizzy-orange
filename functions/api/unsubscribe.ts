import { json, type Env } from "../_lib/env";
import { LIST_TABLE } from "../_lib/list";

// Public unsubscribe: the fan types their address on /unsubscribe and it's deleted from D1 straight away.
// The answer is the same whether or not the address was on the list, so the page can't be used to check who's on it.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, message: "That doesn't look like an email address. Use the one our emails reach you at." }, 400);
  }
  if (!env.DB) return json({ ok: false, message: "Something went wrong on our side. Email the band and we'll take you off by hand." }, 503);
  await env.DB.batch([env.DB.prepare(LIST_TABLE), env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(email)]);
  return json({ ok: true, message: `Done. ${email} is off the list, and you won't get any more emails from us.` });
};
