import { json, type Data, type Env } from "../../_lib/env";
import { ensureList, newToken, ON_LIST } from "../../_lib/list";
import { awsAuth, hookKey, provider, resend, sender, sendMany, type Msg } from "../../_lib/mailer";
import { fillSubject, hasUnsubscribe, personalise, toText } from "../../_lib/mailrender";

// The admin's email designer and sender.
//   GET            what's connected, the saved designs, past mailings and uploaded pictures
//   GET ?design=ID one design, with the editor's project
//   POST {action}  save | delete | duplicate | image | preview | test | create | send
// Sending goes in small batches, one request each, so a big list never hits Cloudflare's per-request
// limits; the admin page keeps asking for the next batch until everyone has it, and a daily limit just
// pauses the mailing until "Continue sending" is pressed.
const BATCH = { resend: 25, ses: 20 };
const SAMPLE = "Aoife";

async function status(env: Env, origin: string) {
  const p = provider(env), s = sender();
  const domain = s.email.split("@")[1] ?? "";
  if (p === "resend") {
    const d = await resend(env, "/domains");
    if (!d.ok) return { provider: p, ok: false, message: d.status === 401 || d.status === 403 ? "Resend didn't accept the key. Make a new one and replace RESEND_API_KEY in Cloudflare." : `Resend said ${d.status}.` };
    const mine = ((d.data?.data ?? []) as { name: string; status: string }[]).find((x) => x.name.toLowerCase() === domain.toLowerCase());
    // the bounce webhook: set up once, remembered in the database
    const hookUrl = `${origin}/api/mail-hook?k=${await hookKey(env)}`;
    const known = await env.DB!.prepare("SELECT value FROM mail_config WHERE key = 'resend_hook'").first<{ value: string }>();
    let hook = known?.value === hookUrl;
    if (!hook) {
      const made = await resend(env, "/webhooks", { method: "POST", body: JSON.stringify({ endpoint: hookUrl, events: ["email.bounced", "email.complained"] }) });
      hook = made.ok;
      if (hook) await env.DB!.prepare("INSERT OR REPLACE INTO mail_config (key, value) VALUES ('resend_hook', ?)").bind(hookUrl).run();
    }
    return { provider: p, ok: true, domain, domainStatus: mine?.status ?? "missing", hook };
  }
  if (p === "ses") {
    const region = env.AWS_REGION || "eu-west-1", host = `email.${region}.amazonaws.com`, path = "/v2/email/account";
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    try {
      const authorization = await awsAuth({ method: "GET", host, path, body: "", headers: {}, region, service: "ses", keyId: env.AWS_ACCESS_KEY_ID!, secret: env.AWS_SECRET_ACCESS_KEY!, amzDate });
      const r = await fetch((env.MAIL_API_BASE || `https://${host}`) + path, { headers: { "x-amz-date": amzDate, authorization } });
      if (r.ok) {
        const a = (await r.json()) as { ProductionAccessEnabled?: boolean; SendQuota?: { Max24HourSend?: number; SentLast24Hours?: number } };
        return { provider: p, ok: true, region, production: !!a.ProductionAccessEnabled, perDay: a.SendQuota?.Max24HourSend ?? null, sentToday: a.SendQuota?.SentLast24Hours ?? null, hookUrl: `${origin}/api/mail-hook?k=${await hookKey(env)}` };
      }
      if (r.status === 403) {
        const t = await r.text();
        if (/InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient/i.test(t)) return { provider: p, ok: false, message: "Amazon didn't accept the access keys. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Cloudflare." };
      }
    } catch { /* fall through: the keys may simply not be allowed to read the account */ }
    return { provider: p, ok: true, region, production: null, perDay: null, sentToday: null, hookUrl: `${origin}/api/mail-hook?k=${await hookKey(env)}` };
  }
  return { provider: null, ok: false };
}

