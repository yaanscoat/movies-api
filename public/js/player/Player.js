// Custom video player: HLS/MP4 engine with automatic source fallback, glass
// controls, quality/speed/source/subtitle menus, keyboard + touch gestures.

import { html, raw, el, icons, $, $$, fmtTime, throttle } from "../lib/dom.js";
import { proxied } from "../lib/api.js";
import { parseSubtitles, activeCues, cueHTML, languageName } from "./subtitles.js";

const IDLE_MS = 3000;
const LOAD_TIMEOUT_MS = 25000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const UP_NEXT_AT = 25; // seconds before the end

export class Player {
  /**
   * opts: {
   *   title, subtitle, backdrop, logo,
   *   settings: { volume, muted, subtitleSize, subtitleLang, speed, autoplayNext },
   *   onBack(), onProgress({ position, duration }), onEnded(), onSettings(patch),
   *   episodes?: (container, close) => void   // renders the episode picker
   * }
   */
  constructor(mount, opts) {
    this.opts = opts;
    this.settings = { ...opts.settings };
    this.sources = [];
    this.failed = new Set();
    this.index = -1;
    this.hls = null;
    this.ext = [];          // external subtitle tracks [{ label, lang, url?, cues? }]
    this.sub = null;        // { kind: "hls", index } | { kind: "ext", i } | null
    this.subOffset = 0;
    this.next = null;
    this.upNextDismissed = false;
    this.showRemaining = false;
    this.disposers = [];

    this.root = el(this.template());
    mount.append(this.root);
    this.v = $("video", this.root);
    this.v.volume = this.settings.volume ?? 1;
    this.v.muted = !!this.settings.muted;
    this.bind();
    this.updateVolumeUI();
    this.setHeading(opts.title, opts.subtitle);
    this.loader("loading", { title: opts.title, text: "Finding the best stream…" });
    this.root.focus({ preventScroll: true });
    this.wake();
  }

  template() {
    const o = this.opts;
    return html`<div class="player" tabindex="-1" aria-label="Video player">
      <video playsinline preload="auto"></video>
      <div class="p-subs ${this.settings.subtitleSize || "m"}" aria-live="off"></div>
      <div class="p-shade p-fade"></div>
      <div class="p-spinner"></div>
      <div class="p-flash glass"></div>
      <div class="p-seek-hint left"></div><div class="p-seek-hint right"></div>
      <div class="p-bubble glass"></div>

      <div class="p-top p-fade">
        <button class="icon-btn glass p-back" data-p="back" aria-label="Back">${raw(icons.chevLeft)}</button>
        <div class="p-heading"><b></b><span></span></div>
      </div>

      <div class="p-bottom p-fade">
        <div class="p-timeline" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0">
          <div class="p-track"><div class="p-buffered"></div><div class="p-hoverfill"></div><div class="p-played"></div><div class="p-knob"></div></div>
          <div class="p-tip glass">0:00</div>
        </div>
        <div class="p-bar glass">
          <button class="icon-btn" data-p="play" aria-label="Play">${raw(icons.play)}</button>
          <button class="icon-btn" data-p="back10" aria-label="Back 10 seconds">${raw(icons.back10)}</button>
          <button class="icon-btn" data-p="fwd10" aria-label="Forward 10 seconds">${raw(icons.fwd10)}</button>
          <div class="p-volume">
            <button class="icon-btn" data-p="mute" aria-label="Mute">${raw(icons.volume)}</button>
            <div class="slider"><input class="range" type="range" min="0" max="1" step="0.01" aria-label="Volume" /></div>
          </div>
          <button class="p-time" data-p="time" title="Toggle remaining time">0:00 / 0:00</button>
          <div class="p-title-mid"></div>
          <button class="icon-btn" data-p="next" aria-label="Next episode" title="Next episode (N)" hidden>${raw(icons.next)}</button>
          ${o.episodes ? html`<button class="icon-btn" data-p="episodes" aria-label="Episodes" title="Episodes">${raw(icons.episodes)}</button>` : ""}
          <button class="icon-btn" data-p="subs" aria-label="Subtitles" title="Subtitles (C)">${raw(icons.subs)}</button>
          <button class="icon-btn" data-p="settings" aria-label="Settings" title="Quality, speed & source">${raw(icons.gear)}</button>
          <button class="icon-btn" data-p="pip" aria-label="Picture in picture" title="Picture in picture (P)">${raw(icons.pip)}</button>
          <button class="icon-btn" data-p="fs" aria-label="Fullscreen" title="Fullscreen (F)">${raw(icons.fullscreen)}</button>
        </div>
      </div>

      <div class="p-loader">
        <div class="p-loader-bg"${o.backdrop ? raw(` style="background-image:url('${o.backdrop}')"`) : ""}></div>
        <div class="p-loader-card glass"></div>
      </div>
    </div>`;
  }

