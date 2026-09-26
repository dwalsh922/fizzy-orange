import type { Env } from "./env";

export const CONTENT_FILES = ["gigs", "press", "photos", "settings"] as const;
export type ContentFile = (typeof CONTENT_FILES)[number];

function cfg(env: Env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw new Error("GitHub isn't connected yet (GITHUB_TOKEN / GITHUB_REPO missing).");
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) throw new Error("GITHUB_REPO must look like owner/repo.");
  return { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || "main" };
}

export async function gh(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const c = cfg(env);
  return fetch(`https://api.github.com/repos/${c.repo}/contents/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fizzy-orange-cms", ...(init.headers ?? {}),
    },
  });
}
export function branch(env: Env): string {
  return cfg(env).branch;
}

function fromB64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}
export function toB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function readContent(env: Env, file: ContentFile): Promise<{ data: unknown; sha: string }> {
  const r = await gh(env, `content/${file}.json?ref=${encodeURIComponent(branch(env))}`);
  if (!r.ok) throw new Error(`Couldn't read ${file} from GitHub (${r.status}).`);
  const j = (await r.json()) as { content: string; sha: string };
  return { data: JSON.parse(fromB64(j.content)), sha: j.sha };
}
