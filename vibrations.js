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

    _api: navigator.vibrate ? navigator.vibrate.bind(navigator)
        : (navigator.mozVibrate ? navigator.mozVibrate.bind(navigator) : null),

    isSupported() { return Boolean(this._api); },
    setIntensity(value) {
        const intensity = Number(value);
        this.intensity = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
    },

    // Low-level primitive. Safe no-op if vibration is unsupported or disabled.
    _raw(pattern) {
        if (!this.enabled || this.intensity === 0) return;
        if (!this._api) return;
        const scaledPattern = Array.isArray(pattern)
            ? pattern.map((duration, index) => index % 2 === 0
                ? Math.max(1, Math.round(duration * this.intensity))
                : duration)
            : Math.max(1, Math.round(pattern * this.intensity));
        try { this._api(scaledPattern); } catch (e) {}
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