  /* ================================================================
     Sources / engine
     ================================================================ */

  setSources(list, startAt = 0) {
    this.sources = list;
    this.failed.clear();
    if (!list.length) return this.loader("error", { title: "No streams found", text: "None of the providers had this title right now. Try again in a bit." });
    this.load(0, startAt);
  }

  load(i, startAt = 0) {
    this.teardownEngine();
    this.index = i;
    const s = this.sources[i];
    const url = proxied(s.url, s.referer);
    this.started = false;
    this.recovered = false;
    this.startAt = startAt > 0 ? startAt : 0;
    this.pendingSeek = this.startAt;
    this.setBuffering(true);
    this.watchdog = setTimeout(() => this.fail("timed out"), LOAD_TIMEOUT_MS);
    this.ext = (s.captions || []).map((c) => ({ label: c.label || languageName(c.lang) || "Subtitles", lang: c.lang, url: c.url }));

    const Hls = window.Hls;
    if (s.type === "hls" && Hls?.isSupported()) {
      const hls = new Hls({
        startPosition: this.pendingSeek || -1,
        maxBufferLength: 40,
        maxMaxBufferLength: 180,
        backBufferLength: 60,
        enableWorker: true,
        fragLoadingMaxRetry: 4,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
      });
      this.pendingSeek = 0;
      this.hls = hls;
      hls.subtitleDisplay = false; // we draw cues ourselves
      hls.on(Hls.Events.MANIFEST_PARSED, () => { this.play(); this.renderPop(); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => this.renderPop());
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => { this.autoSelectSub(); this.renderPop(); });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !this.recovered) { this.recovered = true; hls.recoverMediaError(); return; }
        this.fail(d.details || d.type);
      });
      hls.loadSource(url);
      hls.attachMedia(this.v);
    } else {
      this.v.src = url;
      this.v.load();
      this.play();
    }
    this.autoSelectSub();
    this.renderPop();
  }

  teardownEngine() {
    clearTimeout(this.watchdog);
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    this.v.removeAttribute("src");
    try { this.v.load(); } catch {}
    this.setSubtitle(null, { silent: true });
  }

  fail(reason) {
    clearTimeout(this.watchdog);
    const s = this.sources[this.index];
    if (!s) return;
    console.warn(`[player] source ${this.index} (${s.providerName}) failed:`, reason);
    this.failed.add(this.index);
    const resumeAt = this.started ? this.v.currentTime : this.startAt;
    const nextIdx = this.sources.findIndex((_, j) => !this.failed.has(j));
    if (nextIdx >= 0) {
      this.bubble(`${s.providerName || "Source"} failed — trying ${this.sources[nextIdx].providerName || "next source"}`);
      this.load(nextIdx, Math.max(0, resumeAt));
    } else {
      this.teardownEngine();
      this.loader("error", { title: "Playback failed", text: "Every source we found failed to play. They may be blocked or offline." });
    }
  }

  play() {
    const p = this.v.play();
    p?.catch?.((e) => {
      if (e.name === "NotAllowedError") { this.setBuffering(false); this.loader(null); this.wake(); }
    });
  }

  toggle() { this.v.paused || this.v.ended ? this.play() : this.v.pause(); }

  seek(t, { relative = false } = {}) {
    const d = this.v.duration;
    if (!Number.isFinite(d)) return;
    const to = Math.min(Math.max(0, relative ? this.v.currentTime + t : t), d - 0.5);
    this.v.currentTime = to;
    this.updateTime();
  }

  /* ================================================================
     Wiring
     ================================================================ */

  bind() {
    const v = this.v, root = this.root;
    const on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); this.disposers.push(() => target.removeEventListener(ev, fn, opt)); };

    on(v, "playing", () => {
      clearTimeout(this.watchdog);
      if (!this.started) {
        this.started = true;
        this.loader(null);
        this.opts.onStart?.(this.sources[this.index]);
      }
      this.setBuffering(false);
    });
    on(v, "loadedmetadata", () => {
      if (this.pendingSeek) { v.currentTime = this.pendingSeek; this.pendingSeek = 0; }
      v.playbackRate = this.settings.speed || 1;
      this.timeline.setAttribute("aria-valuemax", String(Math.floor(v.duration || 0)));
    });
    on(v, "waiting", () => this.setBuffering(true));
    on(v, "canplay", () => this.setBuffering(false));
    on(v, "play", () => { this.updatePlayBtn(); this.wake(); });
    on(v, "pause", () => { this.updatePlayBtn(); this.wake(); this.reportProgress(); });
    on(v, "timeupdate", () => { this.updateTime(); this.progressTick(); this.checkUpNext(); });
    on(v, "progress", () => this.updateBuffered());
    on(v, "durationchange", () => this.updateTime());
    on(v, "volumechange", () => this.updateVolumeUI());
    on(v, "ratechange", () => this.renderPop());
    on(v, "seeked", () => this.reportProgress());
    on(v, "ended", () => { this.reportProgress(); this.opts.onEnded?.(); });
    on(v, "error", () => { if (!this.hls && v.error) this.fail(v.error.message || `media error ${v.error.code}`); });
    on(v, "enterpictureinpicture", () => this.btn("pip").classList.add("on"));
    on(v, "leavepictureinpicture", () => this.btn("pip").classList.remove("on"));

    // buttons
    on(root, "click", (e) => {
      const b = e.target.closest("[data-p]");
      if (b) { e.stopPropagation(); return this.action(b.dataset.p, b); }
      if (e.target.closest(".p-pop, .p-bar, .p-timeline, .p-top, .p-next, .p-loader-card, .p-help")) return;
      if (this.pop) return this.closePop();
      if (this.lastPointer === "touch") return; // taps are handled in pointerup
      clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => { this.toggle(); this.flash(this.v.paused ? icons.pause : icons.play); }, 200);
    });
    on(root, "dblclick", (e) => {
      if (e.target.closest(".p-bottom, .p-top, .p-pop")) return;
      clearTimeout(this.clickTimer);
      this.toggleFullscreen();
    });

    // touch: tap shows/hides controls, double-tap on the sides seeks
    let lastTap = 0;
    on(root, "pointerdown", (e) => { this.lastPointer = e.pointerType; });
    on(root, "pointerup", (e) => {
      if (e.pointerType !== "touch" || e.target.closest(".p-bottom, .p-top, .p-pop, .p-next, .p-loader-card")) return;
      const now = Date.now();
      const x = e.clientX / root.clientWidth;
      if (now - lastTap < 300 && (x < 0.35 || x > 0.65)) {
        const dir = x < 0.35 ? -1 : 1;
        this.seek(10 * dir, { relative: true });
        this.seekHint(dir);
        lastTap = 0;
        return;
      }
      lastTap = now;
      if (this.root.classList.contains("idle")) this.wake(); else if (!this.v.paused) this.sleep();
    });

    on(root, "pointermove", (e) => { if (e.pointerType !== "touch") this.wake(); });
    on(root, "mouseleave", () => { if (!this.v.paused) this.sleep(); });

    // volume slider
    const range = $(".range", root);
    on(range, "input", () => {
      v.volume = Number(range.value);
      v.muted = v.volume === 0;
      this.saveVolume();
    });

    // timeline scrubbing
    this.timeline = $(".p-timeline", root);
    const tip = $(".p-tip", root), hover = $(".p-hoverfill", root);
    const frac = (e) => {
      const r = this.timeline.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    const showTip = (f) => {
      const d = v.duration || 0;
      tip.textContent = fmtTime(f * d);
      const w = this.timeline.clientWidth;
      tip.style.left = `${Math.min(Math.max(f * w, 34), w - 34)}px`;
      hover.style.width = `${f * 100}%`;
    };
    on(this.timeline, "pointermove", (e) => { showTip(frac(e)); if (this.dragging) this.paintPlayed(frac(e)); });
    on(this.timeline, "pointerdown", (e) => {
      if (!Number.isFinite(v.duration)) return;
      this.dragging = true;
      this.timeline.classList.add("drag");
      this.timeline.setPointerCapture(e.pointerId);
      this.paintPlayed(frac(e));
      showTip(frac(e));
    });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.timeline.classList.remove("drag");
      this.seek(frac(e) * v.duration);
    };
    on(this.timeline, "pointerup", end);
    on(this.timeline, "pointercancel", () => { this.dragging = false; this.timeline.classList.remove("drag"); });
    on(this.timeline, "keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); this.seek(e.key === "ArrowLeft" ? -5 : 5, { relative: true }); }
    });

    on(document, "keydown", (e) => this.onKey(e));
    on(document, "fullscreenchange", () => {
      this.btn("fs").innerHTML = document.fullscreenElement ? icons.exitFullscreen : icons.fullscreen;
    });
    on(window, "beforeunload", () => this.reportProgress());
    on(document, "visibilitychange", () => { if (document.hidden) this.reportProgress(); });

    // subtitle render loop
    const loop = () => { this.renderCues(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);

    this.progressTick = throttle(() => this.reportProgress(), 5000);
    this.setupMediaSession();
  }

  action(name, btn) {
    switch (name) {
      case "back": return this.opts.onBack?.();
      case "play": this.toggle(); break;
      case "back10": this.seek(-10, { relative: true }); this.seekHint(-1); break;
      case "fwd10": this.seek(10, { relative: true }); this.seekHint(1); break;
      case "mute": this.v.muted = !this.v.muted; if (!this.v.muted && this.v.volume === 0) this.v.volume = 0.5; this.saveVolume(); break;
      case "time": this.showRemaining = !this.showRemaining; this.updateTime(); break;
      case "next": this.next?.go(); break;
      case "fs": this.toggleFullscreen(); break;
      case "pip": this.togglePip(); break;
      case "episodes": case "subs": case "settings": this.togglePop(name); break;
      case "retry": this.loader("loading", { title: this.opts.title, text: "Trying again…" }); this.opts.onRetry?.(); break;
      case "sel-quality": if (this.hls) this.hls.currentLevel = Number(btn.dataset.v); this.renderPop(); break;
      case "sel-speed": this.v.playbackRate = Number(btn.dataset.v); this.settings.speed = this.v.playbackRate; this.opts.onSettings?.({ speed: this.v.playbackRate }); break;
      case "sel-source": {
        const i = Number(btn.dataset.v);
        if (i === this.index) break;
        this.failed.delete(i);
        this.bubble(`Switching to ${this.sources[i].providerName || "source " + (i + 1)}`);
        this.load(i, this.v.currentTime || 0);
        break;
      }
      case "sel-sub": this.chooseSubtitle(btn.dataset.v); break;
      case "sub-size": this.settings.subtitleSize = btn.dataset.v; $(".p-subs", this.root).className = `p-subs ${btn.dataset.v}`; this.opts.onSettings?.({ subtitleSize: btn.dataset.v }); this.renderPop(); break;
      case "sub-offset": this.subOffset = btn.dataset.v === "0" ? 0 : Math.round((this.subOffset + Number(btn.dataset.v)) * 10) / 10; this.renderPop(); break;
      case "sub-file": this.pickSubtitleFile(); break;
      case "upnext-play": this.next?.go(); break;
      case "upnext-cancel": this.upNextDismissed = true; this.hideUpNext(); break;
      case "help": this.toggleHelp(); break;
    }
  }

  onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== "range") return;
    const k = e.key;
    const handled = () => { e.preventDefault(); this.wake(); };
    if (k === " " || k === "k" || k === "K") { handled(); this.toggle(); this.flash(this.v.paused ? icons.pause : icons.play); }
    else if (k === "ArrowLeft" || k === "j" || k === "J") { handled(); this.seek(-10, { relative: true }); this.seekHint(-1); }
    else if (k === "ArrowRight" || k === "l" || k === "L") { handled(); this.seek(10, { relative: true }); this.seekHint(1); }
    else if (k === "ArrowUp") { handled(); this.nudgeVolume(0.05); }
    else if (k === "ArrowDown") { handled(); this.nudgeVolume(-0.05); }
    else if (k === "m" || k === "M") { handled(); this.action("mute"); this.bubble(this.v.muted ? "Muted" : `Volume ${Math.round(this.v.volume * 100)}%`); }
    else if (k === "f" || k === "F") { handled(); this.toggleFullscreen(); }
    else if (k === "p" || k === "P") { handled(); this.togglePip(); }
    else if (k === "c" || k === "C") { handled(); this.cycleSubtitle(); }
    else if (k === "n" || k === "N") { if (this.next) { handled(); this.next.go(); } }
    else if (k === ">" || k === "<") {
      handled();
      const i = SPEEDS.indexOf(this.v.playbackRate);
      const ni = Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 2 : i) + (k === ">" ? 1 : -1)));
      this.action("sel-speed", { dataset: { v: SPEEDS[ni] } });
      this.bubble(`Speed ${SPEEDS[ni]}×`);
    }
    else if (/^[0-9]$/.test(k)) { handled(); this.seek((Number(k) / 10) * (this.v.duration || 0)); }
    else if (k === "?") { handled(); this.toggleHelp(); }
    else if (k === "Escape") {
      if (this.helpEl) { handled(); this.toggleHelp(false); }
      else if (this.pop) { handled(); this.closePop(); }
      else if (!document.fullscreenElement) { handled(); this.opts.onBack?.(); }
    }
  }

  /* ================================================================
     UI state
     ================================================================ */

  btn(name) { return $(`[data-p="${name}"]`, this.root) || document.createElement("button"); }

  setHeading(title, subtitle) {
    $(".p-heading b", this.root).textContent = title || "";
    $(".p-heading span", this.root).textContent = subtitle || "";
    $(".p-title-mid", this.root).innerHTML = html`${title || ""}${subtitle ? html` <span>${subtitle}</span>` : ""}`.s;
    if ("mediaSession" in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: subtitle ? `${title} — ${subtitle}` : title, artwork: this.opts.backdrop ? [{ src: this.opts.backdrop, sizes: "780x439", type: "image/jpeg" }] : [] });
    }
  }

  /** Fill in title/artwork once metadata arrives (streams are fetched in parallel). */
  setMeta({ title, subtitle, backdrop, logo }) {
    Object.assign(this.opts, { title, subtitle, backdrop, logo });
    this.setHeading(title, subtitle);
    if (backdrop) $(".p-loader-bg", this.root).style.backgroundImage = `url("${backdrop}")`;
    if (this.loaderState === "loading") this.loader("loading", { title, text: this.loaderMsg });
  }

  /** state: "loading" | "error" | null (hide) */
  loader(state, { title, text } = {}) {
    this.loaderState = state;
    this.loaderMsg = text;
    const wrap = $(".p-loader", this.root);
    if (!state) { wrap.classList.add("done"); return; }
    wrap.classList.remove("done");
    const card = $(".p-loader-card", wrap);
    const logo = this.opts.logo ? html`<img class="p-logo" src="${this.opts.logo}" alt="" />` : html`<h2>${title || ""}</h2>`;
    card.innerHTML = state === "loading"
      ? html`${logo}<div class="bar"><i></i></div><p>${text || ""}</p><div class="actions"><button class="btn btn-glass glass btn-sm" data-p="back">Cancel</button></div>`.s
      : html`<span class="err-icon">${raw(icons.alert)}</span><h2>${title}</h2><p>${text || ""}</p>
          <div class="actions"><button class="btn btn-primary btn-sm" data-p="retry">Try again</button><button class="btn btn-glass glass btn-sm" data-p="back">Go back</button></div>`.s;
  }

  loaderText(text) {
    this.loaderMsg = text;
    const p = $(".p-loader:not(.done) .p-loader-card p", this.root);
    if (p) p.textContent = text;
  }

  setBuffering(on) { this.root.classList.toggle("buffering", on); }

  wake() {
    this.root.classList.remove("idle");
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.sleep(), IDLE_MS);
  }

  sleep() {
    if (this.v.paused || this.pop || this.dragging || this.helpEl || this.root.contains(document.activeElement) && document.activeElement.matches(".range")) return;
    this.root.classList.add("idle");
  }

  updatePlayBtn() {
    const b = this.btn("play");
    const paused = this.v.paused;
    b.innerHTML = paused ? icons.play : icons.pause;
    b.setAttribute("aria-label", paused ? "Play" : "Pause");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = paused ? "paused" : "playing";
  }

  paintPlayed(f) {
    $(".p-played", this.root).style.width = `${f * 100}%`;
    $(".p-knob", this.root).style.left = `${f * 100}%`;
  }

  updateTime() {
    const { currentTime: t, duration: d } = this.v;
    if (!this.dragging) this.paintPlayed(d ? t / d : 0);
    const timeBtn = this.btn("time");
    timeBtn.textContent = this.showRemaining && d ? `-${fmtTime(d - t)}` : `${fmtTime(t)} / ${fmtTime(d)}`;
    this.timeline.setAttribute("aria-valuenow", String(Math.floor(t)));
    this.timeline.setAttribute("aria-valuetext", `${fmtTime(t)} of ${fmtTime(d)}`);
  }

  updateBuffered() {
    const { buffered: b, currentTime: t, duration: d } = this.v;
    if (!d) return;
    let end = 0;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5) end = Math.max(end, b.end(i));
    $(".p-buffered", this.root).style.width = `${(end / d) * 100}%`;
  }

  updateVolumeUI() {
    const { volume, muted } = this.v;
    const lvl = muted ? 0 : volume;
    const range = $(".range", this.root);
    range.value = String(lvl);
    range.style.setProperty("--v", `${lvl * 100}%`);
    this.btn("mute").innerHTML = lvl === 0 ? icons.mute : lvl < 0.5 ? icons.volumeLow : icons.volume;
  }

  nudgeVolume(d) {
    this.v.muted = false;
    this.v.volume = Math.min(1, Math.max(0, Math.round((this.v.volume + d) * 100) / 100));
    this.bubble(`Volume ${Math.round(this.v.volume * 100)}%`);
    this.saveVolume();
  }

  saveVolume() { this.opts.onSettings?.({ volume: this.v.volume, muted: this.v.muted }); }

  flash(svg) {
    const f = $(".p-flash", this.root);
    f.innerHTML = svg;
    f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
  }

  seekHint(dir) {
    const h = $(`.p-seek-hint.${dir < 0 ? "left" : "right"}`, this.root);
    h.textContent = dir < 0 ? "« 10s" : "10s »";
    h.classList.remove("go"); void h.offsetWidth; h.classList.add("go");
  }

  bubble(text) {
    const b = $(".p-bubble", this.root);
    b.textContent = text;
    b.classList.add("show");
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => b.classList.remove("show"), 1400);
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (this.root.requestFullscreen) await this.root.requestFullscreen({ navigationUI: "hide" });
      else this.v.webkitEnterFullscreen?.();
    } catch (e) { console.warn(e); }
  }

  async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await this.v.requestPictureInPicture();
      else this.bubble("Picture-in-picture isn’t supported here");
    } catch (e) { this.bubble("Picture-in-picture unavailable"); }
  }

  toggleHelp(force) {
    const open = force ?? !this.helpEl;
    if (!open) { this.helpEl?.remove(); this.helpEl = null; return this.wake(); }
    this.closePop();
    const rows = [["Space / K", "Play / pause"], ["← / J", "Back 10 seconds"], ["→ / L", "Forward 10 seconds"], ["↑ ↓", "Volume"], ["M", "Mute"], ["F", "Fullscreen"], ["P", "Picture in picture"], ["C", "Cycle subtitles"], ["N", "Next episode"], ["< / >", "Playback speed"], ["0–9", "Jump to 0–90%"], ["Esc", "Close menu / exit player"]];
    this.helpEl = el(html`<div class="p-help glass"><h3>Keyboard shortcuts</h3><dl>${rows.map(([k, d]) => html`<dt>${k.split(" / ").map((x, i) => html`${i ? " / " : ""}<kbd>${x}</kbd>`)}</dt><dd>${d}</dd>`)}</dl></div>`);
    this.helpEl.onclick = () => this.toggleHelp(false);
    this.root.append(this.helpEl);
  }

  /* ================================================================
     Popovers: settings (quality/speed/source), subtitles, episodes
     ================================================================ */

  togglePop(kind) {
    if (this.pop?.kind === kind) return this.closePop();
    this.closePop();
    const node = el(`<div class="p-pop glass${kind === "episodes" ? " wide" : ""}" role="dialog"></div>`);
    this.pop = { kind, node };
    $(".p-bottom", this.root).append(node);
    this.btn(kind).classList.add("on");
    if (kind === "episodes") this.opts.episodes(node, () => this.closePop());
    else this.renderPop();
    this.wake();
  }

  closePop() {
    if (!this.pop) return;
    this.btn(this.pop.kind).classList.toggle("on", this.pop.kind === "subs" && !!this.sub);
    this.pop.node.remove();
    this.pop = null;
    this.wake();
  }

  renderPop() {
    if (!this.pop || this.pop.kind === "episodes") return;
    const n = this.pop.node;
    const opt = (action, value, label, sel, extra = "", cls = "") =>
      html`<button class="opt${sel ? " sel" : ""}${cls ? " " + cls : ""}" data-p="${action}" data-v="${value}"><span class="tick">${raw(icons.check)}</span>${label}${extra ? html`<small>${extra}</small>` : ""}</button>`;

    if (this.pop.kind === "settings") {
      const levels = this.hls?.levels || [];
      const auto = this.hls?.autoLevelEnabled ?? true;
      const cur = this.hls?.currentLevel ?? -1;
      const curH = levels[this.hls?.loadLevel ?? -1]?.height;
      const sortedLevels = levels.map((l, i) => ({ ...l, i })).sort((a, b) => (b.height || 0) - (a.height || 0) || b.bitrate - a.bitrate);
      n.innerHTML = html`
        ${levels.length > 1 ? html`<h4>Quality</h4>
          ${opt("sel-quality", -1, "Auto", auto, curH ? `${curH}p` : "")}
          ${sortedLevels.map((l) => opt("sel-quality", l.i, l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`, !auto && cur === l.i, l.height >= 2160 ? "4K" : l.height >= 720 ? "HD" : ""))}
          <hr />` : ""}
        <h4>Playback speed</h4>
        <div class="seg">${SPEEDS.map((s) => html`<button class="${this.v.playbackRate === s ? "sel" : ""}" data-p="sel-speed" data-v="${s}">${s === 1 ? "1×" : s + "×"}</button>`)}</div>
        <hr />
        <h4>Source</h4>
        ${this.sources.map((s, i) => opt("sel-source", i, `${s.providerName || "Source " + (i + 1)}${s.quality ? " · " + s.quality : ""}`, i === this.index, this.failed.has(i) ? "failed" : s.type === "hls" ? "HLS" : "MP4", this.failed.has(i) ? "bad" : ""))}
        <div class="note">Press <b>?</b> for keyboard shortcuts.</div>`.s;
    } else if (this.pop.kind === "subs") {
      const tracks = this.subOptions();
      const selKey = this.subKey();
      n.innerHTML = html`<h4>Subtitles</h4>
        ${opt("sel-sub", "off", "Off", !selKey)}
        ${tracks.map((t) => opt("sel-sub", t.key, t.label, t.key === selKey, t.lang && t.label !== languageName(t.lang) ? languageName(t.lang) : ""))}
        ${!tracks.length ? html`<div class="note">This stream has no subtitles.</div>` : ""}
        <button class="opt" data-p="sub-file"><span class="tick"></span>Load from file… <small>.srt / .vtt</small></button>
        <hr />
        <h4>Size</h4>
        <div class="seg">${[["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([v, l]) => html`<button class="${(this.settings.subtitleSize || "m") === v ? "sel" : ""}" data-p="sub-size" data-v="${v}">${l}</button>`)}</div>
        ${selKey ? html`<h4>Timing</h4>
          <div class="seg"><button data-p="sub-offset" data-v="-0.5">−0.5s</button><button data-p="sub-offset" data-v="0" class="${this.subOffset === 0 ? "sel" : ""}">${this.subOffset > 0 ? "+" : ""}${this.subOffset.toFixed(1)}s</button><button data-p="sub-offset" data-v="0.5">+0.5s</button></div>` : ""}`.s;
    }
  }

  /* ================================================================
     Subtitles
     ================================================================ */

  subOptions() {
    const out = [];
    (this.hls?.subtitleTracks || []).forEach((t, i) => out.push({ key: `hls:${i}`, label: t.name || languageName(t.lang) || `Track ${i + 1}`, lang: t.lang }));
    this.ext.forEach((t, i) => out.push({ key: `ext:${i}`, label: t.label, lang: t.lang }));
    return out;
  }

  subKey() { return this.sub ? `${this.sub.kind}:${this.sub.i}` : null; }

  async chooseSubtitle(key, { silent = false } = {}) {
    if (key === "off" || !key) {
      this.setSubtitle(null);
      if (!silent) this.opts.onSettings?.({ subtitleLang: null });
      return;
    }
    const [kind, iStr] = key.split(":");
    const i = Number(iStr);
    if (kind === "ext" && !this.ext[i].cues) {
      try {
        const res = await fetch(proxied(this.ext[i].url));
        if (!res.ok) throw new Error(res.status);
        this.ext[i].cues = parseSubtitles(await res.text());
      } catch (e) { this.bubble("Couldn’t load those subtitles"); return; }
    }
    this.setSubtitle({ kind, i });
    const lang = kind === "hls" ? this.hls?.subtitleTracks[i]?.lang : this.ext[i]?.lang;
    if (!silent) this.opts.onSettings?.({ subtitleLang: lang || "und" });
  }

  setSubtitle(sel, { silent } = {}) {
    this.sub = sel;
    if (this.hls) this.hls.subtitleTrack = sel?.kind === "hls" ? sel.i : -1;
    for (const tt of this.v.textTracks) if (tt.mode === "showing") tt.mode = "hidden";
    this.lastCueKey = null;
    $(".p-subs", this.root).innerHTML = "";
    this.btn("subs").classList.toggle("on", !!sel || this.pop?.kind === "subs");
    if (!silent) this.renderPop();
  }

  cycleSubtitle() {
    const opts = ["off", ...this.subOptions().map((o) => o.key)];
    const cur = opts.indexOf(this.subKey() || "off");
    const next = opts[(cur + 1) % opts.length];
    this.chooseSubtitle(next);
    this.bubble(next === "off" ? "Subtitles off" : `Subtitles: ${this.subOptions().find((o) => o.key === next)?.label}`);
  }

  /** Re-apply the profile's preferred subtitle language when tracks show up. */
  autoSelectSub() {
    const want = this.settings.subtitleLang;
    if (!want || this.sub) return;
    const match = this.subOptions().find((o) => o.lang === want || (o.lang || "").startsWith(want));
    if (match) this.chooseSubtitle(match.key, { silent: true });
  }

  pickSubtitleFile() {
    const input = el(`<input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden />`);
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const cues = parseSubtitles(await f.text());
      if (!cues.length) return this.bubble("No cues found in that file");
      this.ext.push({ label: f.name.replace(/\.(srt|vtt)$/i, ""), lang: "", cues });
      this.setSubtitle({ kind: "ext", i: this.ext.length - 1 });
      this.bubble(`Loaded ${cues.length} subtitle lines`);
    };
    this.root.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  }

  renderCues() {
    if (!this.sub) return;
    const t = this.v.currentTime - this.subOffset;
    let lines = [];
    if (this.sub.kind === "ext") {
      lines = activeCues(this.ext[this.sub.i]?.cues || [], t).map((c) => c.text);
    } else {
      const track = [...this.v.textTracks].find((tt) => (tt.kind === "subtitles" || tt.kind === "captions") && tt.mode !== "disabled");
      if (track) {
        if (track.mode === "showing") track.mode = "hidden";
        lines = [...(track.activeCues || [])].map((c) => c.text);
      }
    }
    const key = lines.join("\u0000");
    if (key === this.lastCueKey) return;
    this.lastCueKey = key;
    $(".p-subs", this.root).innerHTML = lines.map((l) => `<span>${cueHTML(l)}</span>`).join("");
  }

  /* ================================================================
     Up next / progress
     ================================================================ */

  /** next: { title, still, go() } | null */
  setNext(next) {
    this.next = next;
    this.btn("next").hidden = !next;
    if ("mediaSession" in navigator) try { navigator.mediaSession.setActionHandler("nexttrack", next ? () => next.go() : null); } catch {}
  }

  checkUpNext() {
    const { currentTime: t, duration: d } = this.v;
    if (!this.next || this.upNextDismissed || !d || d < 300 || this.upNextEl) return;
    if (d - t <= UP_NEXT_AT) this.showUpNext();
  }

  showUpNext() {
    const n = this.next;
    const auto = this.settings.autoplayNext !== false;
    this.upNextEl = el(html`<div class="p-next glass">
      ${n.still ? html`<img src="${n.still}" alt="" />` : html`<span></span>`}
      <div><small>Next episode</small><b>${n.title}</b>
        <div class="row-btns"><button class="btn btn-primary ring" data-p="upnext-play">${raw(icons.play)} <span>${auto ? "Next in 10" : "Play"}</span></button><button class="btn btn-glass glass" data-p="upnext-cancel">Dismiss</button></div>
      </div></div>`);
    this.root.append(this.upNextEl);
    if (!auto) return;
    let left = 10;
    const label = $(".ring span", this.upNextEl), ring = $(".ring", this.upNextEl);
    this.upNextTimer = setInterval(() => {
      if (this.v.paused && !this.v.ended) return; // pause the countdown with the video
      left -= 1;
      ring.style.setProperty("--p", `${(1 - left / 10) * 100}%`);
      label.textContent = left > 0 ? `Next in ${left}` : "Starting…";
      if (left <= 0) { clearInterval(this.upNextTimer); n.go(); }
    }, 1000);
  }

  hideUpNext() {
    clearInterval(this.upNextTimer);
    this.upNextEl?.remove();
    this.upNextEl = null;
  }

  reportProgress() {
    if (!this.started) return;
    const { currentTime, duration } = this.v;
    if (duration && Number.isFinite(duration)) this.opts.onProgress?.({ position: currentTime, duration });
  }

  setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
    set("play", () => this.play());
    set("pause", () => this.v.pause());
    set("seekbackward", () => this.seek(-10, { relative: true }));
    set("seekforward", () => this.seek(10, { relative: true }));
    set("seekto", (d) => this.seek(d.seekTime));
  }

  destroy() {
    this.reportProgress();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.idleTimer); clearTimeout(this.bubbleTimer); clearTimeout(this.clickTimer);
    this.hideUpNext();
    this.disposers.forEach((d) => d());
    this.teardownEngine();
    if (document.pictureInPictureElement === this.v) document.exitPictureInPicture().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if ("mediaSession" in navigator) {
      for (const a of ["play", "pause", "seekbackward", "seekforward", "seekto", "nexttrack"]) try { navigator.mediaSession.setActionHandler(a, null); } catch {}
      navigator.mediaSession.metadata = null;
    }
    this.root.remove();
  }
}
