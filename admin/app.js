// Fizzy Orange admin. The same workspace as the Sleepover Club admin, in plain JavaScript
// (the site has no build tooling). Content lives in content/*.json in the GitHub repo;
// every save is a commit made by functions/api/cms/content.ts, and Cloudflare rebuilds
// the site about a minute later. Login is Cloudflare Access (email + one-time code).
import { EmailDesigner } from "./designer.js";

/* ================= tiny DOM helper ================= */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const NS = "http://www.w3.org/2000/svg";
const icon = (d) => { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = d; return s; };
const I = {
  home: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  gig: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  press: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  grid: '<rect x="3" y="4" width="10" height="7" rx="1.5"/><rect x="15" y="4" width="6" height="7" rx="1.5"/><rect x="3" y="13" width="6" height="7" rx="1.5"/><rect x="11" y="13" width="10" height="7" rx="1.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  out: '<path d="M14 4h5v5M19 4l-8 8"/><path d="M18 14v5H5V6h5"/>',
};

/* ================= api ================= */
async function call(url, init) {
  const r = await fetch(url, { credentials: "same-origin", ...init });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.reload(); throw new Error("Your login expired. Reloading…"); }
  if (!r.ok || j.ok === false) throw new Error(j.message || `Request failed (${r.status}).`);
  return j;
}
const loadAll = () => call("/api/cms/content");
const saveFile = (file, data, sha, summary) =>
  call("/api/cms/content", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ file, data, sha, summary }) });
const listSubscribers = () => call("/api/cms/subscribers");
const removeSubscriber = (email) => call("/api/cms/subscribers?email=" + encodeURIComponent(email), { method: "DELETE" });

