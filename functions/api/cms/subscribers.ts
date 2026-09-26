import { json, type Data, type Env } from "../../_lib/env";
import { ensureList, ON_LIST } from "../../_lib/list";

export const onRequestGet: PagesFunction<Env, string, Data> = async ({ env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await ensureList(env.DB);
  const { results } = await env.DB.prepare(`SELECT email, name, created_at, confirmed_at, reminded_at, ${ON_LIST} AS on_list FROM subscribers ORDER BY created_at DESC`)
    .all<{ email: string; name: string | null; created_at: string; confirmed_at: string | null; reminded_at: string | null; on_list: number }>();
  return json({ ok: true, subscribers: results.map((r) => ({ ...r, on_list: !!r.on_list })) });
};

export const onRequestDelete: PagesFunction<Env, string, Data> = async ({ request, env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await ensureList(env.DB);
  const email = new URL(request.url).searchParams.get("email") ?? "";
  await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(email.toLowerCase()).run();
  return json({ ok: true });
};
