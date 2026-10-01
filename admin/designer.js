// The email designer: a full-screen drag-and-drop editor (GrapesJS, open source, loaded on demand)
// with a Fizzy Orange starter email and brand blocks. A design is saved as the editor's project plus
// the finished HTML, which the server personalises for each fan when it's sent.
//   {first_name}        becomes each fan's first name (in the subject and anywhere in the email)
//   {unsubscribe_link}  becomes each fan's own unsubscribe link (added automatically if left out)

const GJS = "https://cdn.jsdelivr.net/npm/grapesjs@0.22.16";
const PRESET = "https://cdn.jsdelivr.net/npm/grapesjs-preset-newsletter@1.0.2/dist/index.js";
const INK = "#1F1A18", CREAM = "#FBF8F0", PEEL = "#EE6605", DEEP = "#C9500C", FONT = "Arial, Helvetica, sans-serif", SERIF = "Georgia, 'Times New Roman', serif";

let libs = null;
function loadLibs() {
  libs ??= new Promise((res, rej) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = `${GJS}/dist/css/grapes.min.css`; document.head.append(css);
    const add = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("Couldn't load the email editor. Check your connection and try again.")); document.head.append(s); });
    add(`${GJS}/dist/grapes.min.js`).then(() => add(PRESET)).then(res, (e) => { libs = null; rej(e); });
  });
  return libs;
}

/* ---------- the pieces emails are built from (tables and inline styles, as email apps need) ---------- */
const btn = (label, href = "https://") => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr><td style="background-color:${DEEP};border:3px solid ${INK};border-radius:15px;"><a href="${href}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:17px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;">${label}</a></td></tr></table>`;
const footer = `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:#ffffff;">You're getting this because you joined the Fizzy Orange mailing list.<br><a href="{unsubscribe_link}" style="color:#ffffff;font-weight:bold;">Unsubscribe</a></p>`;
const starter = (origin) => `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${PEEL};"><tr><td align="center" style="padding:28px 14px 36px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:0 0 18px;"><img src="${origin}/assets/email/logo.png" width="210" alt="Fizzy Orange" style="display:block;width:210px;max-width:100%;height:auto;"></td></tr>
<tr><td style="background-color:${CREAM};border:3px solid ${INK};border-radius:18px;padding:30px 28px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};">
<h1 style="margin:0 0 16px;font-family:${SERIF};font-size:30px;line-height:1.15;color:${INK};">Hi {first_name},</h1>
<p style="margin:0 0 16px;">Write your news here. Double-click any text to change it, and drag blocks in from the right to add pictures, buttons and more.</p>
${btn("Get tickets", origin)}
<p style="margin:0;">See you down the front,<br>Fizzy Orange</p>
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;">${footer}</td></tr>
</table></td></tr></table>`;