/** Uploaded files only appear on the live site after the next rebuild, so keep a local preview. */
const previews = new Map();
const src = (url) => (url ? previews.get(url) ?? url : "");
async function decode(file) {
  try { return await createImageBitmap(file); }
  catch {
    const img = new Image(); const u = URL.createObjectURL(file);
    try { img.src = u; await img.decode(); } catch { throw new Error(`${file.name}: couldn't read that image.`); } finally { URL.revokeObjectURL(u); }
    // SVGs have no fixed size: draw them large enough to stay sharp
    if (file.type === "image/svg+xml") { const k = 1600 / Math.max(img.naturalWidth || 300, img.naturalHeight || 150); img.width = Math.round((img.naturalWidth || 300) * k); img.height = Math.round((img.naturalHeight || 150) * k); }
    else { img.width = img.naturalWidth; img.height = img.naturalHeight; }
    return img;
  }
}
async function toWebp(file, max) {
  const bmp = await decode(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process that image."))), "image/webp", 0.82));
  return { blob, w: c.width, h: c.height };
}
const b64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
  fr.onerror = () => rej(new Error("Couldn't read that file."));
  fr.readAsDataURL(blob);
});
/** Shrinks a photo in the browser, uploads it, and reports its address and size. */
async function uploadImage(file) {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: please choose an image.`);
  let blob = file, ext = (file.name.split(".").pop() ?? "").toLowerCase(), w = 0, h = 0;
  if (file.type === "image/gif") { const bmp = await createImageBitmap(file); w = bmp.width; h = bmp.height; }
  else { ({ blob, w, h } = await toWebp(file, 2000)); ext = "webp"; }
  const r = await call(`/api/cms/upload?ext=${ext}`, { method: "POST", body: await b64(blob) });
  previews.set(r.url, URL.createObjectURL(blob));
  return { url: r.url, w, h };
}
const upload = async (file) => (await uploadImage(file)).url;
/** Gallery photos also get a 1000px copy for the grid, so phones aren't asked to hold dozens of full-size photos. */
async function uploadWithThumb(file) {
  const r = await uploadImage(file);
  if (file.type === "image/gif" || Math.max(r.w, r.h) <= 1000) return r;
  const { blob } = await toWebp(file, 1000);
  const t = await call("/api/cms/upload?ext=webp", { method: "POST", body: await b64(blob) });
  previews.set(t.url, URL.createObjectURL(blob));
  return { ...r, thumb: t.url };
}
const uid = () => crypto.randomUUID();
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
const longDate = (d) => new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00"));
const SITE = "fizzy-orange.pages.dev";
const LIVE = "Saved. It will be on the website in about a minute.";

/* ================= app state ================= */
let files = null, editor = "", dirty = false, lastHash = location.hash || "#/";
async function save(file, data, summary) {
  const r = await saveFile(file, data, files[file].sha, summary);
  files[file] = { data, sha: r.sha };
}

/* ================= shared pieces ================= */
let toastEl = null, toastTimer = 0;
function show(text, kind) {
  toastEl?.remove(); clearTimeout(toastTimer);
  toastEl = h("div", { class: "a-toast", role: "status", "data-kind": kind === "err" ? "err" : null }, text);
  document.body.append(toastEl);
  toastTimer = setTimeout(() => toastEl?.remove(), kind === "err" ? 6000 : 3200);
}
const Field = (label, control, hint) => h("label", { class: "a-field" }, h("span", null, label), control, hint && h("small", null, hint));
function Card(title, hint, ...body) {
  return h("section", { class: "a-card" },
    title && h("div", { class: "a-card__head" }, h("h2", null, title), hint && h("p", null, hint)),
    h("div", { class: "a-card__body" }, body));
}
const Empty = (title, text, action) => h("div", { class: "a-empty" }, h("h2", null, title), h("p", null, text), action);
const Head = (title, text, ...actions) => h("div", { class: "a-head" },
  h("div", null, title instanceof Node ? title : h("h1", null, title), text && h("p", null, text)),
  actions.length ? h("div", { class: "a-actions" }, actions) : null);
const confirmDelete = (what) => confirm(`Delete ${what}?\n\nThis cannot be undone.`);
const check = (label, small, checked, onChange) =>
  h("label", { class: "a-check" }, h("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked) }), h("span", null, label, h("small", null, small)));

/** The bar that follows you down a form so Save is always in reach. */
function SaveBar(onSave) {
  const note = h("span", { class: "a-save__note" }, "Everything is saved");
  const btn = h("button", { type: "button", class: "a-btn a-btn--primary", disabled: true, onClick: () => onSave() }, "Save changes");
  const el = h("div", { class: "a-save" }, note, h("div", { class: "a-actions" }, btn));
  const api = {
    el,
    dirty(on) { dirty = on; note.toggleAttribute("data-dirty", on); note.textContent = on ? "You have unsaved changes" : "Everything is saved"; btn.disabled = !on; },
    busy(on) { btn.disabled = on || !dirty; btn.textContent = on ? "Saving…" : "Save changes"; if (on) note.textContent = "Saving…"; },
  };
  return api;
}
addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/** Picks one image, shrinks it in the browser, uploads it. */
function ImagePicker(label, hint, value, onChange, opts = {}) {
  const wrap = h("div", { class: "a-field" });
  const err = h("p", { class: "a-err", role: "alert", hidden: true });
  const render = () => {
    const input = h("input", { type: "file", accept: "image/*", hidden: true, onChange: async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      pick.textContent = "Uploading…"; pick.style.cursor = "progress"; err.hidden = true;
      try { const r = await uploadImage(f); value = r.url; onChange(value, r); } catch (x) { err.textContent = x.message; err.hidden = false; }
      render();
    } });
    const pick = h("label", { class: "a-btn", style: { cursor: "pointer" } }, value ? "Replace" : "Choose image", input);
    wrap.replaceChildren(h("span", null, label), h("div", { class: "a-pick" },
      value ? h("img", { class: "a-pick__prev", src: src(value), alt: "", style: opts.dark ? { background: "#1F1A18", objectFit: "contain", padding: "10px", width: "180px", height: "80px" } : null }) : h("div", { class: "a-pick__prev a-pick__ph" }, "No image yet"),
      h("div", { class: "a-pick__acts" }, pick,
        value && h("button", { type: "button", class: "a-btn a-btn--danger a-btn--sm", onClick: () => { value = ""; onChange(""); render(); } }, "Remove"))),
      hint && h("small", null, hint), err);
  };
  render();
  return wrap;
}

/* ================= shell ================= */
const NAV = [
  ["#/", "Home", I.home], ["#/gigs", "Gigs", I.gig], ["#/press", "Press", I.press],
  ["#/photos", "Band photos", I.media], ["#/gallery", "Gallery", I.grid], ["#/text", "Website text", I.text], ["#/list", "Mailing list", I.mail],
];
const LOGO = "/assets/orange-happy.webp";

function shell(section, view) {
  const hash = location.hash || "#/";
  const side = h("aside", { class: "a-side", "aria-label": "Sections" },
    h("a", { href: "#/", class: "a-brand" }, h("img", { src: LOGO, alt: "", width: 34, height: 34 }), h("span", null, "Fizzy Orange", h("small", null, "Website admin"))),
    h("nav", { class: "a-nav" }, NAV.map(([href, label, d]) => {
      const on = href === "#/" ? section === "" : hash.startsWith(href);
      return h("a", { href, "data-on": on ? "" : null }, icon(d), label);
    })),
    h("span", { class: "a-grow" }),
    h("div", { class: "a-who" }, "Signed in as", h("br"), editor,
      h("a", { href: "/", target: "_blank", rel: "noopener" }, "View website ↗"), h("br"),
      h("a", { href: "/cdn-cgi/access/logout" }, "Log out")));
  return h("div", { class: "a-shell" },
    h("div", { class: "a-bar" },
      h("span", { style: { display: "flex", alignItems: "center", gap: "9px", fontWeight: 600 } }, h("img", { src: LOGO, alt: "", width: 28, height: 28 }), "Fizzy Orange"),
      h("button", { class: "a-btn a-btn--sm", "aria-expanded": "false", onClick: (e) => {
        const open = !side.hasAttribute("data-open");
        side.toggleAttribute("data-open", open); e.currentTarget.setAttribute("aria-expanded", String(open));
      } }, "Menu")),
    side,
    h("main", { class: "a-main" }, view));
}

function route() {
  const hash = location.hash || "#/";
  const [, section = "", id] = hash.replace(/^#/, "").split("/");
  let view;
  if (section === "gigs") view = id ? GigForm(id) : GigsList();
  else if (section === "press") view = id ? PressForm(id) : PressList();
  else if (section === "photos") view = PhotosPanel();
  else if (section === "gallery") view = GalleryPanel();
  else if (section === "text") view = SettingsPanel();
  else if (section === "list") view = SubscribersPanel();
  else if (section === "email") {
    // the email designer takes the whole screen, without the sidebar
    const s = files.settings.data;
    const links = [["Instagram", s.instagram], ["Spotify", s.spotify], ["Apple Music", s.apple_music], ["Bandcamp", s.bandcamp], ["YouTube", s.youtube], ["TikTok", s.tiktok]].filter(([, u]) => u);
    document.getElementById("app").replaceChildren(EmailDesigner(id || "new", { h, icon, I, call, show, who: editor, links, setDirty: (v) => { dirty = v; } }));
    return;
  }
  else view = Overview();
  document.getElementById("app").replaceChildren(shell(section, view));
}
addEventListener("hashchange", () => {
  if (dirty && !confirm("You have unsaved changes. Leave without saving?")) { history.replaceState(null, "", lastHash); return; }
  dirty = false; lastHash = location.hash || "#/"; scrollTo(0, 0); route();
});

/* ================= home ================= */
function Overview() {
  const t = today();
  const gigs = files.gigs.data;
  const upcoming = gigs.filter((g) => g.date >= t && g.published !== false).sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  const press = files.press.data.filter((p) => p.published !== false);
  const jobs = [];
  if (!upcoming.length) jobs.push("There are no upcoming gigs, so the website is inviting people to join the mailing list instead. Add your next date to fill that space.");
  const noTickets = upcoming.filter((g) => !g.url && !g.soldOut).length;
  if (noTickets) jobs.push(`${noTickets} upcoming ${noTickets === 1 ? "gig has" : "gigs have"} no ticket link yet, so the button sends people to the mailing list.`);
  if (press.length < 3) jobs.push("The scroll section shows three press articles. Add another under Press to fill it.");
  if (!files.settings.data.release_url) jobs.push("The latest release has no Spotify link, so its button is hidden. Add one under Website text.");
  if (next && !next.poster) jobs.push(`Your next gig at ${next.venue} has no poster yet. Add one so it stands out at the top of the site.`);

  return h("div", null,
    Head("Home", `Everything you change here appears on ${SITE} about a minute after you save.`,
      h("a", { class: "a-btn a-btn--primary", href: "#/gigs/new" }, icon(I.plus), "Add a gig")),
    h("div", { class: "a-stats" },
      [[upcoming.length, "Upcoming gigs"], [gigs.length, "Gigs in total"], [press.length, "Press articles"], [files.gallery.data.length, "Gallery photos"]]
        .map(([n, l]) => h("div", { class: "a-stat" }, h("b", null, n), h("span", null, l)))),
    next && h("section", { class: "a-card" }, h("div", { class: "a-card__head" }, h("h2", null, "Next up")),
      h("div", { class: "a-card__body" },
        h("div", null, h("strong", { style: { fontSize: "18px" } }, [next.venue, next.city].filter(Boolean).join(", ")),
          h("p", { style: { color: "var(--muted)", marginTop: "4px" } }, longDate(next.date), next.soldOut ? " · Sold out" : "")),
        h("div", { class: "a-actions" },
          h("a", { class: "a-btn", href: `#/gigs/${next.id}` }, "Edit this gig"),
          h("a", { class: "a-btn a-btn--quiet", href: "/#gigs", target: "_blank", rel: "noopener" }, icon(I.out), "View on site")))),
    jobs.length > 0 && Card("Worth doing", null, h("ul", { class: "a-todo" }, jobs.map((j) => h("li", null, j)))),
    Card("How this works", null, h("p", { style: { color: "var(--muted)" } },
      "Add each date under ", h("strong", null, "Gigs"), ". The next one shows in the scroll section at the top of the site, and past dates drop off by themselves. ",
      "Swap the articles under ", h("strong", null, "Press"), " and the pictures under ", h("strong", null, "Band photos"),
      ". Everything else, including the latest release and your links, is under ", h("strong", null, "Website text"), ".")));
}

