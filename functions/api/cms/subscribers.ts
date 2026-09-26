import { json, type Data, type Env } from "../../_lib/env";

import { LIST_TABLE as TABLE } from "../../_lib/list";

export const onRequestGet: PagesFunction<Env, string, Data> = async ({ env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await env.DB.prepare(TABLE).run();
  const { results } = await env.DB.prepare("SELECT email, created_at FROM subscribers ORDER BY created_at DESC").all<{ email: string; created_at: string }>();
  return json({ ok: true, subscribers: results });
};

export const onRequestDelete: PagesFunction<Env, string, Data> = async ({ request, env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  const email = new URL(request.url).searchParams.get("email") ?? "";
  await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(email.toLowerCase()).run();
  return json({ ok: true });
};
