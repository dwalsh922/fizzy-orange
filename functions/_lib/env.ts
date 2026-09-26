export interface Env {
  GITHUB_TOKEN?: string;          // fine-grained token: Contents read/write on this repo only
  GITHUB_REPO?: string;           // "owner/repo"
  GITHUB_BRANCH?: string;         // defaults to "main"
  CF_ACCESS_TEAM_DOMAIN?: string; // e.g. "https://youragency.cloudflareaccess.com"
  CF_ACCESS_AUD?: string;         // Access application "Application Audience (AUD) Tag"
  DB?: D1Database;                // D1 database for the mailing list
  BREVO_API_KEY?: string;         // secret: Brevo (free plan) sends the confirmation emails and the emails to the list
  BREVO_API_BASE?: string;        // local testing only; defaults to Brevo's API
}
export type Data = { email: string };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
