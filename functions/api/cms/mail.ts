import { json, type Data, type Env } from "../../_lib/env";
import { brevo, brevoOn, hookKey, senderEmail, sendMail } from "../../_lib/brevo";
import { ensureList, newToken, ON_LIST } from "../../_lib/list";
import { campaignEmail, confirmEmail, type Draft } from "../../_lib/templates";

// The admin's "Write an email". GET: is Brevo set up, and the emails sent so far.
// POST { action }: "preview" | "test" | "create" | "send" (the next batch of a campaign) | "remind" (unconfirmed fans).
// Sending goes in small batches, one request each, so a big list never hits Cloudflare's per-request limits;
// the admin page keeps asking for the next batch until everyone has it.
const BATCH = 20;

export const onRequestGet: PagesFunction<Env, string, Data> = async ({ request, env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await ensureList(env.DB);
  const db = env.DB;
  const counts = await db.prepare(`SELECT SUM(${ON_LIST}) AS on_list, SUM(status = 'pending') AS pending,
      SUM(status = 'pending' AND reminded_at IS NULL AND (confirm_sent_at IS NULL OR confirm_sent_at < datetime('now', '-1 day'))) AS remindable FROM subscribers`)
    .first<{ on_list: number | null; pending: number | null; remindable: number | null }>();
  const { results: campaigns } = await db.prepare(`SELECT c.id, c.subject, c.created_at, c.created_by,
      (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = c.id AND s.error IS NULL) AS sent,
      (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = c.id AND s.error IS NOT NULL) AS failed,
      (SELECT COUNT(*) FROM subscribers f WHERE ${ON_LIST.replace(/status/g, "f.status")} AND f.email NOT IN (SELECT email FROM sends s WHERE s.campaign_id = c.id)) AS remaining
    FROM campaigns c ORDER BY c.created_at DESC LIMIT 10`).all();
  const out: Record<string, unknown> = {
    ok: true, configured: brevoOn(env), sender: senderEmail(),
    counts: { on_list: counts?.on_list ?? 0, pending: counts?.pending ?? 0, remindable: counts?.remindable ?? 0 }, campaigns,
  };
  if (!brevoOn(env)) return json(out);

  // Brevo's side: the key works, the sender is verified, how many emails are left today, and the bounce webhook
  const [account, senders, domains] = await Promise.all([brevo(env, "/account"), brevo(env, "/senders"), brevo(env, "/senders/domains")]);
  if (!account.ok) return json({ ...out, brevo: { keyOk: false, message: account.data?.message ?? `Brevo said ${account.status}` } });
  const plan = (account.data.plan ?? []) as { type: string; credits: number; creditsType: string }[];
  const daily = plan.find((p) => p.creditsType === "sendLimit");
  const from = senderEmail().toLowerCase();
  const sender = ((senders.data.senders ?? []) as { email: string; active: boolean }[]).find((s) => s.email.toLowerCase() === from);
  const domain = ((domains.data.domains ?? []) as { domain_name: string; authenticated: boolean }[]).find((d) => from.endsWith("@" + d.domain_name.toLowerCase()));
  const hookUrl = `${new URL(request.url).origin}/api/brevo-hook?k=${await hookKey(env)}`;
  const hooks = await brevo(env, "/webhooks?type=transactional");
  let hook = ((hooks.data.webhooks ?? []) as { url: string }[]).some((w) => w.url === hookUrl);
  if (!hook && hooks.ok) {
    const made = await brevo(env, "/webhooks", { method: "POST", body: JSON.stringify({ url: hookUrl, type: "transactional", description: "Fizzy Orange website: remove addresses that bounce", events: ["hardBounce", "invalid", "spam", "unsubscribed", "blocked"] }) });
    hook = made.ok;
  }
  return json({ ...out, brevo: { keyOk: true, senderOk: !!sender?.active, senderKnown: !!sender, domainOk: !!domain?.authenticated, leftToday: daily ? daily.credits : null, hook } });
};

type Body = Draft & { action?: string; id?: string; to?: string };

export const onRequestPost: PagesFunction<Env, string, Data> = async ({ request, env, data }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await ensureList(env.DB);
  const db = env.DB;
  const origin = new URL(request.url).origin;
  const b = (await request.json().catch(() => ({}))) as Body;
  const draft = (): Draft | string => {
    const subject = String(b.subject ?? "").trim().slice(0, 150), message = String(b.message ?? "").trim().slice(0, 20000);
    const button_text = String(b.button_text ?? "").trim().slice(0, 60), button_url = String(b.button_url ?? "").trim();
    if (!subject) return "Add a subject.";
    if (!message) return "Write the message first.";
    if (button_text && !/^https:\/\/\S+$/.test(button_url)) return "The button's link needs to start with https://";
    return { subject, message, button_text: button_text || null, button_url: button_text ? button_url : null };
  };

  if (b.action === "preview") {
    const d = draft(); if (typeof d === "string") return json({ ok: false, message: d }, 400);
    return json({ ok: true, ...campaignEmail(origin, d, { name: "Aoife", unsubUrl: `${origin}/unsubscribe/` }) });
  }
  if (!brevoOn(env)) return json({ ok: false, message: "Connect Brevo first (see the steps on this page)." }, 400);

  if (b.action === "test") {
    const d = draft(); if (typeof d === "string") return json({ ok: false, message: d }, 400);
    const to = String(b.to || data.email).trim().toLowerCase();
    const m = campaignEmail(origin, d, { name: "Aoife", unsubUrl: `${origin}/unsubscribe/` });
    const r = await sendMail(env, { to: { email: to }, ...m, subject: `[Test] ${m.subject}`, tag: "test" });
    return r.ok ? json({ ok: true, message: `Test sent to ${to}. "Aoife" stands in for each fan's first name.` }) : json({ ok: false, message: `Brevo: ${r.message}` }, 502);
  }

  if (b.action === "create") {
    const d = draft(); if (typeof d === "string") return json({ ok: false, message: d }, 400);
    const id = newToken().slice(0, 16);
    await db.prepare("INSERT INTO campaigns (id, subject, message, button_text, button_url, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, d.subject, d.message, d.button_text, d.button_url, data.email).run();
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${ON_LIST}`).first<{ n: number }>();
    return json({ ok: true, id, total: n?.n ?? 0 });
  }

  if (b.action === "send") {
    const c = await db.prepare("SELECT subject, message, button_text, button_url FROM campaigns WHERE id = ?").bind(String(b.id ?? "")).first<Draft>();
    if (!c) return json({ ok: false, message: "That email isn't there any more." }, 404);
    const { results: fans } = await db.prepare(`SELECT email, name, token FROM subscribers WHERE ${ON_LIST} AND email NOT IN (SELECT email FROM sends WHERE campaign_id = ?) ORDER BY created_at LIMIT ${BATCH}`)
      .bind(b.id).all<{ email: string; name: string | null; token: string | null }>();
    let sent = 0, failed = 0, stop: string | null = null;
    const log: D1PreparedStatement[] = [];
    for (const f of fans) {
      if (!f.token) { f.token = newToken(); log.push(db.prepare("UPDATE subscribers SET token = ? WHERE email = ?").bind(f.token, f.email)); }
      const unsubUrl = `${origin}/unsubscribe/?t=${f.token}`;
      const m = campaignEmail(origin, c, { name: f.name ?? "", unsubUrl });
      const r = await sendMail(env, {
        to: { email: f.email, name: f.name ?? undefined }, ...m, tag: "list",
        headers: { "List-Unsubscribe": `<${origin}/api/unsubscribe?t=${f.token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      if (r.ok) { sent++; log.push(db.prepare("INSERT OR IGNORE INTO sends (campaign_id, email) VALUES (?, ?)").bind(b.id, f.email)); }
      else if (!r.stop) { failed++; log.push(db.prepare("INSERT OR IGNORE INTO sends (campaign_id, email, error) VALUES (?, ?, ?)").bind(b.id, f.email, r.message.slice(0, 200))); }
      else { stop = r.message; break; }
    }
    if (log.length) await db.batch(log);
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${ON_LIST} AND email NOT IN (SELECT email FROM sends WHERE campaign_id = ?)`).bind(b.id).first<{ n: number }>();
    return json({ ok: true, sent, failed, remaining: left?.n ?? 0, stop });
  }

  if (b.action === "remind") {
    const { results: fans } = await db.prepare(`SELECT email, name, token FROM subscribers WHERE status = 'pending' AND reminded_at IS NULL
        AND (confirm_sent_at IS NULL OR confirm_sent_at < datetime('now', '-1 day')) ORDER BY created_at LIMIT ${BATCH}`).all<{ email: string; name: string | null; token: string }>();
    let sent = 0, stop: string | null = null;
    const log: D1PreparedStatement[] = [];
    for (const f of fans) {
      const first = !f.token; // pending rows always have a token; this is belt and braces
      if (first) { f.token = newToken(); log.push(db.prepare("UPDATE subscribers SET token = ? WHERE email = ?").bind(f.token, f.email)); }
      const m = confirmEmail(origin, f.name ?? "", `${origin}/api/confirm?t=${f.token}`, true);
      const r = await sendMail(env, { to: { email: f.email, name: f.name ?? undefined }, ...m, tag: "reminder" });
      if (r.ok || !r.stop) { if (r.ok) sent++; log.push(db.prepare("UPDATE subscribers SET reminded_at = datetime('now'), confirm_sent_at = datetime('now') WHERE email = ?").bind(f.email)); }
      else { stop = r.message; break; }
    }
    if (log.length) await db.batch(log);
    const left = await db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE status = 'pending' AND reminded_at IS NULL AND (confirm_sent_at IS NULL OR confirm_sent_at < datetime('now', '-1 day'))").first<{ n: number }>();
    return json({ ok: true, sent, remaining: left?.n ?? 0, stop });
  }
  return json({ ok: false, message: "Unknown action." }, 400);
};
