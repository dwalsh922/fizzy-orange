// The welcome email: sent once to every new fan the moment they join, from the same sender as the
// mailings. It's written like a personal email (plain words, no pictures, no buttons) and asks the fan
// to hit reply. A reply, or moving it to the Primary tab, is what teaches Gmail to put the band's later
// emails in that fan's Primary inbox.
// The wording is edited in the admin and kept in mail_config. Who has had it is logged in `sends`
// under the name "welcome", so nobody gets it twice and anyone missed (a daily limit, the service
// down) can be sent it later from the admin.
import type { Env } from "./env";
import { ON_LIST } from "./list";
import { provider, senderProblem, sendMany, type Msg } from "./mailer";
import { fillSubject } from "./mailrender";

export const WELCOME_ID = "welcome";
export const WELCOME_DEFAULT = {
  on: true,
  subject: "Thanks for joining, {first_name}",
  body: `Hey {first_name},

Thanks for signing up to the Fizzy Orange mailing list. You'll hear about gigs and new songs before anyone else, and we'll only email when there's actually something to tell you.

Quick favour: hit reply and tell us one song you want to hear at the next gig. We read every reply.

And if this landed in your Promotions tab, move it over to Primary so the gig news doesn't get buried.

See you down the front,
Fizzy Orange`,
};
export type Welcome = { on: boolean; subject: string; body: string };
export type Fan = { email: string; name: string | null; token: string };

export async function getWelcome(db: D1Database): Promise<Welcome> {
  const { results } = await db.prepare("SELECT key, value FROM mail_config WHERE key IN ('welcome_on', 'welcome_subject', 'welcome_body')").all<{ key: string; value: string }>();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    on: m.welcome_on === undefined ? WELCOME_DEFAULT.on : m.welcome_on === "1",
    subject: m.welcome_subject ?? WELCOME_DEFAULT.subject,
    body: m.welcome_body ?? WELCOME_DEFAULT.body,
  };
}
export async function saveWelcome(db: D1Database, w: Welcome): Promise<void> {
  const put = (k: string, v: string) => db.prepare("INSERT OR REPLACE INTO mail_config (key, value) VALUES (?, ?)").bind(k, v);
  await db.batch([put("welcome_on", w.on ? "1" : "0"), put("welcome_subject", w.subject), put("welcome_body", w.body)]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NAME = /\{\s*first[_ ]?name\s*\}/gi;
const LINK = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]']/g;
/** Escapes a line of the email and makes any web address in it clickable. */
function linkify(s: string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(LINK)) {
    out += esc(s.slice(last, m.index)) + `<a href="${esc(m[0])}">${esc(m[0])}</a>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + esc(s.slice(last));
}
const FOOT = "You're getting this because you joined the Fizzy Orange mailing list.";

/** One fan's copy: the plain wording as simple paragraphs, with a small unsubscribe line underneath. */
export function renderWelcome(w: Pick<Welcome, "subject" | "body">, o: { name: string; unsubUrl: string }): { subject: string; html: string; text: string } {
  const subject = fillSubject(w.subject, o.name);
  const body = w.body.replace(/\r\n?/g, "\n").trim().replace(NAME, o.name || "there");
  const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px">${p.split("\n").map(linkify).join("<br>")}</p>`).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222;max-width:600px">
${paras}
<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#888888">${FOOT} <a href="${esc(o.unsubUrl)}" style="color:#888888">Unsubscribe</a></p>
</div></body></html>`;
  return { subject, html, text: `${body}\n\n--\n${FOOT} Unsubscribe: ${o.unsubUrl}` };
}

/** Why the welcome email can't go right now, or null. */
export const welcomeBlocked = (env: Env): string | null => (provider(env) ? senderProblem() : "No email service is connected yet.");

/** Sends the welcome email to these fans and logs it. A daily limit or a sending problem stops the
 *  rest and is remembered for the admin; those fans stay unwelcomed so they can be sent it later. */
export async function sendWelcomes(env: Env, origin: string, fans: Fan[], w: Welcome): Promise<{ sent: number; failed: number; stop: string | null }> {
  const db = env.DB!;
  const blocked = welcomeBlocked(env);
  if (blocked) { await remember(db, blocked); return { sent: 0, failed: 0, stop: blocked }; }
  const msgs: Msg[] = fans.map((f) => ({ to: f.email, name: f.name ?? "", ...renderWelcome(w, { name: f.name ?? "", unsubUrl: `${origin}/unsubscribe/?t=${f.token}` }) }));
  const results = msgs.length ? await sendMany(env, msgs) : [];
  const log: D1PreparedStatement[] = [];
  let sent = 0, failed = 0, stop: string | null = null;
  results.forEach((r, i) => {
    if (r.ok) { sent++; log.push(db.prepare("INSERT OR IGNORE INTO sends (campaign_id, email) VALUES (?, ?)").bind(WELCOME_ID, fans[i].email)); }
    else if (!r.stop) { failed++; log.push(db.prepare("INSERT OR IGNORE INTO sends (campaign_id, email, error) VALUES (?, ?, ?)").bind(WELCOME_ID, fans[i].email, r.message.slice(0, 200))); }
    else stop = stop ?? r.message;
  });
  if (sent) log.push(db.prepare("DELETE FROM mail_config WHERE key = 'welcome_problem'"));
  if (log.length) await db.batch(log);
  if (stop) await remember(db, stop);
  return { sent, failed, stop };
}
const remember = (db: D1Database, message: string) =>
  db.prepare("INSERT OR REPLACE INTO mail_config (key, value) VALUES ('welcome_problem', ?)").bind(JSON.stringify({ at: new Date().toISOString(), message })).run();

/** Right after a sign-up: the new fan's welcome, if it's switched on and they haven't had one. */
export async function welcomeNewFan(env: Env, origin: string, fan: Fan): Promise<void> {
  const db = env.DB!;
  const w = await getWelcome(db);
  if (!w.on) return;
  const had = await db.prepare("SELECT 1 FROM sends WHERE campaign_id = ? AND email = ?").bind(WELCOME_ID, fan.email).first();
  if (!had) await sendWelcomes(env, origin, [fan], w);
}

/** Fans on the list who haven't had the welcome email (they joined before it was on, or it was held up). */
export const NOT_WELCOMED = `${ON_LIST} AND email NOT IN (SELECT email FROM sends WHERE campaign_id = '${WELCOME_ID}')`;