/* ================= gigs ================= */
function GigsList() {
  let q = "", f = "all";
  const t = today();
  const list = h("div");
  const draw = () => {
    const rows = [...files.gigs.data].sort((a, b) => b.date.localeCompare(a.date))
      .filter((g) => f === "all" || (f === "hidden" ? g.published === false : g.published !== false && (f === "upcoming" ? g.date >= t : g.date < t)))
      .filter((g) => `${g.venue} ${g.city ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    list.replaceChildren(!files.gigs.data.length
      ? Empty("No gigs yet", "Add your next date and it will appear in the scroll section and the gigs list on the website.", h("a", { class: "a-btn a-btn--primary", href: "#/gigs/new" }, icon(I.plus), "Add a gig"))
      : !rows.length ? Empty("Nothing matches", "Try a different search or filter.")
      : h("div", { class: "a-rows" }, rows.map((g) => h("a", { class: "a-row", href: `#/gigs/${g.id}` },
        g.poster ? h("img", { class: "a-row__img", src: src(g.poster), alt: "", style: { objectFit: "cover" } }) : h("span", { class: "a-row__img a-row__img--ph" }, g.date.slice(8, 10)),
        h("span", null, h("span", { class: "a-row__t" }, [g.venue, g.city].filter(Boolean).join(", ")), h("span", { class: "a-row__s" }, longDate(g.date))),
        h("span", { class: "a-row__end" },
          g.published === false && h("span", { class: "a-tag a-tag--off" }, "Hidden"),
          g.soldOut && h("span", { class: "a-tag" }, "Sold out"),
          g.published !== false && g.date >= t && h("span", { class: "a-tag a-tag--now" }, "Upcoming"))))));
  };
  const chips = h("div", { class: "a-chips" }, [["all", "All"], ["upcoming", "Upcoming"], ["past", "Past"], ["hidden", "Hidden"]].map(([k, label]) =>
    h("button", { class: "a-chip", "aria-pressed": String(f === k), onClick: (e) => { f = k; chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, label)));
  draw();
  return h("div", null,
    Head("Gigs", "Every date you've added. The newest is at the top.", h("a", { class: "a-btn a-btn--primary", href: "#/gigs/new" }, icon(I.plus), "Add a gig")),
    h("div", { class: "a-toolbar" },
      h("div", { class: "a-search" }, icon(I.search), h("input", { type: "search", placeholder: "Search venues and cities", "aria-label": "Search gigs", onInput: (e) => { q = e.target.value; draw(); } })),
      chips),
    list);
}

function GigForm(id) {
  const existing = files.gigs.data.find((g) => g.id === id);
  if (id !== "new" && !existing) return Empty("That gig is gone", "It may have been deleted from another device.", h("a", { class: "a-btn", href: "#/gigs" }, "Back to gigs"));
  const g = { id: uid(), date: "", venue: "", city: "Dublin", url: "", poster: "", soldOut: false, published: true, ...(existing ?? {}) };
  const bar = SaveBar(onSave);
  const text = (k, attrs = {}) => h("input", { value: g[k] ?? "", ...attrs, onInput: (e) => { g[k] = e.target.value; bar.dirty(true); } });

  async function onSave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) return show("Pick a date for the gig.", "err");
    if (!g.venue.trim()) return show("Add the venue.", "err");
    if (g.url && !/^https:\/\//i.test(g.url.trim())) return show("The ticket link needs to start with https://", "err");
    const next = { ...g, venue: g.venue.trim(), city: (g.city || "").trim(), url: (g.url || "").trim() };
    bar.busy(true);
    try {
      await save("gigs", existing ? files.gigs.data.map((x) => (x.id === g.id ? next : x)) : [next, ...files.gigs.data],
        `${existing ? "update" : "add"} gig at ${next.venue} on ${next.date}`);
      bar.dirty(false); show(LIVE);
      if (!existing) location.hash = `#/gigs/${next.id}`;
    } catch (x) { show(x.message, "err"); } finally { bar.busy(false); }
  }
  async function remove() {
    if (!confirmDelete(`the gig at ${existing.venue}`)) return;
    try { await save("gigs", files.gigs.data.filter((x) => x.id !== existing.id), `delete gig at ${existing.venue} on ${existing.date}`); bar.dirty(false); show("Gig deleted."); location.hash = "#/gigs"; }
    catch (x) { show(x.message, "err"); }
  }
  return h("div", null,
    Head(h("div", null, h("a", { class: "a-btn a-btn--quiet a-btn--sm", href: "#/gigs", style: { marginBottom: "10px" } }, icon(I.back), "All gigs"),
      h("h1", null, existing ? [existing.venue, existing.city].filter(Boolean).join(", ") : "New gig")), null),
    h("div", { class: "a-form" },
      Card("The basics", null,
        h("div", { class: "a-3col" },
          Field("Date", text("date", { type: "date", required: true })),
          Field("Venue", text("venue", { placeholder: "e.g. Whelan's", required: true })),
          Field("City", text("city", { placeholder: "Dublin" })))),
      Card("Poster", "Event posters are A4 portrait. The poster sits next to the gig on the website, and the next gig's poster is shown at the top of the site.",
        ImagePicker("Event poster", "A photo or export of the A4 poster. It's resized for the web automatically.", g.poster, (v) => { g.poster = v; bar.dirty(true); })),
      Card("Tickets", null,
        Field("Ticket link", text("url", { type: "url", placeholder: "https://dice.fm/..." }), "Paste the DICE, Ticketmaster or venue page. Leave blank and the button sends people to the mailing list."),
        check("Sold out", "Shows \"Sold out\" instead of the ticket button.", g.soldOut, (v) => { g.soldOut = v; bar.dirty(true); }),
        check("Show on the website", "Untick to keep it hidden while you confirm the details.", g.published !== false, (v) => { g.published = v; bar.dirty(true); })),
      existing && h("div", null, h("button", { type: "button", class: "a-btn a-btn--danger", onClick: remove }, "Delete this gig"))),
    bar.el);
}

/* ================= press ================= */
function PressList() {
  const rows = files.press.data;
  let shown = 0;
  return h("div", null,
    Head("Press", "The \"As featured in\" articles. The first three shown also appear in the scroll section at the top.",
      h("a", { class: "a-btn a-btn--primary", href: "#/press/new" }, icon(I.plus), "Add an article")),
    !rows.length ? Empty("No articles yet", "Add a review, interview or feature about the band.", h("a", { class: "a-btn a-btn--primary", href: "#/press/new" }, icon(I.plus), "Add an article"))
      : h("div", { class: "a-rows" }, rows.map((p, i) => {
        const live = p.published !== false; if (live) shown++;
        return h("a", { class: "a-row", href: `#/press/${p.id}` },
          p.logo ? h("img", { class: "a-row__img", src: src(p.logo), alt: "", style: { objectFit: "contain", background: "#1F1A18", padding: "6px" } }) : h("span", { class: "a-row__img a-row__img--ph" }, i + 1),
          h("span", null, h("span", { class: "a-row__t" }, p.outlet), h("span", { class: "a-row__s" }, p.headline)),
          h("span", { class: "a-row__end" },
            !live && h("span", { class: "a-tag a-tag--off" }, "Hidden"),
            live && shown <= 3 && h("span", { class: "a-tag a-tag--now" }, "In the scroll section")));
      })));
}

