import { json, type Data, type Env } from "../../_lib/env";
import { branch, CONTENT_FILES, gh, readContent, toB64, type ContentFile } from "../../_lib/github";

// GET: all four content files with their GitHub versions. PUT: save one file (commit → rebuild).
export const onRequestGet: PagesFunction<Env, string, Data> = async ({ env, data }) => {
  const entries = await Promise.all(CONTENT_FILES.map(async (f) => [f, await readContent(env, f)] as const));
  return json({ ok: true, editor: data.email, files: Object.fromEntries(entries) });
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string";
const url = (v: unknown, required = false) => (v === "" || v === undefined ? !required : str(v) && /^(https:\/\/|\/)/.test(v as string));

function validate(file: ContentFile, d: unknown): string | null {
  if (file === "settings") {
    if (!isObj(d) || !Object.values(d).every(str)) return "Settings must be text values.";
    return null;
  }
  if (!Array.isArray(d)) return "Expected a list.";
  for (const it of d) {
    if (!isObj(it) || !str(it.id) || !(it.id as string).length) return "Every item needs an id.";
    if (file === "gigs") {
      if (!str(it.date) || !/^\d{4}-\d{2}-\d{2}$/.test(it.date as string)) return "Every gig needs a date.";
      if (!str(it.venue) || !(it.venue as string).trim()) return "Every gig needs a venue.";
      if (!url(it.url)) return `The ticket link for ${it.venue} must start with https://`;
    }
    if (file === "press") {
      if (!str(it.outlet) || !(it.outlet as string).trim()) return "Every article needs the publication's name.";
      if (!url(it.url, true)) return `The link for ${it.outlet} must start with https://`;
    }
    if (file === "photos" && !url(it.url, true)) return "Every photo needs an image.";
  }
  return null;
}

export const onRequestPut: PagesFunction<Env, string, Data> = async ({ request, env, data }) => {
  const raw = await request.text();
  if (raw.length > 2_000_000) return json({ ok: false, message: "That's too much content to save at once." }, 413);
  const body = JSON.parse(raw) as { file?: string; data?: unknown; sha?: string; summary?: string };
  const file = body.file as ContentFile;
  if (!CONTENT_FILES.includes(file) || !body.sha) return json({ ok: false, message: "Bad save request." }, 400);
  const problem = validate(file, body.data);
  if (problem) return json({ ok: false, message: problem }, 400);
  const summary = (body.summary ?? `update ${file}`).replace(/[\r\n]/g, " ").slice(0, 120);
  const r = await gh(env, `content/${file}.json`, {
    method: "PUT",
    body: JSON.stringify({
      message: `CMS: ${summary} (by ${data.email})`,
      content: toB64(JSON.stringify(body.data, null, 2) + "\n"),
      sha: body.sha, branch: branch(env),
    }),
  });
  if (r.status === 409 || r.status === 422) {
    return json({ ok: false, message: "Someone else saved changes a moment ago. Reload the admin and try again." }, 409);
  }
  if (!r.ok) return json({ ok: false, message: `GitHub refused the save (${r.status}).` }, 502);
  const j = (await r.json()) as { content: { sha: string } };
  return json({ ok: true, sha: j.content.sha });
};
