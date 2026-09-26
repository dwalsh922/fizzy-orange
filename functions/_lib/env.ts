export interface Env {
  GITHUB_TOKEN?: string;          // fine-grained token: Contents read/write on this repo only
  GITHUB_REPO?: string;           // "owner/repo"
  GITHUB_BRANCH?: string;         // defaults to "main"
  CF_ACCESS_TEAM_DOMAIN?: string; // e.g. "https://youragency.cloudflareaccess.com"
  CF_ACCESS_AUD?: string;         // Access application "Application Audience (AUD) Tag"
  DB?: D1Database;                // D1 database for the mailing list
  BOUNCER_API_KEY?: string;       // secret: Bouncer checks each new sign-up's inbox really exists (pay as you go)
  BOUNCER_API_BASE?: string;      // local testing only; defaults to Bouncer's API
}
export type Data = { email: string };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