function PressForm(id) {
  const all = files.press.data;
  const existing = all.find((p) => p.id === id);
  if (id !== "new" && !existing) return Empty("That article is gone", "It may have been deleted from another device.", h("a", { class: "a-btn", href: "#/press" }, "Back to press"));
  const p = { id: uid(), outlet: "", headline: "", url: "", logo: "", published: true, ...(existing ?? {}) };
  let pos = existing ? all.indexOf(existing) : all.length;
  const bar = SaveBar(onSave);
  const text = (k, attrs = {}) => h("input", { value: p[k] ?? "", ...attrs, onInput: (e) => { p[k] = e.target.value; bar.dirty(true); } });
  const slots = existing ? all.length : all.length + 1;

  async function onSave() {
    if (!p.outlet.trim()) return show("Add the name of the publication.", "err");
    if (!/^https:\/\//i.test((p.url || "").trim())) return show("The link needs to start with https://", "err");
    const next = { ...p, outlet: p.outlet.trim(), headline: p.headline.trim(), url: p.url.trim() };
    const list = all.filter((x) => x.id !== p.id);
    list.splice(Math.min(pos, list.length), 0, next);
    bar.busy(true);
    try {
      await save("press", list, `${existing ? "update" : "add"} press: ${next.outlet}`);
      bar.dirty(false); show(LIVE);
      if (!existing) location.hash = `#/press/${next.id}`;
    } catch (x) { show(x.message, "err"); } finally { bar.busy(false); }
  }
  async function remove() {
    if (!confirmDelete(`the ${existing.outlet} article`)) return;
    try { await save("press", all.filter((x) => x.id !== existing.id), `delete press: ${existing.outlet}`); bar.dirty(false); show("Article deleted."); location.hash = "#/press"; }
    catch (x) { show(x.message, "err"); }
  }
  const posSel = h("select", { onChange: (e) => { pos = Number(e.target.value); bar.dirty(true); } },
    Array.from({ length: slots }, (_, i) => h("option", { value: i, selected: i === pos }, i < 3 ? `${i + 1} (in the scroll section)` : String(i + 1))));
  return h("div", null,
    Head(h("div", null, h("a", { class: "a-btn a-btn--quiet a-btn--sm", href: "#/press", style: { marginBottom: "10px" } }, icon(I.back), "All press"),
      h("h1", null, existing ? existing.outlet : "New article")), null),
    h("div", { class: "a-form" },
      Card("The article", null,
        h("div", { class: "a-2col" },
          Field("Publication", text("outlet", { placeholder: "e.g. Hotpress", required: true })),
          Field("Position", posSel, "1 to 3 show in the scroll section.")),
        Field("Headline or quote", text("headline", { placeholder: "e.g. \"Infectious rhythm and melodic hooks.\"" }), "Keep it short: one line."),
        Field("Link to the article", text("url", { type: "url", placeholder: "https://", required: true })),
        check("Show on the website", "Untick to hide it without deleting it.", p.published !== false, (v) => { p.published = v; bar.dirty(true); })),
      Card("Logo", "Shown on a dark plate on the website, so a white logo on a transparent background (PNG or SVG) looks best. Without one, the publication's name is shown in text.",
        ImagePicker("Publication logo", "Ideally the full name, not just an icon.", p.logo, (v, r) => { p.logo = v; if (r) { p.logo_w = r.w; p.logo_h = r.h; } else { delete p.logo_w; delete p.logo_h; } bar.dirty(true); }, { dark: true })),
      existing && h("div", null, h("button", { type: "button", class: "a-btn a-btn--danger", onClick: remove }, "Delete this article"))),
    bar.el);
}

/* ================= band photos ================= */
function PhotosPanel() {
  let list = files.photos.data.map((p) => ({ ...p }));
  const bar = SaveBar(onSave);
  const grid = h("div", { class: "a-form" });
  const touch = () => bar.dirty(true);
  const draw = () => {
    grid.replaceChildren(...list.map((p, i) => Card(i === 0 ? "Photo 1 (shown large)" : `Photo ${i + 1}`, null,
      h("div", { class: "a-2col" },
        ImagePicker("Photo", "Landscape works best for photo 1, portrait or square for the others.", p.url, (v) => { p.url = v; touch(); }),
        h("div", { style: { display: "grid", gap: "16px", alignContent: "start" } },
          Field("Caption", h("input", { value: p.caption ?? "", placeholder: "e.g. Golden hour", onInput: (e) => { p.caption = e.target.value; touch(); } })),
          Field("Description for screen readers", h("input", { value: p.alt ?? "", placeholder: "What's in the photo", onInput: (e) => { p.alt = e.target.value; touch(); } }), "Helps blind visitors and Google."),
          h("div", { class: "a-actions" },
            i > 0 && h("button", { type: "button", class: "a-btn a-btn--sm", onClick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; touch(); draw(); } }, "Move up"),
            i < list.length - 1 && h("button", { type: "button", class: "a-btn a-btn--sm", onClick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; touch(); draw(); } }, "Move down"),
            h("button", { type: "button", class: "a-btn a-btn--danger a-btn--sm", onClick: () => { if (confirm("Remove this photo from the website?")) { list.splice(i, 1); touch(); draw(); } } }, "Remove")))))),
      h("div", null, h("button", { type: "button", class: "a-btn", onClick: () => { list.push({ id: uid(), url: "", caption: "", alt: "" }); touch(); draw(); } }, icon(I.plus), "Add a photo")));
  };
  async function onSave() {
    if (list.some((p) => !p.url)) return show("Every photo needs an image, or remove the empty one.", "err");
    bar.busy(true);
    try { await save("photos", list.map((p) => ({ ...p, caption: (p.caption || "").trim(), alt: (p.alt || "").trim() })), "update band photos"); bar.dirty(false); show(LIVE); }
    catch (x) { show(x.message, "err"); } finally { bar.busy(false); }
  }
  draw();
  return h("div", null, Head("Band photos", "The photos in the band section. Three looks best. They're resized for you when you upload."), grid, bar.el);
}

