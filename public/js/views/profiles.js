// "Who's watching?" picker, profile management and the edit sheet.

import { html, raw, el, icons, $, fadeOut } from "../lib/dom.js";
import * as store from "../lib/store.js";
import { go } from "../lib/router.js";
import { avatar } from "../ui/avatar.js";
import { toast } from "../ui/toast.js";
import { setAmbient } from "../ui/ambient.js";

export function profilesView(view, { query }) {
  const manage = query.manage === "1";
  const list = store.profiles();
  setAmbient("");

  view.innerHTML = html`<div class="profiles">
    <div class="profiles-inner">
      <h1>${manage ? "Manage Profiles" : list.length ? "Who’s watching?" : "Create your profile"}</h1>
      <div class="profile-list">
        ${list.map((p) => html`<button class="profile" data-id="${p.id}">
          <span class="avatar-wrap">${raw(avatar(p))}${manage ? html`<span class="edit-ov">${raw(icons.edit)}</span>` : ""}${p.kids ? html`<span class="chip kids-tag">KIDS</span>` : ""}</span>
          <span>${p.name}</span>
        </button>`)}
        ${store.canAddProfile() ? html`<button class="profile" data-add>
          <span class="avatar-wrap glass"><span class="add">${raw(icons.plus)}</span></span><span>Add Profile</span>
        </button>` : ""}
      </div>
      ${list.length ? html`<button class="btn-outline" data-manage>${manage ? "Done" : "Manage Profiles"}</button>` : ""}
    </div>
  </div>`.s;

  view.querySelector(".profile-list").addEventListener("click", (e) => {
    const b = e.target.closest(".profile");
    if (!b) return;
    if (b.hasAttribute("data-add")) return editSheet(null, () => profilesView(view, { query }));
    const p = store.getProfile(b.dataset.id);
    if (manage) return editSheet(p, () => profilesView(view, { query }));
    store.setActive(p.id);
    const next = query.next && query.next.startsWith("/") && !query.next.startsWith("/profiles") ? query.next : "/browse";
    go(next);
  });
  $("[data-manage]", view)?.addEventListener("click", () => go("/profiles", manage ? {} : { manage: "1" }));
  $(".profile", view)?.focus({ preventScroll: true });
}

/** Create (profile = null) or edit a profile in a glass sheet. */
export function editSheet(profile, done) {
  const draft = profile
    ? { name: profile.name, color: profile.color, face: profile.face, kids: profile.kids }
    : { name: "", color: store.profiles().length % store.COLORS.length, face: store.FACES[store.profiles().length % store.FACES.length], kids: false };

  const wrap = el(`<div class="modal-backdrop" role="dialog" aria-modal="true"></div>`);
  const render = () => {
    wrap.innerHTML = html`<form class="sheet glass" novalidate>
      <h2>${profile ? "Edit Profile" : "Add Profile"}</h2>
      <div class="sheet-row">
        ${raw(avatar(draft))}
        <div class="field">
          <label for="pf-name">Name</label>
          <input class="input" id="pf-name" name="name" maxlength="24" placeholder="Name" value="${draft.name}" required autocomplete="off" />
        </div>
      </div>
      <div class="field" style="margin-bottom:18px"><span class="label">Colour</span>
        <div class="swatches">${store.COLORS.map(([a, b], i) => html`<button type="button" data-color="${i}" aria-label="Colour ${i + 1}" aria-pressed="${draft.color === i}" style="background:linear-gradient(135deg,${a},${b})"></button>`)}</div>
      </div>
      <div class="field" style="margin-bottom:18px"><span class="label">Face</span>
        <div class="swatches faces">${store.FACES.map((f) => html`<button type="button" data-face="${f}" aria-label="${f}" aria-pressed="${draft.face === f}">${raw(avatar({ ...draft, face: f }))}</button>`)}</div>
      </div>
      <label class="toggle"><span>Kids profile<small>Only shows family-friendly titles</small></span><input type="checkbox" name="kids" ${draft.kids ? "checked" : ""} /><span class="switch"></span></label>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
        <button class="btn btn-glass glass btn-sm" type="button" data-cancel>Cancel</button>
        ${profile ? html`<button class="btn btn-sm danger" type="button" data-delete>${raw(icons.trash)} Delete</button>` : ""}
      </div>
    </form>`.s;
  };
  render();

  const close = () => { fadeOut(wrap); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  const keepName = () => { const i = $("#pf-name", wrap); if (i) draft.name = i.value; };
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest("[data-cancel]")) return close();
    const c = e.target.closest("[data-color]");
    const f = e.target.closest("[data-face]");
    if (c || f) {
      keepName();
      draft.kids = $('input[name="kids"]', wrap).checked;
      if (c) draft.color = Number(c.dataset.color);
      if (f) draft.face = f.dataset.face;
      render();
      return;
    }
    if (e.target.closest("[data-delete]")) {
      if (!confirm(`Delete “${profile.name}”? Their My List and history will be lost.`)) return;
      store.deleteProfile(profile.id);
      close();
      toast("Profile deleted");
      done?.();
    }
  });
  wrap.addEventListener("submit", (e) => {
    e.preventDefault();
    keepName();
    draft.kids = $('input[name="kids"]', wrap).checked;
    if (!draft.name.trim()) { $("#pf-name", wrap).focus(); return toast("Give the profile a name"); }
    try {
      if (profile) store.updateProfile(profile.id, draft);
      else store.createProfile(draft);
    } catch (err) { return toast(err.message); }
    close();
    done?.();
  });

  document.getElementById("modal-root").append(wrap);
  $("#pf-name", wrap).focus();
}
