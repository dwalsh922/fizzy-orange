import { json, type Data, type Env } from "../../_lib/env";
import { ensureList, newToken, ON_LIST } from "../../_lib/list";
import { awsAuth, hookKey, provider, resend, sender, senderProblem, sendMany, type Msg, type Provider } from "../../_lib/mailer";
import { fillSubject, hasUnsubscribe, personalise, toText } from "../../_lib/mailrender";
import { getWelcome, NOT_WELCOMED, renderWelcome, saveWelcome, sendWelcomes, WELCOME_DEFAULT, WELCOME_ID } from "../../_lib/welcome";

// The admin's email designer and sender.
//   GET            what's connected, the saved designs, past mailings and uploaded pictures
//   GET ?design=ID one design, with the editor's project
//   POST {action}  save | delete | duplicate | image | preview | test | create | send
//                  welcome-save | welcome-test | welcome-catchup   (the automatic welcome email)
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
    return { provider: p, ok: true, senderProblem: senderProblem(), domain, domainStatus: mine?.status ?? "missing", hook };
  }
  if (p === "ses") {
    const region = env.AWS_REGION || "eu-west-1", host = `email.${region}.amazonaws.com`, path = "/v2/email/account";
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    try {
      const authorization = await awsAuth({ method: "GET", host, path, body: "", headers: {}, region, service: "ses", keyId: env.AWS_ACCESS_KEY_ID!, secret: env.AWS_SECRET_ACCESS_KEY!, amzDate });
      const r = await fetch((env.MAIL_API_BASE || `https://${host}`) + path, { headers: { "x-amz-date": amzDate, authorization } });
      if (r.ok) {
        const a = (await r.json()) as { ProductionAccessEnabled?: boolean; SendQuota?: { Max24HourSend?: number; SentLast24Hours?: number } };
        return { provider: p, ok: true, senderProblem: senderProblem(), region, production: !!a.ProductionAccessEnabled, perDay: a.SendQuota?.Max24HourSend ?? null, sentToday: a.SendQuota?.SentLast24Hours ?? null, hookUrl: `${origin}/api/mail-hook?k=${await hookKey(env)}` };
      }
      if (r.status === 403) {
        const t = await r.text();
        if (/InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient/i.test(t)) return { provider: p, ok: false, message: "Amazon didn't accept the access keys. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Cloudflare." };
      }
    } catch { /* fall through: the keys may simply not be allowed to read the account */ }
    return { provider: p, ok: true, senderProblem: senderProblem(), region, production: null, perDay: null, sentToday: null, hookUrl: `${origin}/api/mail-hook?k=${await hookKey(env)}` };
  }
  return { provider: null, ok: false };
}