/* ================= gallery ================= */
function GalleryPanel() {
  let list = files.gallery.data.map((p) => ({ ...p }));
  const bar = SaveBar(onSave);
  const tiles = h("div", { class: "a-form" });
  const status = h("p", { class: "a-note", hidden: true });
  const touch = () => bar.dirty(true);

  async function addFiles(fileList) {
    const picked = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return show("Choose photos (JPG, PNG, WebP or GIF).", "err");
    let done = 0, failed = 0;
    status.hidden = false;
    for (const f of picked) {
      status.textContent = `Uploading ${done + failed + 1} of ${picked.length}… Keep this page open.`;
      try { const r = await uploadWithThumb(f); list.push({ id: uid(), url: r.url, ...(r.thumb ? { thumb: r.thumb } : {}), w: r.w, h: r.h, caption: "", alt: "" }); done++; touch(); draw(); }
      catch (x) { failed++; show(x.message, "err"); }
    }
    status.textContent = `${done} ${done === 1 ? "photo" : "photos"} added${failed ? `, ${failed} didn't upload` : ""}. Add captions if you like, then press Save changes.`;
  }
  const many = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onChange: (e) => { addFiles(e.target.files); e.target.value = ""; } });
  const one = h("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => { addFiles(e.target.files); e.target.value = ""; } });
  const drop = h("div", { class: "a-drop", tabIndex: 0,
    onDragover: (e) => { e.preventDefault(); drop.setAttribute("data-over", ""); },
    onDragleave: () => drop.removeAttribute("data-over"),
    onDrop: (e) => { e.preventDefault(); drop.removeAttribute("data-over"); addFiles(e.dataTransfer.files); } },
    icon(I.upload), h("strong", null, "Drag photos here"), h("span", null, "or choose several at once. They're resized for the web as they upload."),
    h("div", { class: "a-actions", style: { justifyContent: "center" } },
      h("label", { class: "a-btn a-btn--primary", style: { cursor: "pointer" } }, icon(I.plus), "Choose photos", many),
      h("label", { class: "a-btn", style: { cursor: "pointer" } }, "Add one photo", one)));

  const draw = () => {
    tiles.replaceChildren(...(!list.length ? [Empty("No photos yet", "Add some above and they'll appear in the Gallery section at the bottom of the website.")] : [
      h("div", { class: "a-tiles" }, list.map((p, i) => h("div", { class: "a-tile" },
        h("div", { class: "a-tile__prev", style: { aspectRatio: p.w && p.h ? `${p.w} / ${p.h}` : "4 / 3", maxHeight: "220px" } },
          h("img", { src: src(p.thumb || p.url), alt: "", loading: "lazy", style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } })),
        h("div", { class: "a-tile__body" },
          Field("Caption", h("input", { value: p.caption ?? "", placeholder: "Optional", onInput: (e) => { p.caption = e.target.value; touch(); } })),
          Field("Description", h("input", { value: p.alt ?? "", placeholder: "What's in the photo", onInput: (e) => { p.alt = e.target.value; touch(); } }), "For screen readers and Google."),
          h("div", { class: "a-actions" },
            i > 0 && h("button", { type: "button", class: "a-btn a-btn--sm", "aria-label": "Move earlier", onClick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; touch(); draw(); } }, "←"),
            i < list.length - 1 && h("button", { type: "button", class: "a-btn a-btn--sm", "aria-label": "Move later", onClick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; touch(); draw(); } }, "→"),
            h("button", { type: "button", class: "a-btn a-btn--danger a-btn--sm", onClick: () => { if (confirm("Remove this photo from the gallery?")) { list.splice(i, 1); touch(); draw(); } } }, "Remove"))))))]));
  };
  async function onSave() {
    bar.busy(true);
    try { await save("gallery", list.map((p) => ({ ...p, caption: (p.caption || "").trim(), alt: (p.alt || "").trim() })), `update gallery (${list.length} photos)`); bar.dirty(false); show(LIVE); }
    catch (x) { show(x.message, "err"); } finally { bar.busy(false); }
  }
  draw();
  return h("div", null,
    Head("Gallery", "The photo grid at the bottom of the website. Each photo keeps its own shape, and the grid arranges itself around them."),
    Card(null, null, drop, status),
    tiles, bar.el);
}

/* ================= website text ================= */
const TEXT = [
  ["Top of the page", null, [["kicker", "Small line above the logo", "Shown on phones held sideways and for visitors who turn animations off."], ["tagline", "Tagline", "Under the logo at the end of the scroll animation."], ["gigs_hero_line", "Gig box when there are no dates", "When a gig is added, this is replaced by the next date automatically."]]],
  ["Latest release", "Your newest album or single. It fills the Spotify box in the scroll animation and the whole Listen section, including the player.", [["release_title", "Title"], ["release_line", "One line about it", "Used in the scroll animation."], ["release_url", "Spotify link", "The album or single's Spotify page. The player on the site plays this."], ["release_apple", "Apple Music link", "Leave blank to use your Apple Music artist page."], ["release_bandcamp", "Bandcamp link", "Leave blank to use your Bandcamp page."], ["release_tracks", "Tracklist", "One song per line, with the length after a bar, e.g.  Old Dog | 3:24", true]]],
  ["Section intros", null, [["gigs_intro", "Gigs"], ["gigs_empty", "Gigs, when there are no dates"], ["listen_intro", "Listen", null, true], ["band_intro", "The band", null, true], ["band_members", "Band members", "Separate names with commas."], ["list_intro", "Mailing list"], ["book_intro", "Bookings"], ["gallery_intro", "Gallery"]]],
  ["Contact and social links", "Anything you leave blank is simply left off the site.", [["email", "Contact email", "Used for the booking button and the footer."], ["list_sender", "Mailing list emails come from", "An address on a domain you've verified with the email service (see the Mailing list page). It can't be a Gmail or Outlook.com address."], ["list_reply_to", "Replies to those emails go to", "Leave blank to use the address above. This one can be any inbox, Gmail included."], ["list_sender_name", "Sender name on those emails", "What fans see in their inbox, e.g. Fizzy Orange."], ["instagram", "Instagram"], ["spotify", "Spotify artist page"], ["apple_music", "Apple Music"], ["bandcamp", "Bandcamp"], ["youtube", "YouTube"], ["tiktok", "TikTok"]]],
];
const LINKS = ["release_url", "release_apple", "release_bandcamp", "instagram", "spotify", "apple_music", "bandcamp", "youtube", "tiktok"];

function SettingsPanel() {
  const f = { ...files.settings.data };
  const bar = SaveBar(onSave);
  const input = (k, long) => {
    const on = (e) => { f[k] = e.target.value; bar.dirty(true); };
    if (long) return h("textarea", { style: { minHeight: "120px" }, value: f[k] ?? "", onInput: on });
    return h("input", { value: f[k] ?? "", type: k === "email" || k === "list_sender" || k === "list_reply_to" ? "email" : LINKS.includes(k) ? "url" : "text", placeholder: LINKS.includes(k) ? "https://" : null, onInput: on });
  };
  async function onSave() {
    const bad = LINKS.map((k) => f[k]).find((u) => u && !/^https:\/\//.test(u.trim()));
    if (bad) return show(`Links need to start with https:// (check "${bad}").`, "err");
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return show("The contact email doesn't look right.", "err");
    for (const [k, what] of [["list_sender", "mailing list sender"], ["list_reply_to", "reply-to"]]) {
      if (f[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f[k].trim())) return show(`The ${what} address doesn't look right.`, "err");
    }
    bar.busy(true);
    try { await save("settings", Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()])), "update the website text"); bar.dirty(false); show(LIVE); }
    catch (x) { show(x.message, "err"); } finally { bar.busy(false); }
  }
  return h("div", null,
    Head("Website text", "The wording and links that appear across the whole site."),
    h("div", { class: "a-form" }, TEXT.map(([title, hint, fields]) => Card(title, hint,
      title === "Latest release" && ImagePicker("Cover", "Square works best.", f.release_cover, (v) => { f.release_cover = v; bar.dirty(true); }),
      h("div", { class: title === "Contact and social links" ? "a-2col" : null, style: title === "Contact and social links" ? null : { display: "grid", gap: "16px" } },
        fields.map(([k, label, hint, long]) => Field(label, input(k, long), hint)))))),
    bar.el);
}

