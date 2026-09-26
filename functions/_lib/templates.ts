// The emails fans receive. Table layout and inline styles, because email apps (Outlook especially)
// ignore most modern CSS. Colours match the website: peel orange, cream card, ink outlines.

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const INK = "#1F1A18", CREAM = "#FBF8F0", PEEL = "#EE6605", DEEP = "#C9500C";
const FONT = "Arial, Helvetica, sans-serif";

export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr><td style="background:${DEEP};border:3px solid ${INK};border-radius:15px">
<a href="${esc(url)}" style="display:inline-block;padding:14px 24px;font:bold 17px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:15px">${esc(label)}</a></td></tr></table>`;
}

function layout(origin: string, o: { preheader: string; body: string; footer: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Fizzy Orange</title></head>
<body style="margin:0;padding:0;background:${PEEL}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PEEL}"><tr><td align="center" style="padding:28px 14px 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td align="center" style="padding:0 0 18px"><a href="${esc(origin)}/"><img src="${esc(origin)}/assets/email/logo.png" width="190" alt="Fizzy Orange" style="display:block;width:190px;height:auto;border:0"></a></td></tr>
<tr><td style="background:${CREAM};border:3px solid ${INK};border-radius:18px;padding:30px 28px;font:16px/1.6 ${FONT};color:${INK}">${o.body}</td></tr>
<tr><td align="center" style="padding:20px 10px 0;font:13px/1.55 ${FONT};color:#ffffff">${o.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 16px">${html}</p>`;

/** The admin's plain-text message as email paragraphs: blank lines split paragraphs, links become clickable. */
export function messageHtml(message: string, name: string): string {
  const first = name || "there";
  return message.replace(/\r/g, "").trim().split(/\n{2,}/).map((para) => {
    let h = esc(para.replace(/\{\s*first[_ ]?name\s*\}/gi, first));
    h = h.replace(/https?:\/\/[^\s<]+[^\s<.,!?;:)'"]/g, (u) => `<a href="${u}" style="color:${DEEP};font-weight:bold">${u.replace(/^https?:\/\//, "")}</a>`);
    return p(h.replace(/\n/g, "<br>"));
  }).join("");
}
export const messageText = (message: string, name: string) => message.replace(/\r/g, "").trim().replace(/\{\s*first[_ ]?name\s*\}/gi, name || "there");

export function confirmEmail(origin: string, name: string, confirmUrl: string, reminder = false) {
  const hi = name ? `Hi ${name},` : "Hi,";
  const subject = reminder ? "Still want Fizzy Orange news? One tap left" : "Confirm you want Fizzy Orange news";
  const lead = reminder
    ? "You started joining the Fizzy Orange mailing list a little while ago, but didn't tap the button to confirm. It only takes a second:"
    : "Thanks for signing up to the Fizzy Orange mailing list. Tap the button to confirm it's really you, and you're in:";
  const html = layout(origin, {
    preheader: reminder ? "Tap once to finish joining the Fizzy Orange mailing list." : "Tap once to join the Fizzy Orange mailing list.",
    body: `<h1 style="margin:0 0 18px;font:bold 26px/1.2 ${FONT};color:${INK}">${esc(hi)}</h1>${p(esc(lead))}
${button("Yes, add me to the list", confirmUrl)}
<p style="margin:18px 0 0;font-size:14px;color:#4A403A">You'll get gig dates and new songs before anyone else. If you didn't sign up, ignore this email and you won't hear from us again.</p>`,
    footer: `Fizzy Orange, Dublin. <a href="${esc(origin)}/" style="color:#ffffff">${esc(origin.replace(/^https?:\/\//, ""))}</a>`,
  });
  const text = `${hi}\n\n${lead}\n\n${confirmUrl}\n\nIf you didn't sign up, ignore this email and you won't hear from us again.\n\nFizzy Orange`;
  return { subject, html, text };
}

/** The subject with the fan's name; without a name, "{first_name}, we're playing" becomes "We're playing". */
export function fillSubject(subject: string, name: string): string {
  const token = /\s*\{\s*first[_ ]?name\s*\}\s*([,!:.]\s*)?/gi;
  if (name) return subject.replace(/\{\s*first[_ ]?name\s*\}/gi, name);
  const s = subject.replace(token, (_m, punct: string | undefined, at: number) => (at === 0 ? "" : punct ? punct.trim() + " " : " ")).replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Draft = { subject: string; message: string; button_text?: string | null; button_url?: string | null };

export function campaignEmail(origin: string, d: Draft, fan: { name: string; unsubUrl: string }) {
  const btn = d.button_text && d.button_url ? button(d.button_text, d.button_url) : "";
  const html = layout(origin, {
    preheader: messageText(d.message, fan.name).split("\n").find((l) => l.trim()) ?? d.subject,
    body: messageHtml(d.message, fan.name) + btn,
    footer: `You're getting this because you joined the Fizzy Orange mailing list.<br>
<a href="${esc(fan.unsubUrl)}" style="color:#ffffff;font-weight:bold">Unsubscribe</a> &nbsp;·&nbsp; <a href="${esc(origin)}/" style="color:#ffffff">${esc(origin.replace(/^https?:\/\//, ""))}</a>`,
  });
  const text = `${messageText(d.message, fan.name)}${d.button_text && d.button_url ? `\n\n${d.button_text}: ${d.button_url}` : ""}\n\n--\nFizzy Orange\nUnsubscribe: ${fan.unsubUrl}`;
  return { subject: fillSubject(d.subject, fan.name), html, text };
}
