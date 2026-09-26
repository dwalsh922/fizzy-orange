import { json, type Data, type Env } from "../../_lib/env";
import { branch, gh } from "../../_lib/github";

// Upload one file into media/uploads/. The browser already shrinks photos to
// WebP and sends base64 text; the body is passed straight to GitHub (no parsing), so
// even a 20 MB clip stays well inside the free plan's CPU limit.
const TYPES: Record<string, number> = { webp: 12, jpg: 12, jpeg: 12, png: 12, gif: 12, avif: 12, mp4: 20, webm: 20 };

export const onRequestPost: PagesFunction<Env, string, Data> = async ({ request, env, data }) => {
  const ext = (new URL(request.url).searchParams.get("ext") ?? "").toLowerCase();
  const maxMb = TYPES[ext];
  if (!maxMb) return json({ ok: false, message: "Use JPG, PNG, WebP, GIF, MP4 or WebM." }, 415);
  const b64 = await request.text();
  if (b64.length > maxMb * 1024 * 1024 * 1.37) {
    return json({ ok: false, message: `Files of this type must be under ${maxMb} MB. For longer videos, upload to YouTube and add the link.` }, 413);
  }
  if (!b64.length || b64.includes('"') || b64.includes("\\")) return json({ ok: false, message: "That file didn't come through. Try again." }, 400);
  const month = new Date().toISOString().slice(0, 7);
  const path = `media/uploads/${month}/${crypto.randomUUID()}.${ext}`;
  const message = JSON.stringify(`CMS: upload ${ext} (by ${data.email})`);
  const r = await gh(env, path, {
    method: "PUT",
    body: `{"message":${message},"branch":${JSON.stringify(branch(env))},"content":"${b64}"}`,
  });
  if (!r.ok) return json({ ok: false, message: `GitHub refused the upload (${r.status}).` }, 502);
  return json({ ok: true, url: `/${path.replace(/^public\//, "")}` });
};