/* ================= mailing list ================= */
const removeMany = (emails) => call("/api/cms/subscribers", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ emails }) });
const copyText = async (text, done) => { try { await navigator.clipboard.writeText(text); show(done); } catch { show("Couldn't copy. Select the text and copy it by hand.", "err"); } };
/** Saves text as a file. The byte-order mark makes Excel and Word read names like "Ciarán" correctly. */
function saveCsv(name, text) {
  h("a", { href: URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" })), download: name }).click();
}
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const UNSUB_LINE = "You're getting this because you joined the Fizzy Orange mailing list. To unsubscribe, use this link:";
const CHECK_LABEL = { deliverable: ["Inbox found", "a-tag--now"], risky: ["Risky", "a-tag--off"], unknown: ["Couldn't tell", "a-tag--off"], unchecked: ["Not checked", "a-tag--off"] };

/** Email everyone: download the list, then mail merge in Outlook or Gmail. One email per fan, with their first name. */
function MergeCard(subs) {
  const origin = location.origin;
  const download = () => {
    const rows = subs.map((s) => [s.name || "there", s.email, `${origin}/unsubscribe/?t=${s.token}`].map(csvCell).join(","));
    saveCsv(`fizzy-orange-mail-merge-${today()}.csv`, "first_name,email,unsubscribe_link\r\n" + rows.join("\r\n") + "\r\n");
    show(`Downloaded ${subs.length} ${subs.length === 1 ? "fan" : "fans"}.`);
  };
  const steps = (...items) => h("ol", { style: { margin: "12px 0 0", paddingLeft: "20px", lineHeight: 1.6, display: "grid", gap: "6px" } }, items.map((i) => h("li", null, i)));
  const b = (t) => h("strong", null, t);
  const guide = (title, open, ...body) => h("details", { open, style: { border: "1px solid var(--line)", borderRadius: "12px", padding: "12px 16px" } },
    h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, title), ...body);
  const example = h("pre", { style: { margin: 0, padding: "14px 16px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "10px", font: "14px/1.6 var(--f-body)", whiteSpace: "pre-wrap" } },
    "Hi «first_name»,\n\nWe're playing The Back Page on Friday 23 October...\n\nSee you down the front,\nFizzy Orange\n\n" + UNSUB_LINE + " «unsubscribe_link»");

  return Card("Email everyone", "One email written once, sent to every fan separately with their own first name. It goes from your own email account, so there's no outside branding.",
    h("div", { class: "a-actions", style: { alignItems: "center" } },
      h("button", { type: "button", class: "a-btn a-btn--primary", disabled: !subs.length, onClick: download }, icon(I.mail), `Download the mail merge list (${subs.length})`),
      h("small", { style: { color: "var(--muted)", fontSize: "13.5px" } }, "Download a fresh copy each time you send, so anyone who unsubscribed is left out.")),
    h("div", { style: { display: "grid", gap: "8px" } },
      h("span", { style: { fontSize: "14px", fontWeight: 500, color: "var(--ink-2)" } }, "What your email will look like"), example,
      h("div", { class: "a-actions" },
        h("button", { type: "button", class: "a-btn a-btn--sm", onClick: () => copyText(UNSUB_LINE, "Copied. Paste it at the bottom, then insert the unsubscribe_link field after it.") }, "Copy the unsubscribe line"),
        h("small", { style: { color: "var(--muted)", fontSize: "13px", alignSelf: "center" } }, "«first_name» and «unsubscribe_link» are filled in for each fan. Fans without a name get \"there\"."))),
    guide("Send from Outlook (luke@sleepover.club is on Microsoft 365)", true,
      steps(
        [b("Download the mail merge list"), " above."],
        ["Open ", b("Word"), " with a blank document. On the ", b("Mailings"), " tab: ", b("Start Mail Merge → E-mail Messages"), "."],
        [b("Select Recipients → Use an Existing List"), " and pick the file you downloaded. If Word asks how to read it, choose ", b("Unicode (UTF-8)"), " and a comma as the separator."],
        ["Write the email. Type \"Hi \", then ", b("Insert Merge Field → first_name"), "."],
        ["At the bottom, paste the unsubscribe line (copy button above), then ", b("Insert Merge Field → unsubscribe_link"), "."],
        [b("Preview Results"), " to flick through a few fans. For a test run, ", b("Edit Recipient List"), " and untick everyone except yourself."],
        [b("Finish & Merge → Send Email Messages"), ". To: ", b("email"), ". Subject: your subject. Mail format: ", b("HTML"), ". Send records: ", b("All"), ". Press OK."],
        ["Outlook sends one email per fan from the account it's signed in to. They appear in Sent Items. Save the Word document to reuse the layout next time."]),
      h("p", { class: "a-note", style: { margin: "12px 0 0" } }, "Needs Word and the classic Outlook app on a computer, with Outlook as the default mail app. It doesn't work from Outlook on the web or the \"new Outlook\". If Word isn't installed with your Microsoft 365 plan, tell the website builder and another route can be set up. Microsoft 365 allows up to 10,000 recipients a day.")),
    guide("Send from Gmail", false,
      steps(
        [b("Download the mail merge list"), " above, then in Google Sheets: ", b("File → Import → Upload"), "."],
        ["In Gmail, ", b("Compose"), ", then the ", b("mail merge"), " button next to To: → ", b("Add from a spreadsheet"), ", pick the sheet and choose the ", b("email"), " column."],
        ["Write the email. Type ", b("@"), " to insert merge tags: ", b("@first_name"), " for the name, and ", b("@unsubscribe_link"), " after the unsubscribe line."],
        ["Send yourself a preview, then press ", b("Send"), ". Each fan gets their own copy."]),
      h("p", { class: "a-note", style: { margin: "12px 0 0" } }, "Gmail's mail merge needs a Google Workspace plan (Business Standard or higher), up to 1,500 emails a day. A free @gmail.com account doesn't have it: ask the website builder for a free Google Sheets alternative.")));
}

/** The instant inbox check (Bouncer): status and balance, or how to switch it on. */
function ChecksCard(c) {
  if (!c.on) {
    const step = (...x) => h("li", { style: { marginBottom: "8px" } }, ...x);
    return Card("Turn on instant email checks", "Checks each new sign-up's inbox really exists, in about a second, and asks the fan to fix it if not. Pay as you go: about $8 for 1,000 checks, no monthly fee. Until it's on, sign-ups still get the free typo and domain checks.",
      h("ol", { style: { margin: 0, paddingLeft: "20px", lineHeight: 1.55 } },
        step("Create an account at ", h("a", { href: "https://www.usebouncer.com", target: "_blank", rel: "noopener" }, "usebouncer.com"), ". It comes with 100 free checks."),
        step("In Bouncer, open ", h("strong", null, "API"), " and create an API key. Copy it."),
        step("In Cloudflare: Workers & Pages → fizzy-orange → Settings → Variables and Secrets → Add. Type: ", h("strong", null, "Secret"), ". Name: ", h("strong", null, "BOUNCER_API_KEY"), ". Paste the key and save."),
        step("Deployments → the latest one → ⋯ → Retry deployment. Then reload this page."),
        step("When the free checks run out, buy credits in Bouncer ($8 for 1,000). They never expire.")),
      h("small", { style: { color: "var(--muted)", fontSize: "13px" } }, "Menu names sometimes move around a little; look for the nearest match."));
  }
  const low = c.credits !== null && c.credits < 100;
  return Card("Instant email checks", null,
    h("p", { style: { margin: 0 } }, `Every new sign-up's inbox is checked with Bouncer. ${c.checked} checked so far, ${c.blocked} turned away because the inbox doesn't exist.`),
    c.credits === null ? h("p", { class: "a-note a-note--warn", style: { margin: 0 } }, "Couldn't read the balance from Bouncer. Checks carry on if there are credits left.")
      : c.credits === 0 ? h("p", { class: "a-note a-note--warn", style: { margin: 0 } }, "Out of checks. Sign-ups still join, but their inbox isn't checked. Buy credits in Bouncer ($8 for 1,000).")
      : h("p", { class: `a-note ${low ? "a-note--warn" : ""}`, style: { margin: 0 } }, `${c.credits} ${c.credits === 1 ? "check" : "checks"} left.${low ? " Running low: buy more in Bouncer ($8 for 1,000)." : ""}`));
}

/** Paste in addresses that bounced (or asked to leave by email) and remove them in one go. */
function RemoveCard(reload) {
  const box = h("textarea", { style: { minHeight: "90px" }, placeholder: "Paste anything that contains the addresses, e.g. the bounce emails, one per line or all together." });
  const btn = h("button", { type: "button", class: "a-btn a-btn--danger", onClick: async () => {
    const emails = [...new Set((box.value.toLowerCase().match(/[^\s<>(),;:"']+@[^\s<>(),;:"']+\.[a-z]{2,}/g) || []))];
    if (!emails.length) return show("No email addresses found in that text.", "err");
    if (!confirm(`Remove ${emails.length} ${emails.length === 1 ? "address" : "addresses"} from the list?\n\n${emails.slice(0, 12).join("\n")}${emails.length > 12 ? "\n…" : ""}`)) return;
    try { const r = await removeMany(emails); box.value = ""; show(`Removed ${r.removed}.`); await reload(); } catch (x) { show(x.message, "err"); }
  } }, "Remove these addresses");
  return Card("Remove addresses in bulk", "For emails that bounced back, or fans who replied asking to leave. Fans who use the unsubscribe link are removed automatically.",
    Field("Addresses", box), h("div", { class: "a-actions" }, btn));
}

const mailApi = (body) => call("/api/cms/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Saved email designs, and the way into the designer. */
function EmailsCard(mail, reload) {
  const rows = mail.designs;
  const act = (label, fn, danger) => h("button", { type: "button", class: `a-btn a-btn--sm ${danger ? "a-btn--danger" : ""}`, onClick: async (e) => { e.preventDefault(); try { if ((await fn()) !== false) await reload(); } catch (x) { show(x.message, "err"); } } }, label);
  return Card("Emails", "Design an email with pictures, buttons and your colours, then send every fan their own copy with their first name.",
    h("div", { class: "a-actions" }, h("a", { class: "a-btn a-btn--primary", href: "#/email/new" }, icon(I.plus), "Design a new email")),
    rows.length ? h("div", { class: "a-rows" }, rows.map((d) => h("div", { class: "a-row", style: { cursor: "default" } },
      h("span", { class: "a-row__img a-row__img--ph", "aria-hidden": "true" }, "✉"),
      h("span", null, h("span", { class: "a-row__t" }, d.name), h("span", { class: "a-row__s" }, `${d.subject || "No subject yet"} · saved ${d.updated_at.slice(0, 16)}`)),
      h("span", { class: "a-row__end a-actions" },
        h("a", { class: "a-btn a-btn--sm", href: `#/email/${d.id}` }, "Open"),
        act("Copy", () => mailApi({ action: "duplicate", id: d.id })),
        act("Delete", async () => { if (!confirm(`Delete "${d.name}"?\n\nThis cannot be undone.`)) return false; await mailApi({ action: "delete", id: d.id }); }, true)))))
      : h("p", { style: { margin: 0, color: "var(--muted)" } }, "No emails yet. Your first one starts from a Fizzy Orange layout you can change."));
}

/** Which email service is connected, what's left to set up, and the plan for a bigger list. */
function SendingCard(mail) {
  const st = mail.status, from = mail.sender, domain = (from.email.split("@")[1] || "the band's domain");
  const fromText = from.email || "the band's own address";
  const tick = (ok, yes, no) => h("li", { style: { display: "flex", gap: "10px", alignItems: "baseline" } },
    h("span", { "aria-hidden": "true", style: { color: ok ? "#2f7a3a" : "var(--danger)", fontWeight: 700 } }, ok ? "✓" : "✗"), h("span", null, ok ? yes : no));
  const steps = (...items) => h("ol", { style: { margin: "10px 0 0", paddingLeft: "20px", lineHeight: 1.55, display: "grid", gap: "6px" } }, items.map((x) => h("li", null, x)));
  const b = (t) => h("strong", null, t);
  const cf = "In Cloudflare: Workers & Pages → fizzy-orange → Settings → Variables and Secrets → Add.";
  const sesPlan = h("details", { style: { border: "1px solid var(--line)", borderRadius: "12px", padding: "12px 16px" } },
    h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "When the list passes 100 fans: move to Amazon SES ($0.10 per 1,000 emails, no monthly fee)"),
    h("p", { style: { margin: "10px 0 0" } }, "Resend's free plan sends 100 emails a day, so a list of 300 takes three days per email. Amazon SES sends them all at once for a few cents. The designer, the list and everything here stay the same: only the delivery changes."),
    steps(
      ["Create an account at ", h("a", { href: "https://aws.amazon.com/ses/", target: "_blank", rel: "noopener" }, "aws.amazon.com"), " (it asks for a card; you're only charged for what you send)."],
      ["Open ", b("Amazon SES"), ", choose the region ", b("Europe (Ireland)"), ", and verify the domain ", b(domain), ". It gives DNS records to add where that domain is managed, like Resend's."],
      ["Still in SES, ", b("request production access"), " (a short form about what you send; Amazon usually answers within a day). Until then SES only delivers to addresses you've verified."],
      ["In ", b("IAM"), ", create a user with the ", b("AmazonSESFullAccess"), " permission and create an ", b("access key"), " for it."],
      [cf, " Add two Secrets, ", b("AWS_ACCESS_KEY_ID"), " and ", b("AWS_SECRET_ACCESS_KEY"), ", and a plain Text value ", b("AWS_REGION"), " = eu-west-1. Then Deployments → latest → Retry deployment."],
      ["Reload this page. It will show Amazon SES as connected, with one last address to paste into Amazon so bounced emails are removed automatically."]));

  if (!st.provider) {
    return Card("Email sending: connect Resend to start", "Free for 3,000 emails a month (100 a day), with no branding on your emails. You can design emails now; sending needs this.",
      steps(
        ["Create a free account at ", h("a", { href: "https://resend.com", target: "_blank", rel: "noopener" }, "resend.com"), ". Use an email address you can check: test emails go there."],
        ["In Resend, open ", b("API Keys"), " → ", b("Create API key"), " with ", b("Full access"), ". Copy it."],
        [cf, " Type: ", b("Secret"), ". Name: ", b("RESEND_API_KEY"), ". Paste the key and save."],
        ["Deployments → the latest one → ⋯ → Retry deployment. Reload this page. You can now send tests to your own address."],
        ["To send to fans from ", b(fromText), ": in Resend open ", b("Domains → Add domain"), ", enter ", b(domain), ", add the DNS records it shows wherever that domain is managed, then press ", b("Verify"), ". The address is set under Website text."]),
      sesPlan);
  }
  if (!st.ok) return Card("Email sending", null, h("p", { class: "a-note a-note--warn", style: { margin: 0 } }, st.message || "The email service didn't answer. Reload the page to try again."));

  if (st.provider === "resend") {
    const verified = !st.senderProblem && st.domainStatus === "verified";
    return Card("Email sending: Resend", null,
      h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" } },
        tick(true, "Connected to Resend. Send a test works to the email address you signed up to Resend with.", ""),
        tick(verified, `${domain} is verified: emails go to fans from ${from.name} <${from.email}>.`,
          st.senderProblem ? st.senderProblem
            : st.domainStatus === "missing" ? `To send to fans from ${from.email}, add ${domain} in Resend: Domains → Add domain → ${domain}, add the DNS records it shows wherever ${domain} is managed, then press Verify. Until then only tests to your own Resend address work.`
            : `${domain} is added in Resend but not verified yet (status: ${st.domainStatus}). Check the DNS records where ${domain} is managed, then press Verify in Resend.`),
        tick(st.hook, "Addresses that bounce or report spam are removed automatically.", "Couldn't set up automatic bounce removal. Reload this page to try again.")),
      h("p", { class: "a-note", style: { margin: 0 } }, `Free plan: 100 emails a day. With ${mail.onList} on the list, a send ${mail.onList > 100 ? `takes ${Math.ceil(mail.onList / 100)} days: it pauses at the limit and Continue sending picks it up the next day.` : "goes out in one go."}`),
      sesPlan);
  }
  // Amazon SES
  const hook = h("input", { value: st.hookUrl, readOnly: true, style: { flex: "1 1 260px", font: "inherit", padding: "9px 12px", border: "1px solid var(--line-2)", borderRadius: "10px" }, onFocus: (e) => e.target.select() });
  return Card("Email sending: Amazon SES", null,
    h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" } },
      tick(!st.senderProblem, `Connected to Amazon SES (${st.region}). Emails go from ${from.name} <${from.email}>.`, st.senderProblem || ""),
      st.production !== null && tick(st.production, "Production access is on: you can send to anyone.", "Still in Amazon's test mode (sandbox): only verified addresses receive emails. Request production access in SES."),
      st.perDay !== null && tick(true, `Amazon allows ${Math.round(st.perDay).toLocaleString()} emails a day (${Math.round(st.sentToday || 0).toLocaleString()} sent in the last 24 hours).`, "")),
    h("details", { style: { border: "1px solid var(--line)", borderRadius: "12px", padding: "12px 16px" } },
      h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "One-time step: remove bounced addresses automatically"),
      steps(
        ["In ", b("Amazon SNS"), ", create a ", b("Standard topic"), " (any name)."],
        ["In that topic, ", b("Create subscription"), ": protocol ", b("HTTPS"), ", endpoint the address below. It confirms itself."],
        ["In ", b("Amazon SES → Identities → " + domain + " → Notifications"), ", set ", b("Bounce"), " and ", b("Complaint"), " feedback to that topic."]),
      h("div", { class: "a-actions", style: { marginTop: "10px", alignItems: "center" } }, hook, h("button", { type: "button", class: "a-btn a-btn--sm", onClick: () => copyText(st.hookUrl, "Address copied.") }, "Copy"))));
}

/** Emails already sent, and any still part-way through a daily limit. */
function PastCard(mail, reload) {
  const rows = mail.mailings;
  if (!rows.length) return null;
  return Card("Sent emails", null, h("div", { class: "a-rows" }, rows.map((m) => {
    const cont = m.remaining > 0 && h("button", { type: "button", class: "a-btn a-btn--sm a-btn--primary", onClick: async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      let sent = 0, stop = null;
      try {
        for (;;) { btn.textContent = `Sending… ${sent} more`; const r = await mailApi({ action: "send", id: m.id }); sent += r.sent; if (r.stop) { stop = r.stop; break; } if (!r.remaining || (!r.sent && !r.failed)) break; }
        show(stop ? `Sent ${sent} more, then stopped: ${stop}` : `Done: sent to ${sent} more.`, stop ? "err" : null);
      } catch (x) { show(x.message, "err"); }
      await reload();
    } }, m.sent + m.failed ? `Continue sending (${m.remaining} left)` : `Send now (${m.remaining} waiting)`);
    return h("div", { class: "a-row", style: { cursor: "default" } },
      h("span", { class: "a-row__img a-row__img--ph", "aria-hidden": "true" }, "✉"),
      h("span", null, h("span", { class: "a-row__t" }, m.subject), h("span", { class: "a-row__s" }, `${m.created_at.slice(0, 16)} · sent to ${m.sent}${m.failed ? ` · ${m.failed} undeliverable` : ""}`)),
      h("span", { class: "a-row__end" }, cont || h("span", { class: "a-tag a-tag--now" }, m.sent + m.failed ? "Sent" : "Not sent")));
  })));
}

function SubscribersPanel() {
  const root = h("div", null, h("div", { class: "a-empty" }, h("div", { class: "a-spin" }), h("p", null, "Loading…")));
  const load = () => Promise.all([listSubscribers(), call("/api/cms/mail")]).then(([r, mail]) => draw(r, mail)).catch((e) => root.replaceChildren(h("p", { class: "a-err", role: "alert" }, e.message)));
  function draw({ subscribers: subs, checks }, mail) {
    const link = `${location.origin}/join/`;
    const dl = h("button", { class: "a-btn", disabled: !subs.length, onClick: () => {
      saveCsv("fizzy-orange-mailing-list.csv", "first_name,email,inbox_check,joined\r\n" + subs.map((s) => [s.name, s.email, (CHECK_LABEL[s.verified || "unchecked"] || CHECK_LABEL.unchecked)[0], s.created_at].map(csvCell).join(",")).join("\r\n") + "\r\n");
      show("Downloaded.");
    } }, "Download as a spreadsheet");
    root.replaceChildren(
      Head("Mailing list", `${subs.length} on the list.`, dl),
      h("div", { class: "a-form" },
        Card("Your sign-up link", "Share it on Instagram, TikTok, posters and QR codes. It opens a page with just the sign-up form.",
          h("div", { class: "a-actions", style: { alignItems: "center" } },
            h("input", { value: link, readOnly: true, style: { flex: "1 1 260px", font: "inherit", padding: "10px 12px", border: "1px solid var(--line-2)", borderRadius: "10px" }, onFocus: (e) => e.target.select() }),
            h("button", { type: "button", class: "a-btn a-btn--primary", onClick: () => copyText(link, "Link copied.") }, "Copy link"),
            h("a", { class: "a-btn", href: link, target: "_blank", rel: "noopener" }, "Open"))),
        EmailsCard(mail, load), PastCard(mail, load), SendingCard(mail), ChecksCard(checks),
        h("details", { class: "a-fold" }, h("summary", null, "Send from your own Outlook or Gmail instead (mail merge, plain layout)"), MergeCard(subs)),
        RemoveCard(load),
        !subs.length ? Empty("No sign-ups yet", "Share your sign-up link and fans will appear here.")
          : h("div", { class: "a-card", style: { overflowX: "auto" } }, h("table", { class: "a-table" },
            h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Email"), h("th", null, "Inbox check"), h("th", null, "Joined"), h("th"))),
            h("tbody", null, subs.map((s) => {
              const [label, cls] = CHECK_LABEL[s.verified || "unchecked"] || CHECK_LABEL.unchecked;
              return h("tr", null,
                h("td", null, s.name || h("span", { style: { color: "var(--muted)" } }, "(no name)")),
                h("td", null, s.email),
                h("td", null, h("span", { class: `a-tag ${cls}` }, label)),
                h("td", { style: { color: "var(--muted)", whiteSpace: "nowrap" } }, s.created_at.slice(0, 10)),
                h("td", { style: { textAlign: "right" } }, h("button", { class: "a-btn a-btn--danger a-btn--sm", onClick: async () => {
                  if (!confirm(`Remove ${s.email} from the list?`)) return;
                  try { await removeSubscriber(s.email); await load(); show("Removed."); } catch (x) { show(x.message, "err"); }
                } }, "Remove")));
            }))))));
  }
  load();
  return root;
}

/* ================= start ================= */
loadAll().then((r) => { files = r.files; editor = r.editor; route(); }).catch((e) => {
  document.getElementById("app").replaceChildren(h("div", { class: "a-centre" }, h("div", { class: "a-card" },
    h("h1", null, "Can't open the admin"), h("p", null, e.message),
    h("button", { class: "a-btn a-btn--primary", onClick: () => location.reload() }, "Try again"))));
});
