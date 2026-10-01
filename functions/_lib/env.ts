export interface Env {
  GITHUB_TOKEN?: string;          // fine-grained token: Contents read/write on this repo only
  GITHUB_REPO?: string;           // "owner/repo"
  GITHUB_BRANCH?: string;         // defaults to "main"
  CF_ACCESS_TEAM_DOMAIN?: string; // e.g. "https://youragency.cloudflareaccess.com"
  CF_ACCESS_AUD?: string;         // Access application "Application Audience (AUD) Tag"
  DB?: D1Database;                // D1 database for the mailing list
  BOUNCER_API_KEY?: string;       // secret: Bouncer checks each new sign-up's inbox really exists (pay as you go)
  BOUNCER_API_BASE?: string;      // local testing only; defaults to Bouncer's API
  // Sending the designed emails. Resend is used when RESEND_API_KEY is set; Amazon SES takes over
  // when the three AWS values are set (pay per email, for lists past Resend's free 100 a day).
  RESEND_API_KEY?: string;        // secret
  AWS_ACCESS_KEY_ID?: string;     // secret: an IAM user allowed ses:SendEmail only
  AWS_SECRET_ACCESS_KEY?: string; // secret
  AWS_REGION?: string;            // e.g. "eu-west-1" (Ireland)
  MAIL_API_BASE?: string;         // local testing only; replaces the provider's address
}
export type Data = { email: string };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
