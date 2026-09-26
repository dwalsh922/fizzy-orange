// Fizzy Orange build: writes content/*.json into index.html and copies the site into dist/.
// No dependencies. Cloudflare Pages runs `node build.mjs` on every push (admin saves included).
// Locally: `node build.mjs`, then serve the dist folder.
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from "node:fs";

const OUT = "dist";
const read = (f) => JSON.parse(readFileSync(`content/${f}.json`, "utf8"));
const settings = read("settings");
const gigs = read("gigs");
const press = read("press").filter((p) => p.published !== false);
const photos = read("photos");
const gallery = read("gallery");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (u) => (/^(https:\/\/|\/|mailto:)/.test(String(u || "").trim()) ? String(u).trim() : "");

function link(key) {
  const email = settings.email || "";
  if (key === "mailto") return email ? `mailto:${email}` : "";
  if (key === "mailto_booking") return email ? `mailto:${email}?subject=Booking%20enquiry` : "";
  // album links fall back to the band's own pages when the release has none
  const FALLBACK = { release_apple: "apple_music", release_bandcamp: "bandcamp" };
  return safeUrl(settings[key]) || (FALLBACK[key] ? safeUrl(settings[FALLBACK[key]]) : "");
}

// a publication's logo on its ink plate; wide logos sit lower so every logo reads at a similar size
function logo(p, lazy = false) {
  const ar = p.logo_w && p.logo_h ? p.logo_w / p.logo_h : 3;
  const lh = Math.round(Math.min(44, Math.max(14, 46 / Math.cbrt(ar))));
  const size = p.logo_w && p.logo_h ? ` width="${p.logo_w}" height="${p.logo_h}"` : "";
  return `<span class="logo-plate" style="--lh:${lh}"><img src="${esc(safeUrl(p.logo))}" alt="${esc(p.outlet)}"${size}${lazy ? ' loading="lazy"' : ""}></span>`;
}

const blocks = {
  press_hero: () => press.slice(0, 3).map((p) => `          <a class="outlet" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">
            ${p.logo ? `<span class="brand">${logo(p)}</span>` : `<span class="brand" data-split>${esc(p.outlet)}</span>`}
            <span class="what">${esc(p.headline)} <span aria-hidden="true">→</span></span>
          </a>`).join("\n") + "\n",
  press_band: () => press.map((p) => `                <a class="quote" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener"><blockquote>${p.logo ? `<p class="has-logo">${logo(p, true)}</p>` : `<p>${esc(p.outlet)}</p>`}<cite>${esc(p.headline)} <span aria-hidden="true">→</span></cite></blockquote></a>`).join("\n"),
  photos: () => photos.map((ph, i) => `              <figure class="photo ${"abc"[i % 3]}"><img src="${esc(safeUrl(ph.url))}" alt="${esc(ph.alt || ph.caption || "Fizzy Orange")}" loading="lazy"><figcaption>${esc(ph.caption)}</figcaption></figure>`).join("\n") + "\n",
  members: () => String(settings.band_members || "").split(",").map((m) => m.trim()).filter(Boolean).map((m) => `<li>${esc(m)}</li>`).join(""),
  socials: () => [["instagram", "Instagram"], ["spotify", "Spotify"], ["apple_music", "Apple Music"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["bandcamp", "Bandcamp"]]
    .filter(([k]) => safeUrl(settings[k]))
    .map(([k, label]) => `      <li><a href="${esc(safeUrl(settings[k]))}" target="_blank" rel="noopener">${label}</a></li>`).join("\n"),
  // one song per line in the admin: "Title | 3:55"
  tracks: () => "\n" + String(settings.release_tracks || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const [title, time = ""] = l.split("|").map((x) => x.trim());
    return `              <li><span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(title)}<span class="t">${esc(time)}</span></li>`;
  }).join("\n") + "\n            ",
  gallery_section: () => !gallery.length ? "" : `<section class="sec gallery reveal" id="gallery" aria-labelledby="gallery-h">
      <div class="wrap">
        <div class="panel">
          <div class="rv">
            <span class="label">Gallery</span>
            <h2 class="big" id="gallery-h">Gallery.</h2>
            <p class="lede">${esc(settings.gallery_intro)}</p>
          </div>
          <div class="jgrid">
${gallery.map((g) => {
  // plain numbers (no calc() maths in CSS), and the small copy in the grid: the full photo opens on tap
  const ar = g.w && g.h ? Math.min(3, Math.max(0.33, g.w / g.h)) : 1;
  const size = g.w && g.h ? ` width="${g.w}" height="${g.h}"` : "";
  return `            <a href="${esc(safeUrl(g.url))}" style="--ar:${ar.toFixed(4)};flex-grow:${(ar * 100).toFixed(2)}" data-caption="${esc(g.caption)}"><i style="padding-bottom:${(100 / ar).toFixed(3)}%"></i><img src="${esc(safeUrl(g.thumb) || safeUrl(g.url))}" alt="${esc(g.alt || g.caption || "Fizzy Orange")}"${size} loading="lazy" decoding="async"></a>`;
}).join("\n")}
          </div>
        </div>
      </div>
    </section>`,
  data: () => `<script id="cms-data" type="application/json">${JSON.stringify({
    gigs: gigs.filter((g) => g.published !== false),
    email: settings.email || "",
    gigs_empty: settings.gigs_empty || "",
    release_url: settings.release_url || "",
  }).replace(/</g, "\\u003c")}</script>`,
};

let html = readFileSync("index.html", "utf8");
let missing = [];
html = html.replace(/<!--b:(\w+)-->[\s\S]*?<!--\/b-->/g, (_, k) => (blocks[k] ? blocks[k]() : (missing.push(k), "")));
html = html.replace(/<!--t:(\w+)-->[\s\S]*?<!--\/t-->/g, (_, k) => (k in settings ? esc(settings[k]) : (missing.push(k), "")));
html = html.replace(/href="[^"]*"([^>]*?)\sdata-href="(\w+)"/g, (_, rest, k) => {
  const u = link(k);
  return u ? `href="${esc(u)}"${rest}` : `href="#"${rest} hidden`;
});
html = html.replace(/src="[^"]*"([^>]*?)\sdata-src="(\w+)"/g, (_, rest, k) => `src="${esc(safeUrl(settings[k]))}"${rest}`);
if (missing.length) { console.error("Missing content for:", [...new Set(missing)].join(", ")); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const p of ["assets", "media", "admin", "_headers", "_redirects", "robots.txt"]) {
  if (existsSync(p)) cpSync(p, `${OUT}/${p}`, { recursive: true });
}
writeFileSync(`${OUT}/index.html`, html);
console.log(`Built ${OUT}/: ${gigs.length} gigs, ${press.length} press, ${photos.length} photos, ${gallery.length} gallery.`);