function blocks(origin, links) {
  const media = (d) => `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const social = links.length ? links.map(([label, url]) => `<a href="${url}" style="color:${INK};font-weight:bold;">${label}</a>`).join(" &nbsp;·&nbsp; ") : `<a href="https://" style="color:${INK};font-weight:bold;">Instagram</a>`;
  return [
    ["fo-heading", "Heading", media('<path d="M5 5v14M19 5v14M5 12h14"/>'), `<h2 style="margin:0 0 14px;font-family:${SERIF};font-size:24px;line-height:1.2;color:${INK};">A heading</h2>`],
    ["fo-text", "Text", media('<path d="M4 6h16M4 11h16M4 16h10"/>'), `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};">Write here. Use the bar above the text for bold, links and the fan's first name.</p>`],
    ["fo-button", "Button", media('<rect x="3" y="8" width="18" height="8" rx="3"/><path d="M9 12h6"/>'), btn("Get tickets")],
    ["fo-image", "Picture", media('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>'), { type: "image", activeOnRender: 1, attributes: { alt: "" }, style: { display: "block", width: "100%", "max-width": "100%", height: "auto", border: `3px solid ${INK}`, "border-radius": "12px", margin: "0 0 16px" } }],
    ["fo-gig", "Gig", media('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'), `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;"><tr><td style="background-color:#ffffff;border:3px solid ${INK};border-radius:14px;padding:18px 20px;font-family:${FONT};color:${INK};"><p style="margin:0 0 4px;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${DEEP};">Fri 23 Oct · Doors 8pm</p><h3 style="margin:0 0 4px;font-family:${SERIF};font-size:22px;line-height:1.2;">The Back Page</h3><p style="margin:0 0 12px;font-size:15px;">Dublin</p>${btn("Get tickets")}</td></tr></table>`],
    ["fo-2col", "Two columns", media('<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>'), `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;"><tr><td width="50%" valign="top" style="width:50%;padding:0 8px 0 0;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};"><p style="margin:0;">Left column</p></td><td width="50%" valign="top" style="width:50%;padding:0 0 0 8px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};"><p style="margin:0;">Right column</p></td></tr></table>`],
    ["fo-divider", "Line", media('<path d="M4 12h16"/>'), `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="padding:6px 0 20px;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="border-top:3px solid ${INK};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table></td></tr></table>`],
    ["fo-space", "Space", media('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>'), `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`],
    ["fo-logo", "Logo", media('<circle cx="12" cy="13" r="7"/><path d="M12 6c1-2 3-3 5-2-1 2-3 3-5 2z"/>'), `<img src="${origin}/assets/email/logo.png" width="210" alt="Fizzy Orange" style="display:block;width:210px;max-width:100%;height:auto;margin:0 auto 18px;">`],
    ["fo-social", "Links", media('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">${social}</p>`],
    ["fo-footer", "Unsubscribe footer", media('<path d="M4 18h16M7 14h10"/>'), footer],
  ];
}

/* ---------- pictures: shrunk in the browser, then stored for emails ---------- */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1200 / bmp.width);
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext("2d");
  const png = file.type === "image/png";
  if (!png) { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(bmp, 0, 0, c.width, c.height);
  let type = png ? "png" : "jpg";
  let blob = await new Promise((r) => c.toBlob(r, png ? "image/png" : "image/jpeg", 0.86));
  // a big PNG (a photo saved as PNG) is far smaller as a JPEG
  if (png && blob.size > 700_000) { type = "jpg"; x.globalCompositeOperation = "destination-over"; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86)); }
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(new Error("Couldn't read that picture.")); fr.readAsDataURL(blob); });
  return { type, data, w: c.width, h: c.height };
}

