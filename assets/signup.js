// Mailing list sign-up, shared by the homepage and /join. Each [data-signup-box] holds a form
// (name, email, a hidden bot trap), a .form-note for problems and typo suggestions, and a .success panel.
// The checks and the confirmation email happen in functions/api/subscribe.ts.
(() => {
  const OK_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  document.querySelectorAll('[data-signup-box]').forEach(box => {
    const form = box.querySelector('form');
    const note = box.querySelector('.form-note');
    const success = box.querySelector('.success');
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    let confirmed = false;   // the fan said "no, my address is right" to a typo suggestion

    const hideNote = () => { note.hidden = true; note.replaceChildren(); };
    function showNote(message, suggest, isQuestion){
      note.className = 'form-note' + (suggest ? '' : ' err');
      const p = document.createElement('p'); p.style.margin = '0';
      if (suggest && isQuestion) { p.append('Did you mean '); const b = document.createElement('b'); b.textContent = suggest; p.append(b, '?'); }
      else p.textContent = message;
      note.replaceChildren(p);
      if (suggest) {
        const row = document.createElement('div'); row.className = 'note-btns';
        const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn'; yes.textContent = 'Yes, use ' + suggest;
        yes.addEventListener('click', () => { form.email.value = suggest; confirmed = false; hideNote(); form.requestSubmit(); });
        row.appendChild(yes);
        if (isQuestion) {
          const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.textContent = 'No, mine is right';
          no.addEventListener('click', () => { confirmed = true; hideNote(); form.requestSubmit(); });
          row.appendChild(no);
        }
        note.appendChild(row);
      }
      note.hidden = false;
    }
    function done(message, state){
      success.replaceChildren();
      const p = document.createElement('p'); p.style.margin = '0'; p.textContent = message; success.appendChild(p);
      if (state === 'pending') {
        const tip = document.createElement('p'); tip.className = 'tip';
        tip.textContent = "Can't see it in a minute or two? Check your spam or promotions folder.";
        success.appendChild(tip);
      }
      box.classList.add('sent');
      success.setAttribute('tabindex', '-1'); success.focus({ preventScroll: true });
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = form.first_name.value.trim(), email = form.email.value.trim();
      if (!name) { showNote('Add your first name so we can say hi properly.'); form.first_name.focus(); return; }
      if (!OK_SHAPE.test(email)) { showNote("That doesn't look like an email address. Check for typos."); form.email.focus(); return; }
      hideNote();
      btn.disabled = true; btn.textContent = 'Checking...';
      const fd = new FormData(form); if (confirmed) fd.set('confirmed', '1');
      let r = null, j = {};
      try { r = await fetch('/api/subscribe', { method: 'POST', body: fd }); j = await r.json().catch(() => ({})); } catch (_) {}
      btn.disabled = false; btn.textContent = label;
      if (r && r.ok) done(j.message || "You're on the list. See you down the front.", j.state);
      else if (r && (r.status === 400 || r.status === 429)) {
        showNote(j.message || "That doesn't look like an email address. Check for typos.", j.suggest, /^Did you mean/.test(j.message || ''));
        if (!j.suggest) (j.field === "name" ? form.first_name : form.email).focus();
      } else {
        // the database isn't reachable (or this is a local preview): fall back to an email to the band
        const to = box.dataset.email || 'luke@sleepover.club';
        location.href = 'mailto:' + to + '?subject=' + encodeURIComponent('Add me to the mailing list') + '&body=' + encodeURIComponent('Please add ' + name + ' (' + email + ') to the Fizzy Orange mailing list.');
        done("Your email app should open now. Hit send and you're on the list.");
      }
    });
    form.addEventListener('input', e => { if (e.target === form.email) confirmed = false; hideNote(); });
  });
})();
