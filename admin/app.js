// Fizzy Orange admin. The same workspace as the Sleepover Club admin, in plain JavaScript
// (the site has no build tooling). Content lives in content/*.json in the GitHub repo;
// every save is a commit made by functions/api/cms/content.ts, and Cloudflare rebuilds
// the site about a minute later. Login is Cloudflare Access (email + one-time code).

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
async function toWebp(file, max) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process that image."))), "image/webp", 0.82));
}
const b64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
  fr.onerror = () => rej(new Error("Couldn't read that file."));
  fr.readAsDataURL(blob);
});
async function upload(file) {
  let blob = file, ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: please choose an image.`);
  if (file.type !== "image/gif") { blob = await toWebp(file, 2000); ext = "webp"; }
  const r = await call(`/api/cms/upload?ext=${ext}`, { method: "POST", body: await b64(blob) });
  previews.set(r.url, URL.createObjectURL(blob));
  return r.url;
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
function ImagePicker(label, hint, value, onChange) {
  const wrap = h("div", { class: "a-field" });
  const err = h("p", { class: "a-err", role: "alert", hidden: true });
  const render = () => {
    const input = h("input", { type: "file", accept: "image/*", hidden: true, onChange: async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      pick.textContent = "Uploading…"; pick.style.cursor = "progress"; err.hidden = true;
      try { value = await upload(f); onChange(value); } catch (x) { err.textContent = x.message; err.hidden = false; }
      render();
    } });
    const pick = h("label", { class: "a-btn", style: { cursor: "pointer" } }, value ? "Replace" : "Choose image", input);
    wrap.replaceChildren(h("span", null, label), h("div", { class: "a-pick" },
      value ? h("img", { class: "a-pick__prev", src: src(value), alt: "" }) : h("div", { class: "a-pick__prev a-pick__ph" }, "No image yet"),
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
  ["#/photos", "Band photos", I.media], ["#/text", "Website text", I.text], ["#/list", "Mailing list", I.mail],
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
  else if (section === "text") view = SettingsPanel();
  else if (section === "list") view = SubscribersPanel();
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

  return h("div", null,
    Head("Home", `Everything you change here appears on ${SITE} about a minute after you save.`,
      h("a", { class: "a-btn a-btn--primary", href: "#/gigs/new" }, icon(I.plus), "Add a gig")),
    h("div", { class: "a-stats" },
      [[upcoming.length, "Upcoming gigs"], [gigs.length, "Gigs in total"], [press.length, "Press articles"], [files.photos.data.length, "Band photos"]]
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
        h("span", { class: "a-row__img a-row__img--ph" }, g.date.slice(8, 10)),
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
  const g = { id: uid(), date: "", venue: "", city: "Dublin", url: "", soldOut: false, published: true, ...(existing ?? {}) };
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
          h("span", { class: "a-row__img a-row__img--ph" }, i + 1),
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
  const p = { id: uid(), outlet: "", headline: "", url: "", published: true, ...(existing ?? {}) };
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

/* ================= website text ================= */
const TEXT = [
  ["Top of the page", null, [["kicker", "Small line above the logo", "Shown on phones held sideways and for visitors who turn animations off."], ["tagline", "Tagline", "Under the logo at the end of the scroll animation."], ["gigs_hero_line", "Gig box when there are no dates", "When a gig is added, this is replaced by the next date automatically."]]],
  ["Latest release", "The Spotify box in the scroll animation and the card in the Listen section.", [["release_title", "Title"], ["release_line", "One line about it"], ["release_url", "Spotify link", "Leave blank to hide the button."]]],
  ["Section intros", null, [["gigs_intro", "Gigs"], ["gigs_empty", "Gigs, when there are no dates"], ["listen_intro", "Listen", null, true], ["band_intro", "The band", null, true], ["band_members", "Band members", "Separate names with commas."], ["list_intro", "Mailing list"], ["book_intro", "Bookings"]]],
  ["Contact and social links", "Anything you leave blank is simply left off the site.", [["email", "Contact email", "Used for the booking button and the footer."], ["instagram", "Instagram"], ["spotify", "Spotify artist page"], ["apple_music", "Apple Music"], ["bandcamp", "Bandcamp"], ["youtube", "YouTube"], ["tiktok", "TikTok"]]],
];
const LINKS = ["release_url", "instagram", "spotify", "apple_music", "bandcamp", "youtube", "tiktok"];

function SettingsPanel() {
  const f = { ...files.settings.data };
  const bar = SaveBar(onSave);
  const input = (k, long) => {
    const on = (e) => { f[k] = e.target.value; bar.dirty(true); };
    if (long) return h("textarea", { style: { minHeight: "120px" }, value: f[k] ?? "", onInput: on });
    return h("input", { value: f[k] ?? "", type: k === "email" ? "email" : LINKS.includes(k) ? "url" : "text", placeholder: LINKS.includes(k) ? "https://" : null, onInput: on });
  };
  async function onSave() {
    const bad = LINKS.map((k) => f[k]).find((u) => u && !/^https:\/\//.test(u.trim()));
    if (bad) return show(`Links need to start with https:// (check "${bad}").`, "err");
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return show("The contact email doesn't look right.", "err");
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
function SubscribersPanel() {
  const body = h("div", null, h("div", { class: "a-empty" }, h("div", { class: "a-spin" }), h("p", null, "Loading…")));
  const count = h("span");
  let subs = [];
  const dl = h("button", { class: "a-btn a-btn--primary", disabled: true, onClick: () => {
    const csv = "email,joined\n" + subs.map((s) => `${s.email},${s.created_at}`).join("\n");
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "fizzy-orange-mailing-list.csv" });
    a.click(); show("Downloaded.");
  } }, "Download as a spreadsheet");
  const load = () => listSubscribers().then((r) => {
    subs = r.subscribers; dl.disabled = !subs.length; count.textContent = `${subs.length} so far.`;
    body.replaceChildren(!subs.length ? Empty("No sign-ups yet", "When someone joins the list on the website, they'll appear here.")
      : h("div", { class: "a-card" }, h("table", { class: "a-table" },
        h("thead", null, h("tr", null, h("th", null, "Email"), h("th", null, "Joined"), h("th"))),
        h("tbody", null, subs.map((s) => h("tr", null, h("td", null, s.email), h("td", { style: { color: "var(--muted)" } }, s.created_at.slice(0, 10)),
          h("td", { style: { textAlign: "right" } }, h("button", { class: "a-btn a-btn--danger a-btn--sm", onClick: async () => {
            if (!confirm(`Remove ${s.email} from the list?`)) return;
            try { await removeSubscriber(s.email); await load(); show("Removed."); } catch (x) { show(x.message, "err"); }
          } }, "Remove"))))))));
  }).catch((e) => body.replaceChildren(h("p", { class: "a-err", role: "alert" }, e.message)));
  load();
  return h("div", null,
    h("div", { class: "a-head" }, h("div", null, h("h1", null, "Mailing list"), h("p", null, "Everyone who signed up on the website. ", count)), h("div", { class: "a-actions" }, dl)),
    h("p", { class: "a-note", style: { marginBottom: "18px" } }, "Download the list and import it into Mailchimp, Klaviyo or DICE when you announce a gig. Nobody is emailed from here."),
    body);
}

/* ================= start ================= */
loadAll().then((r) => { files = r.files; editor = r.editor; route(); }).catch((e) => {
  document.getElementById("app").replaceChildren(h("div", { class: "a-centre" }, h("div", { class: "a-card" },
    h("h1", null, "Can't open the admin"), h("p", null, e.message),
    h("button", { class: "a-btn a-btn--primary", onClick: () => location.reload() }, "Try again"))));
});