export const onRequestGet: PagesFunction<Env, string, Data> = async ({ request, env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  const db = env.DB;
  await ensureList(db);
  await db.prepare("CREATE TABLE IF NOT EXISTS mail_config (key TEXT PRIMARY KEY, value TEXT)").run();
  const url = new URL(request.url);
  const one = url.searchParams.get("design");
  if (one) {
    const d = await db.prepare("SELECT id, name, subject, preheader, project, html, updated_at FROM mail_designs WHERE id = ?").bind(one).first();
    return d ? json({ ok: true, design: d }) : json({ ok: false, message: "That email isn't there any more." }, 404);
  }
  const [designs, mailings, images, count, st] = await Promise.all([
    db.prepare("SELECT id, name, subject, updated_at FROM mail_designs ORDER BY updated_at DESC").all(),
    db.prepare(`SELECT m.id, m.name, m.subject, m.created_at,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = m.id AND s.error IS NULL) AS sent,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = m.id AND s.error IS NOT NULL) AS failed,
        (SELECT COUNT(*) FROM subscribers f WHERE (f.status IS NULL OR f.status = 'confirmed') AND f.created_at <= m.created_at AND f.email NOT IN (SELECT email FROM sends s WHERE s.campaign_id = m.id)) AS remaining
      FROM mailings m ORDER BY m.created_at DESC LIMIT 12`).all(),
    db.prepare("SELECT id, type, w, h FROM mail_images ORDER BY created_at DESC LIMIT 80").all<{ id: string; type: string; w: number; h: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${ON_LIST}`).first<{ n: number }>(),
    status(env, url.origin),
  ]);
  return json({
    ok: true, status: st, sender: sender(), onList: count?.n ?? 0, designs: designs.results, mailings: mailings.results,
    images: images.results.map((i) => ({ src: `${url.origin}/mi/${i.id}.${i.type}`, width: i.w, height: i.h })),
  });
};

type Body = { action?: string; id?: string; name?: string; subject?: string; preheader?: string; project?: string; html?: string; to?: string; type?: string; data?: string; w?: number; h?: number };
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export const onRequestPost: PagesFunction<Env, string, Data> = async ({ request, env, data }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  const db = env.DB;
  await ensureList(db);
  const origin = new URL(request.url).origin;
  const raw = await request.text();
  if (raw.length > 3_500_000) return json({ ok: false, message: "That's too big to save. Use smaller pictures." }, 413);
  const b = JSON.parse(raw || "{}") as Body;

  if (b.action === "save") {
    const name = clean(b.name, 120) || "Untitled email", subject = clean(b.subject, 150), preheader = clean(b.preheader, 200);
    const project = String(b.project ?? ""), html = String(b.html ?? "");
    if (project.length > 1_900_000 || html.length > 1_900_000) return json({ ok: false, message: "This email has grown too big to save. Remove a section or two." }, 413);
    const id = b.id || newToken().slice(0, 16);
    await db.prepare(`INSERT INTO mail_designs (id, name, subject, preheader, project, html, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, subject = excluded.subject, preheader = excluded.preheader, project = excluded.project, html = excluded.html, updated_at = datetime('now')`)
      .bind(id, name, subject, preheader, project, html, data.email).run();
    return json({ ok: true, id });
  }
  if (b.action === "delete") {
    await db.prepare("DELETE FROM mail_designs WHERE id = ?").bind(String(b.id ?? "")).run();
    return json({ ok: true });
  }
  if (b.action === "duplicate") {
    const id = newToken().slice(0, 16);
    const r = await db.prepare(`INSERT INTO mail_designs (id, name, subject, preheader, project, html, created_by)
        SELECT ?, name || ' (copy)', subject, preheader, project, html, ? FROM mail_designs WHERE id = ?`).bind(id, data.email, String(b.id ?? "")).run();
    return r.meta.changes ? json({ ok: true, id }) : json({ ok: false, message: "That email isn't there any more." }, 404);
  }
  if (b.action === "image") {
    const type = b.type === "png" ? "png" : b.type === "gif" ? "gif" : "jpg";
    const b64 = String(b.data ?? "");
    if (!b64 || b64.length > 2_600_000) return json({ ok: false, message: "That picture is too big. Try a smaller one." }, 413);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const id = newToken().slice(0, 20);
    await db.prepare("INSERT INTO mail_images (id, type, data, w, h) VALUES (?, ?, ?, ?, ?)").bind(id, type, bytes, Math.round(b.w ?? 0), Math.round(b.h ?? 0)).run();
    return json({ ok: true, src: `${origin}/mi/${id}.${type}`, width: b.w ?? 0, height: b.h ?? 0 });
  }

  const draft = () => {
    const subject = clean(b.subject, 150), html = String(b.html ?? ""), preheader = clean(b.preheader, 200);
    if (!subject) return "Add a subject line first.";
    if (html.replace(/<[^>]+>/g, "").trim().length < 2 && !/<img/i.test(html)) return "The email is empty. Add something to it first.";
    return { subject, html, preheader };
  };
  if (b.action === "preview") {
    const d = draft(); if (typeof d === "string") return json({ ok: false, message: d }, 400);
    return json({ ok: true, subject: fillSubject(d.subject, SAMPLE), html: personalise(d.html, { name: SAMPLE, unsubUrl: `${origin}/unsubscribe/`, preheader: d.preheader }), ownUnsubscribe: hasUnsubscribe(d.html) });
  }

  const p = provider(env);
  if (!p) return json({ ok: false, message: "Connect an email service first (the steps are on the Mailing list page)." }, 400);

  if (b.action === "test") {
    const d = draft(); if (typeof d === "string") return json({ ok: false, message: d }, 400);
    const to = clean(b.to || data.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: false, message: "That test address doesn't look right." }, 400);
    const html = personalise(d.html, { name: SAMPLE, unsubUrl: `${origin}/unsubscribe/`, preheader: d.preheader });
    const msg: Msg = { to, subject: `[Test] ${fillSubject(d.subject, SAMPLE)}`, html, text: toText(html) };
    let [r] = await sendMany(env, [msg]);
    let viaTester = false;
    // Resend, before the sending domain is verified: its own test sender works, but only to the account owner's inbox
    if (!r.ok && p === "resend" && /domain|verif|not allowed|own email/i.test(r.message)) { [r] = await sendMany(env, [msg], "onboarding@resend.dev"); viaTester = r.ok; }
    if (r.ok) return json({ ok: true, message: `Test sent to ${to}${viaTester ? ", from Resend's test address (your own domain isn't verified yet)" : ""}. "${SAMPLE}" stands in for each fan's first name.` });
    const hint = p === "resend" && /testing emails|own email|verif|domain/i.test(r.message) ? " Until your domain is verified in Resend, tests can only go to the email address you signed up to Resend with." : "";
    return json({ ok: false, message: `${r.message}${hint}` }, 502);
  }

  if (b.action === "create") {
    const d = await db.prepare("SELECT id, name, subject, preheader, html FROM mail_designs WHERE id = ?").bind(String(b.id ?? "")).first<{ id: string; name: string; subject: string; preheader: string; html: string }>();
    if (!d) return json({ ok: false, message: "Save the email first." }, 404);
    if (!d.subject.trim()) return json({ ok: false, message: "Add a subject line first." }, 400);
    if (!d.html || d.html.length < 20) return json({ ok: false, message: "The email is empty. Add something to it first." }, 400);
    const id = newToken().slice(0, 16);
    await db.prepare("INSERT INTO mailings (id, design_id, name, subject, preheader, html, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, d.id, d.name, d.subject, d.preheader, d.html, data.email).run();
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${ON_LIST}`).first<{ n: number }>();
    return json({ ok: true, id, total: n?.n ?? 0 });
  }

  if (b.action === "send") {
    const m = await db.prepare("SELECT subject, preheader, html, created_at FROM mailings WHERE id = ?").bind(String(b.id ?? "")).first<{ subject: string; preheader: string | null; html: string; created_at: string }>();
    if (!m) return json({ ok: false, message: "That mailing isn't there any more." }, 404);
    // a mailing goes to the fans who were on the list when it was sent; anyone who joins later isn't sent old news
    const due = `${ON_LIST} AND created_at <= ? AND email NOT IN (SELECT email FROM sends WHERE campaign_id = ?)`;
    const { results: fans } = await db.prepare(`SELECT email, name, token FROM subscribers WHERE ${due} ORDER BY created_at LIMIT ${BATCH[p]}`)
      .bind(m.created_at, b.id).all<{ email: string; name: string | null; token: string | null }>();
    const log: D1PreparedStatement[] = [];
    // the plain-text copy is worked out once, with the fan's details dropped in afterwards
    const textTpl = toText(personalise(m.html, { name: "{first_name}", unsubUrl: "{unsubscribe_link}" }));
    const msgs: Msg[] = fans.map((f) => {
      if (!f.token) { f.token = newToken(); log.push(db.prepare("UPDATE subscribers SET token = ? WHERE email = ?").bind(f.token, f.email)); }
      const name = f.name ?? "", unsubUrl = `${origin}/unsubscribe/?t=${f.token}`;
      return {
        to: f.email, name, subject: fillSubject(m.subject, name), unsub: `${origin}/api/unsubscribe?t=${f.token}`,
        html: personalise(m.html, { name, unsubUrl, preheader: m.preheader ?? "" }),
        text: textTpl.replace(/\{first_name\}/g, name || "there").replace(/\{unsubscribe_link\}/g, unsubUrl),
      };
    });
    const results = msgs.length ? await sendMany(env, msgs) : [];
    let sent = 0, failed = 0, stop: string | null = null;
    results.forEach((r, i) => {
      if (r.ok) { sent++; log.push(db.prepare("INSERT OR IGNORE INTO sends (campaign_id, email) VALUES (?, ?)").bind(b.id, fans[i].email)); }
      else if (!r.stop) { failed++; log.push(db.prepare("INSERT OR IGNORE INTO sends (campaign_id, email, error) VALUES (?, ?, ?)").bind(b.id, fans[i].email, r.message.slice(0, 200))); }
      else stop = stop ?? r.message;
    });
    if (log.length) await db.batch(log);
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${due}`).bind(m.created_at, b.id).first<{ n: number }>();
    return json({ ok: true, sent, failed, remaining: left?.n ?? 0, stop });
  }
  return json({ ok: false, message: "Unknown action." }, 400);
};