export function EmailDesigner(id, ctx) {
  const { h, icon, I, call, show, who, setDirty, links } = ctx;
  const api = (body) => call("/api/cms/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const origin = location.origin;
  let editor = null, designId = id === "new" ? null : id, info = null, saved = true, busy = false;

  const name = h("input", { class: "d-name", placeholder: "Name this email (only you see it)", "aria-label": "Email name" });
  const subject = h("input", { placeholder: "e.g. {first_name}, we're playing The Back Page", "aria-label": "Subject" });
  const preheader = h("input", { placeholder: "The short line shown after the subject in the inbox (optional)", "aria-label": "Preview line" });
  const state = h("span", { class: "d-state" }, "");
  const canvas = h("div", { id: "gjs" });
  const loading = h("div", { class: "d-loading" }, h("div", { class: "a-spin" }), h("p", null, "Opening the designer…"));
  const mark = (ok) => { saved = ok; setDirty(!ok); state.textContent = ok ? "Saved" : "Unsaved changes"; state.dataset.dirty = ok ? "" : "1"; };
  [name, subject, preheader].forEach((i) => i.addEventListener("input", () => mark(false)));

  // the finished email: the editor's content with its styles written into each element, in a full page
  function finished() {
    const inner = editor.runCommand("gjs-get-inlined-html");
    const bg = editor.getWrapper().getStyle()["background-color"] || PEEL;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${subject.value.replace(/[<>&]/g, "")}</title></head><body style="margin:0;padding:0;background-color:${bg};">${inner}</body></html>`;
  }
  const current = () => ({ name: name.value, subject: subject.value, preheader: preheader.value, html: finished() });

  async function save(quiet) {
    const r = await api({ action: "save", id: designId, ...current(), project: JSON.stringify(editor.getProjectData()) });
    if (!designId) { designId = r.id; history.replaceState(null, "", `#/email/${r.id}`); }
    mark(true);
    if (!quiet) show("Saved.");
  }
  const guard = (fn) => async () => { if (busy || !editor) return; busy = true; root.dataset.busy = "1"; try { await fn(); } catch (x) { show(x.message, "err"); } finally { busy = false; delete root.dataset.busy; } };

  function modal(title, ...body) {
    const close = () => wrap.remove();
    const wrap = h("div", { class: "d-modal", onClick: (e) => { if (e.target === wrap) close(); } },
      h("div", { class: "d-modal__box", role: "dialog", "aria-label": title },
        h("div", { class: "d-modal__head" }, h("h2", null, title), h("button", { type: "button", class: "a-btn a-btn--sm", onClick: close }, "Close")), ...body));
    root.append(wrap);
    return { close, wrap };
  }

  const onPreview = guard(async () => {
    const r = await api({ action: "preview", ...current() });
    const frame = h("iframe", { title: "Email preview", class: "d-preview" });
    frame.srcdoc = r.html;
    const size = (w) => () => { frame.style.width = w; };
    modal("Preview",
      h("p", { class: "d-modal__note" }, h("strong", null, "Subject: "), r.subject, h("br"), `"Aoife" stands in for each fan's first name.`,
        r.ownUnsubscribe ? "" : " This email has no unsubscribe link of its own, so one is added at the bottom automatically."),
      h("div", { class: "a-actions" }, h("button", { type: "button", class: "a-btn a-btn--sm", onClick: size("100%") }, "Computer"), h("button", { type: "button", class: "a-btn a-btn--sm", onClick: size("375px") }, "Phone")),
      h("div", { class: "d-preview__wrap" }, frame));
  });

  const onTest = guard(async () => {
    const to = h("input", { type: "email", value: who });
    const go = h("button", { type: "button", class: "a-btn a-btn--primary", onClick: async () => {
      go.disabled = true; go.textContent = "Sending…";
      try { const r = await api({ action: "test", ...current(), to: to.value }); show(r.message); m.close(); }
      catch (x) { show(x.message, "err"); go.disabled = false; go.textContent = "Send the test"; }
    } }, "Send the test");
    const m = modal("Send a test", h("label", { class: "a-field" }, h("span", null, "Send it to"), to, h("small", null, `It arrives marked [Test], with "Aoife" as the first name. Nothing goes to the list.`)), h("div", { class: "a-actions" }, go));
  });

  const onSend = guard(async () => {
    const n = info.onList;
    if (!info.status.provider) return show("Connect an email service first (the steps are on the Mailing list page).", "err");
    if (!n) return show("Nobody is on the list yet.", "err");
    if (!subject.value.trim()) { subject.focus(); return show("Add a subject line first.", "err"); }
    if (!confirm(`Send "${subject.value.trim()}" to ${n} ${n === 1 ? "fan" : "fans"}?\n\nEach fan gets their own copy with their first name. This can't be undone.`)) return;
    await save(true);
    const c = await api({ action: "create", id: designId });
    const bar = h("i"), text = h("p", null, `Sending… 0 of ${c.total}. Keep this page open.`);
    const m = modal("Sending", h("div", { class: "d-progress" }, bar), text);
    let sent = 0, failed = 0, stop = null;
    for (;;) {
      const r = await api({ action: "send", id: c.id });
      sent += r.sent; failed += r.failed;
      bar.style.width = `${Math.round(((sent + failed) / Math.max(1, c.total)) * 100)}%`;
      text.textContent = `Sending… ${sent + failed} of ${c.total}. Keep this page open.`;
      if (r.stop) { stop = r.stop; break; }
      if (!r.remaining || (!r.sent && !r.failed)) break;
    }
    text.textContent = stop ? `Sent to ${sent} of ${c.total} so far. It stopped because: ${stop} The rest are waiting: open the Mailing list page and press Continue sending.`
      : `Done. Sent to ${sent} ${sent === 1 ? "fan" : "fans"}${failed ? `, and ${failed} couldn't be delivered` : ""}.`;
    m.wrap.querySelector(".d-progress").dataset.done = "1";
  });

  const back = h("a", { class: "a-btn a-btn--quiet a-btn--sm", href: "#/list" }, icon(I.back), "Mailing list");
  const sendBtn = h("button", { type: "button", class: "a-btn a-btn--primary", onClick: onSend }, icon(I.mail), "Send…");
  const root = h("div", { class: "d-wrap" },
    h("header", { class: "d-bar" }, back, name, state,
      h("div", { class: "a-actions" },
        h("button", { type: "button", class: "a-btn", onClick: onPreview }, "Preview"),
        h("button", { type: "button", class: "a-btn", onClick: onTest }, "Send a test"),
        h("button", { type: "button", class: "a-btn", onClick: guard(() => save()) }, "Save"), sendBtn)),
    h("div", { class: "d-meta" },
      h("label", null, h("span", null, "Subject"), subject),
      h("label", null, h("span", null, "Preview line"), preheader),
      h("small", null, "Type {first_name} anywhere, here or in the email, for the fan's first name.")),
    h("div", { class: "d-stage" }, canvas, loading));

  (async () => {
    try {
      const [, list, one] = await Promise.all([loadLibs(), call("/api/cms/mail"), designId ? call(`/api/cms/mail?design=${encodeURIComponent(designId)}`) : null]);
      info = list;
      sendBtn.lastChild.textContent = `Send to ${list.onList} ${list.onList === 1 ? "fan" : "fans"}`;
      editor = window.grapesjs.init({
        container: canvas, height: "100%", width: "auto", fromElement: false, storageManager: false, noticeOnUnload: false,
        plugins: ["grapesjs-preset-newsletter"],
        pluginsOpts: { "grapesjs-preset-newsletter": { modalTitleImport: "Paste email HTML", modalTitleExport: "The email's HTML", inlineCss: true, showStylesOnChange: true, showBlocksOnLoad: true, useCustomTheme: false } },
        assetManager: {
          assets: list.images, upload: "/api/cms/mail", multiUpload: true, dropzone: false, embedAsBase64: false,
          uploadText: "Drop pictures here, or click to choose", addBtnText: "Add picture", modalTitle: "Choose a picture",
          uploadFile: async (e) => {
            const files = [...((e.dataTransfer ? e.dataTransfer.files : e.target.files) || [])].filter((f) => f.type.startsWith("image/"));
            for (const f of files) {
              try { const r = await api({ action: "image", ...(await shrink(f)) }); editor.AssetManager.add({ src: r.src, width: r.width, height: r.height }); }
              catch (x) { show(x.message, "err"); }
            }
          },
        },
      });
      const bm = editor.BlockManager;
      blocks(origin, links).forEach(([bid, label, media, content]) => bm.add(bid, { label, media, content, category: { id: "fo", label: "Fizzy Orange", order: -1, open: true }, select: true, activate: typeof content === "object" }));
      editor.RichTextEditor.add("firstName", { icon: "<b style='font-size:11px;white-space:nowrap'>First name</b>", attributes: { title: "Insert the fan's first name" }, result: (rte) => rte.insertHTML("{first_name}") });
      if (one) {
        name.value = one.design.name; subject.value = one.design.subject; preheader.value = one.design.preheader;
        if (one.design.project) editor.loadProjectData(JSON.parse(one.design.project)); else editor.setComponents(one.design.html || starter(origin));
      } else {
        name.value = `Email ${new Date().toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`;
        editor.setComponents(starter(origin));
      }
      editor.getWrapper().setStyle({ "background-color": editor.getWrapper().getStyle()["background-color"] || PEEL });
      loading.remove();
      mark(!!one);
      // "update" fires once while the first content settles; count changes only after that
      setTimeout(() => { editor.on("update", () => mark(false)); editor.UndoManager.clear(); }, 600);
    } catch (x) {
      loading.replaceChildren(h("p", { class: "a-err", role: "alert" }, x.message), h("a", { class: "a-btn", href: "#/list" }, "Back to the mailing list"));
    }
  })();

  return root;
}
