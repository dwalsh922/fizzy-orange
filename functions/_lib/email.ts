// Checks a sign-up address before it joins the list: the shape, common typos in the
// domain ("gmial.com"), throwaway inboxes, and whether the domain can receive email at all
// (a DNS lookup for its mail servers). No outside account needed.

export type Check = { ok: true; email: string } | { ok: false; message: string; suggest?: string };

// Big providers people mistype. A domain close to one of these (but not on the list) gets a "Did you mean…?"
const POPULAR = [
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "hotmail.ie", "hotmail.fr", "outlook.com", "outlook.ie",
  "live.com", "live.ie", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "yahoo.ie", "ymail.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me", "pm.me", "gmx.com", "gmx.net", "mail.com",
  "eircom.net", "btinternet.com", "sky.com", "virginmedia.com", "zoho.com", "fastmail.com", "tutanota.com", "hey.com",
];
const TLD_FIX: Record<string, string> = { con: "com", cmo: "com", ocm: "com", vom: "com", xom: "com", comm: "com", cpm: "com", om: "com", co: "com", ei: "ie", iie: "ie", nte: "net", ner: "net" };

// Throwaway inboxes: people use these to skip a sign-up, so the address is dead within the hour
const THROWAWAY = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "tempmail.net", "tempmailo.com", "yopmail.com", "yopmail.fr", "trashmail.com", "trashmail.de",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com",
  "moakt.com", "emailondeck.com", "tempail.com", "burnermail.io", "mintemail.com", "spamgourmet.com", "mohmal.com",
  "discard.email", "mailcatch.com", "inboxkitten.com", "tempr.email", "33mail.com", "mytemp.email", "emailfake.com",
  "throwam.com", "spambox.us", "mailpoof.com", "tmail.ws", "tmpmail.org", "tmpmail.net", "minuteinbox.com",
];

const SHAPE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** A likely-intended domain for a mistyped one, or null. */
export function suggestDomain(domain: string): string | null {
  if (POPULAR.includes(domain)) return null;
  const dot = domain.lastIndexOf(".");
  const fixedTld = TLD_FIX[domain.slice(dot + 1)];
  const candidates = [domain, fixedTld ? domain.slice(0, dot + 1) + fixedTld : null].filter(Boolean) as string[];
  let best: string | null = null, bestD = Infinity;
  for (const c of candidates) for (const p of POPULAR) {
    const d = distance(c, p) + (c === domain ? 0 : 0.5);
    if (d < bestD) { bestD = d; best = p; }
  }
  const limit = domain.length <= 8 ? 1 : 2;
  if (best && bestD <= limit + 0.5) return best;
  // a known provider with only the ending wrong, e.g. "gmail.con"
  if (fixedTld && POPULAR.includes(domain.slice(0, dot + 1) + fixedTld)) return domain.slice(0, dot + 1) + fixedTld;
  return null;
}

type Dns = { Status: number; Answer?: { type: number; data: string }[] };
async function lookup(name: string, type: "MX" | "A" | "AAAA"): Promise<Dns> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) throw new Error(`dns ${r.status}`);
  return (await r.json()) as Dns;
}

/** "yes", "no" (the domain can't get email), "missing" (the domain doesn't exist), or "unknown" (DNS didn't answer). */
export async function canReceive(domain: string): Promise<"yes" | "no" | "missing" | "unknown"> {
  try {
    const mx = await lookup(domain, "MX");
    if (mx.Status === 3) return "missing";
    const servers = (mx.Answer ?? []).filter((a) => a.type === 15).map((a) => a.data.trim());
    if (servers.length) return servers.every((s) => /^0\s+\.?$/.test(s)) ? "no" : "yes"; // "0 ." means "no mail here"
    // no mail servers listed: mail goes to the domain's own address, if it has one
    for (const t of ["A", "AAAA"] as const) {
      const r = await lookup(domain, t);
      if ((r.Answer ?? []).some((a) => a.type === (t === "A" ? 1 : 28))) return "yes";
    }
    return "no";
  } catch {
    return "unknown"; // never turn a fan away because a lookup timed out
  }
}

/** Every check a sign-up goes through. `confirmed` means the fan said "no, my address is right" to a suggestion. */
export async function checkEmail(raw: string, confirmed = false): Promise<Check> {
  const email = raw.trim().toLowerCase();
  const typo = "That doesn't look like an email address. Check for typos.";
  if (!email || email.length > 254 || !SHAPE.test(email)) return { ok: false, message: typo };
  const [local, domain] = email.split("@");
  if (local.length > 64) return { ok: false, message: typo };
  if (THROWAWAY.some((d) => domain === d || domain.endsWith("." + d))) {
    return { ok: false, message: "Throwaway addresses can't join the list. Use your everyday email." };
  }
  const fix = suggestDomain(domain);
  if (fix && !confirmed) return { ok: false, message: `Did you mean ${local}@${fix}?`, suggest: `${local}@${fix}` };
  const mail = await canReceive(domain);
  if (mail === "missing") return { ok: false, message: `"${domain}" doesn't exist, so that address can't get email. Check for typos.`, ...(fix ? { suggest: `${local}@${fix}` } : {}) };
  if (mail === "no") return { ok: false, message: `"${domain}" can't receive email. Check for typos.`, ...(fix ? { suggest: `${local}@${fix}` } : {}) };
  return { ok: true, email };
}
