// ── VIBRATIONS ────────────────────────────────────────────────────────────────
// Centralized haptic feedback for Insight (Classic Mode + Coin Mode).
// This is the ONLY file that should call navigator.vibrate / navigator.mozVibrate.
// Every other file calls Vibrations.<name>() instead.
//
// To change how a given interaction feels, edit the pattern below - nothing
// else in the codebase needs to change. To add a global on/off toggle later,
// gate `Vibrations.enabled` (see bottom of this file) from a Settings UI.

const Vibrations = {
    enabled: true,
    intensity: 1,
    _lastCallAt: 0,
    _lastPreviewAt: 0,
    _lastChargeAt: 0,

    _getApi() {
        if (typeof navigator === 'undefined') return null;
        if (typeof navigator.vibrate === 'function') return navigator.vibrate.bind(navigator);
        if (typeof navigator.mozVibrate === 'function') return navigator.mozVibrate.bind(navigator);
        return null;
    },
    isSupported() { return Boolean(this._getApi()); },
    setIntensity(value) {
        const intensity = Number(value);
        this.intensity = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
    },
    preview() {
        if (!this.enabled || this.intensity === 0 || !this.isSupported()) return;
        const now = Date.now();
        if (now - this._lastPreviewAt < 120) return;
        this._lastPreviewAt = now;
        this._raw(Math.max(20, Math.round(100 * this.intensity)));
    },
    charge(progress) {
        if (!this.enabled || this.intensity === 0 || !this.isSupported()) return;
        const now = Date.now();
        if (now - this._lastChargeAt < 140) return;
        this._lastChargeAt = now;
        const normalizedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
        this._raw(Math.round(8 + normalizedProgress * 18));
    },

    // Low-level primitive. Safe no-op if vibration is unsupported or disabled.
    _raw(pattern) {
        if (!this.enabled || this.intensity === 0) return;
        const api = this._getApi();
        if (!api) return;
        const now = Date.now();
        if (now - this._lastCallAt < 80) return;
        if (navigator.userActivation && navigator.userActivation.isActive === false) return;
        const scaledPattern = Array.isArray(pattern)
            ? pattern.map((duration, index) => index % 2 === 0
                ? Math.max(1, Math.round(duration * this.intensity))
                : duration)
            : Math.max(1, Math.round(pattern * this.intensity));
        this._lastCallAt = now;
        try {
            api(scaledPattern);
        } catch (error) {
            // Browsers may expose the API but reject calls in restricted contexts.
        }
    },

    // ── Named patterns (existing behavior, preserved as-is) ──
    tap()      { this._raw(45); },               // light UI tap (fidget toys, join/late-join)
    click()    { this._raw(35); },               // standard button press
    pop()      { this._raw([30, 30, 30]); },      // bubble-pop fidget toy
    success()  { this._raw([20, 30, 40]); },      // winner/favorite selected (was inline Vibrate.buzz([20,30,40]))
    coinFlip() { this._raw([15, 40, 15, 40]); },  // Coin Mode: tap-to-flip the coin

    // Generic escape hatch, kept for parity with the old Vibrate.buzz(pattern) API
    // in case any external/legacy code still calls it directly.
    buzz(pattern) { this._raw(pattern); }
};

// ── BACKWARD-COMPAT ALIAS ────────────────────────────────────────────────────
// game.js and coinMode.js currently reference a global `Vibrate` object with
// tap()/click()/pop()/buzz(). Keeping this alias means neither file needs its
// call sites rewritten one-by-one - they all route through Vibrations above.
const Vibrate = Vibrations;

// Inline HTML handlers access the compatibility alias through window.
window.Vibrations = Vibrations;
window.Vibrate = Vibrations;

document.addEventListener('click', event => {
    const target = event.target instanceof Element
        ? event.target.closest('button, .circle-btn, .deck-pill, .round-pill, .game-setting-toggle, .player-pill, .btn-cat')
        : null;
    if (!target || target.hasAttribute('disabled') ||
        target.getAttribute('aria-disabled') === 'true' ||
        target.dataset.haptic === 'none') return;
    Vibrations.click();
});