export const onRequestGet: PagesFunction<Env, string, Data> = async ({ request, env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  const db = env.DB;
  await ensureList(db);
  const url = new URL(request.url);
  const one = url.searchParams.get("design");
  if (one) {
    const d = await db.prepare("SELECT id, name, subject, preheader, project, html, updated_at FROM mail_designs WHERE id = ?").bind(one).first();
    return d ? json({ ok: true, design: d }) : json({ ok: false, message: "That email isn't there any more." }, 404);
  }
  const [designs, mailings, images, count, st, welcome, welcomeCounts, welcomeProblem] = await Promise.all([
    db.prepare("SELECT id, name, subject, updated_at FROM mail_designs ORDER BY updated_at DESC").all(),
    db.prepare(`SELECT m.id, m.name, m.subject, m.created_at,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = m.id AND s.error IS NULL) AS sent,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = m.id AND s.error IS NOT NULL) AS failed,
        (SELECT COUNT(*) FROM subscribers f WHERE (f.status IS NULL OR f.status = 'confirmed') AND f.created_at <= m.created_at AND f.email NOT IN (SELECT email FROM sends s WHERE s.campaign_id = m.id)) AS remaining
      FROM mailings m ORDER BY m.created_at DESC LIMIT 12`).all(),
    db.prepare("SELECT id, type, w, h FROM mail_images ORDER BY created_at DESC LIMIT 80").all<{ id: string; type: string; w: number; h: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${ON_LIST}`).first<{ n: number }>(),
    status(env, url.origin),
    getWelcome(db),
    db.prepare(`SELECT (SELECT COUNT(*) FROM sends WHERE campaign_id = '${WELCOME_ID}' AND error IS NULL) AS sent, (SELECT COUNT(*) FROM subscribers WHERE ${NOT_WELCOMED}) AS waiting`).first<{ sent: number; waiting: number }>(),
    db.prepare("SELECT value FROM mail_config WHERE key = 'welcome_problem'").first<{ value: string }>(),
  ]);
  return json({
    ok: true, status: st, sender: sender(), onList: count?.n ?? 0, designs: designs.results, mailings: mailings.results,
    images: images.results.map((i) => ({ src: `${url.origin}/mi/${i.id}.${i.type}`, width: i.w, height: i.h })),
    welcome: { ...welcome, defaults: WELCOME_DEFAULT, sent: welcomeCounts?.sent ?? 0, waiting: welcomeCounts?.waiting ?? 0, problem: welcomeProblem ? JSON.parse(welcomeProblem.value) : null },
  });
};

type Body = { action?: string; id?: string; name?: string; subject?: string; preheader?: string; project?: string; html?: string; to?: string; type?: string; data?: string; w?: number; h?: number; on?: boolean; body?: string };
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const cleanBody = (v: unknown) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 5000);

/** Sends one test email. Resend lends a test sender (onboarding@resend.dev) that delivers only to the account
 *  owner's own inbox; it's used when there's no sending address yet, or the address's domain isn't verified. */
async function testSend(env: Env, p: Provider, msg: Msg): Promise<Response> {
  const noSender = !!senderProblem();
  if (noSender && p !== "resend") return json({ ok: false, message: senderProblem() }, 400);
  let viaTester = noSender;
  let [r] = await sendMany(env, [msg], noSender ? "onboarding@resend.dev" : undefined);
  if (!r.ok && !noSender && p === "resend" && /domain|verif|not allowed|own email/i.test(r.message)) { [r] = await sendMany(env, [msg], "onboarding@resend.dev"); viaTester = r.ok; }
  if (r.ok) return json({ ok: true, message: `Test sent to ${msg.to}${viaTester ? ", from Resend's test address" : ""}. "${SAMPLE}" stands in for each fan's first name.` });
  const hint = p === "resend" && /testing emails|own email|verif|domain/i.test(r.message) ? " Until a sending domain is verified in Resend, tests can only go to the email address you signed up to Resend with." : "";
  return json({ ok: false, message: `${r.message}${hint}` }, 502);
}
const testAddress = (b: Body, fallback: string) => {
  const to = clean(b.to || fallback, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ? to : null;
};

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

  // saving works with no email service connected, so it comes before that check
  if (b.action === "welcome-save") {
    const subject = clean(b.subject, 150), body = cleanBody(b.body);
    if (!subject) return json({ ok: false, message: "Add a subject line first." }, 400);
    if (body.length < 2) return json({ ok: false, message: "The email is empty. Write something first." }, 400);
    await saveWelcome(db, { on: !!b.on, subject, body });
    return json({ ok: true });
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
    const to = testAddress(b, data.email);
    if (!to) return json({ ok: false, message: "That test address doesn't look right." }, 400);
    const html = personalise(d.html, { name: SAMPLE, unsubUrl: `${origin}/unsubscribe/`, preheader: d.preheader });
    return testSend(env, p, { to, subject: `[Test] ${fillSubject(d.subject, SAMPLE)}`, html, text: toText(html) });
  }

  if (b.action === "welcome-test") {
    const subject = clean(b.subject, 150), body = cleanBody(b.body);
    if (!subject) return json({ ok: false, message: "Add a subject line first." }, 400);
    if (body.length < 2) return json({ ok: false, message: "The email is empty. Write something first." }, 400);
    const to = testAddress(b, data.email);
    if (!to) return json({ ok: false, message: "That test address doesn't look right." }, 400);
    const w = renderWelcome({ subject, body }, { name: SAMPLE, unsubUrl: `${origin}/unsubscribe/` });
    return testSend(env, p, { to, subject: `[Test] ${w.subject}`, html: w.html, text: w.text });
  }

  // the welcome email for fans who haven't had it, a batch per request like a mailing
  if (b.action === "welcome-catchup") {
    const { results: fans } = await db.prepare(`SELECT email, name, token FROM subscribers WHERE ${NOT_WELCOMED} ORDER BY created_at LIMIT ${BATCH[p]}`)
      .all<{ email: string; name: string | null; token: string | null }>();
    const tokens: D1PreparedStatement[] = [];
    for (const f of fans) if (!f.token) { f.token = newToken(); tokens.push(db.prepare("UPDATE subscribers SET token = ? WHERE email = ?").bind(f.token, f.email)); }
    if (tokens.length) await db.batch(tokens);
    const r = await sendWelcomes(env, origin, fans.map((f) => ({ email: f.email, name: f.name, token: f.token! })), await getWelcome(db));
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${NOT_WELCOMED}`).first<{ n: number }>();
    return json({ ok: true, ...r, remaining: left?.n ?? 0 });
  }

  if (b.action === "create") {
    const d = await db.prepare("SELECT id, name, subject, preheader, html FROM mail_designs WHERE id = ?").bind(String(b.id ?? "")).first<{ id: string; name: string; subject: string; preheader: string; html: string }>();
    if (!d) return json({ ok: false, message: "Save the email first." }, 404);
    const problem = senderProblem();
    if (problem) return json({ ok: false, message: `${problem} Until then you can still send tests to your own address.` }, 400);
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
