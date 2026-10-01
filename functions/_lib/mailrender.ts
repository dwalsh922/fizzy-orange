// Turns a finished design into one fan's email: their first name, their own unsubscribe link,
// the preview line, and a plain-text copy for email apps that ask for one.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NAME = /\{\s*first[_ ]?name\s*\}|%7B\s*first[_ ]?name\s*%7D/gi;
const UNSUB = /\{\s*unsubscribe[_ ]?link\s*\}|%7B\s*unsubscribe[_ ]?link\s*%7D/gi;

/** The subject with the fan's name; without a name, "{first_name}, we're playing" becomes "We're playing". */
export function fillSubject(subject: string, name: string): string {
  if (name) return subject.replace(NAME, name);
  const s = subject.replace(/\s*\{\s*first[_ ]?name\s*\}\s*([,!:.]\s*)?/gi, (_m, punct: string | undefined, at: number) => (at === 0 ? "" : punct ? punct.trim() + " " : " ")).replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Does the design carry its own unsubscribe link? If not, one is added at the bottom of every email. */
export const hasUnsubscribe = (html: string) => { UNSUB.lastIndex = 0; return UNSUB.test(html); };

const FOOTER = (url: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:18px 16px 26px;font:13px/1.5 Arial,Helvetica,sans-serif;color:#4A403A">You're getting this because you joined the Fizzy Orange mailing list. <a href="${esc(url)}" style="color:#4A403A;font-weight:bold">Unsubscribe</a></td></tr></table>`;

export function personalise(html: string, o: { name: string; unsubUrl: string; preheader?: string }): string {
  const first = esc(o.name || "there");
  const own = hasUnsubscribe(html);
  let out = html.replace(NAME, first).replace(UNSUB, esc(o.unsubUrl));
  if (!own) out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, FOOTER(o.unsubUrl) + "</body>") : out + FOOTER(o.unsubUrl);
  if (o.preheader) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:transparent">${esc(o.preheader.replace(NAME, o.name || "there"))}</div>`;
    out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (m) => m + pre) : pre + out;
  }
  return out;
}

/** A readable plain-text version of an email's HTML. */
export function toText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => { const t = label.replace(/<[^>]+>/g, "").trim(); return t && t !== href ? `${t} (${href})` : href; })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
