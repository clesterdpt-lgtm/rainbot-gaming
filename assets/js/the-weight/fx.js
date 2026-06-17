// =============================================================
// fx.js — screen-space effects driven over the WebGL canvas
//
// Animated film grain plus small helpers for the flash / fade /
// subtitle / title overlays. (Phase-2 chromatic aberration is a
// WebGL post pass and will live with the astral renderer.)
// =============================================================

(function () {
window.TW = window.TW || {};
TW.FX = class FX {
  constructor() {
    this.grain = document.getElementById('fx-grain');
    this.blood = document.getElementById('fx-blood');
    this.flash = document.getElementById('fx-flash');
    this.fade = document.getElementById('fx-fade');
    this.sub = document.getElementById('fx-sub');
    this.title = document.getElementById('fx-title');
    this.lidTop = document.getElementById('fx-lid-top');
    this.lidBottom = document.getElementById('fx-lid-bottom');

    this._gctx = this.grain ? this.grain.getContext('2d') : null;
    this._gw = 0; this._gh = 0;
    this._noise = null;
    this._tick = 0;
    this._resizeGrain();
  }

  _resizeGrain() {
    if (!this.grain) return;
    // low-res noise stretched over the screen — cheap and filmic
    this._gw = 160;
    this._gh = Math.round(160 * (window.innerHeight / window.innerWidth)) || 90;
    this.grain.width = this._gw;
    this.grain.height = this._gh;
    this._noise = this._gctx.createImageData(this._gw, this._gh);
  }

  resize() { this._resizeGrain(); }

  /** drive the eyelids: 0 = eyes open, 1 = fully shut */
  setEyelids(frac) {
    if (!this.lidTop) return;
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    this.lidTop.style.transform = `translateY(${-100 + f * 100}%)`;
    this.lidBottom.style.transform = `translateY(${100 - f * 100}%)`;
  }

  /** call every frame; intensity 0..1 */
  updateGrain(intensity = 0.06) {
    if (!this._gctx) return;
    // throttle to ~30fps for that filmstrip stutter
    this._tick++;
    if (this._tick % 2 === 0) return;
    const d = this._noise.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    this._gctx.putImageData(this._noise, 0, 0);
    this.grain.style.opacity = intensity;
  }

  flashWhite(dur = 120) {
    if (!this.flash) return;
    this.flash.style.transition = 'opacity 40ms ease-out';
    this.flash.style.opacity = '1';
    setTimeout(() => {
      this.flash.style.transition = `opacity ${dur}ms ease-out`;
      this.flash.style.opacity = '0';
    }, 40);
  }

  fadeTo(opacity, ms = 1200) {
    if (!this.fade) return;
    this.fade.style.transition = `opacity ${ms}ms linear`;
    this.fade.style.opacity = String(opacity);
  }

  bloodLevel(x) {
    if (this.blood) this.blood.style.opacity = String(x);
  }

  subtitle(text, ms = 3600) {
    if (!this.sub) return;
    clearTimeout(this._subTimer);
    this.sub.textContent = text;
    this.sub.style.opacity = '1';
    if (ms > 0) {
      this._subTimer = setTimeout(() => { this.sub.style.opacity = '0'; }, ms);
    }
  }

  showTitle(text, ms = 0) {
    if (!this.title) return;
    this.title.textContent = text;
    this.title.style.opacity = '1';
    if (ms > 0) setTimeout(() => { this.title.style.opacity = '0'; }, ms);
  }
  hideTitle() { if (this.title) this.title.style.opacity = '0'; }
};
})();
