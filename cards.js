/**
 * Insight - Card System & Viewport Engine
 * Manages the card viewport, navigation, double-tap reveal, and long-press
 * winner selection.
 *
 * Interaction model:
 *  - Tap a neighboring (non-centered) card  -> navigate to it (no reveal)
 *  - Tap arrows                             -> navigate
 *  - Double-tap the centered card -> reveal or hide it on this device only
 *  - Long-press a fully revealed, centered card -> select as winner
 * A single pointer gesture only ever resolves to ONE of: navigate / reveal /
 * long-press-select. They are disambiguated in handlePointerUp/timers below
 * so a normal tap can't accidentally reveal.
 */

const CardSystem = {
    container: null,
    cards: [],
    focusIndex: 0,
    isMeSubject: false,
    screenTransitionTime: 0,
    onFlipCallback: null,
    onUnflipCallback: null,
    onSelectCallback: null,
    gestureAttached: false,

    // ── Gesture tuning ──
    NAV_SWIPE_THRESHOLD: 35,        // px of horizontal drag on a neighboring card to navigate
    TAP_MAX_MOVEMENT: 10,           // px - below this, a pointer up counts as a tap, not a drag
    DOUBLE_TAP_MAX_DELAY: 350,      // ms between taps to count as a double-tap
    LONG_PRESS_MS: 550,             // ms of holding still to trigger winner selection
    LONG_PRESS_MAX_MOVEMENT: 12,    // px - moving past this cancels a pending long press

    init(container, cards, options = {}) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        if (!this.container) return;

        this.cards = cards || [];
        this.isMeSubject = !!options.isMeSubject;
        this.screenTransitionTime = options.screenTransitionTime || Date.now();
        this.onFlipCallback = options.onFlip || null;
        this.onUnflipCallback = options.onUnflip || null;
        this.onSelectCallback = options.onSelect || null;

        const selectedIdx = this.cards.findIndex(c => c.selected);
        if (selectedIdx !== -1) {
            this.focusIndex = selectedIdx;
        } else {
            const firstUnrevealed = this.cards.findIndex(c => !c.revealed);
            this.focusIndex = firstUnrevealed !== -1 ? firstUnrevealed : 0;
        }

        this.render();
        this.attachGestures();
    },

    setCards(cards) {
        this.cards = cards || [];
        this.render();
    },

    syncCard(idx, card) {
        if (!card || idx < 0 || idx >= this.cards.length) return;
        this.cards[idx] = card;
        this.updateCard(idx);
    },

    render() {
        if (!this.container) return;

        this.container.innerHTML = '';
        this.container.className = 'cards-viewport-wrapper';

        if (!this.cards || this.cards.length === 0) return;

        if (this.focusIndex < 0) this.focusIndex = 0;
        if (this.focusIndex >= this.cards.length) this.focusIndex = this.cards.length - 1;

        const stage = document.createElement('div');
        stage.className = 'cards-viewport-stage';

        this.cards.forEach((c, idx) => {
            const cardEl = this.createCardElement(c, idx);
            stage.appendChild(cardEl);
        });

        this.container.appendChild(stage);

        if (this.cards.length > 1) {
            const controls = document.createElement('div');
            controls.className = 'cards-nav-controls';

            const prevBtn = document.createElement('button');
            prevBtn.className = 'cards-nav-btn cards-nav-prev';
            prevBtn.innerHTML = '&#10094;';
            prevBtn.disabled = this.focusIndex <= 0;
            prevBtn.onclick = (e) => {
                e.stopPropagation();
                this.prevCard();
            };

            const counter = document.createElement('div');
            counter.className = 'cards-counter-badge';
            counter.innerText = `${this.focusIndex + 1} / ${this.cards.length}`;

            const nextBtn = document.createElement('button');
            nextBtn.className = 'cards-nav-btn cards-nav-next';
            nextBtn.innerHTML = '&#10095;';
            nextBtn.disabled = this.focusIndex >= this.cards.length - 1;
            nextBtn.onclick = (e) => {
                e.stopPropagation();
                this.nextCard();
            };

            controls.appendChild(prevBtn);
            controls.appendChild(counter);
            controls.appendChild(nextBtn);
            this.container.appendChild(controls);
        }

        this.updatePositions();
    },

    createCardElement(card, idx) {
        const el = document.createElement('div');
        el.id = `rcard-${idx}`;
        el.dataset.index = idx;
        el.className = 'reveal-card-scene';

        el.innerHTML = `
            <div class="reveal-card-inner">
                <div class="reveal-card-face reveal-card-front">
                    <div class="card-back-pattern"></div>
                    <div class="card-back-label card-front-label">${idx + 1}</div>
                </div>
                <div class="reveal-card-face reveal-card-back">
                    <div class="card-text"></div>
                    <div class="author-reveal" style="display:none;"></div>
                    <button type="button" class="card-copy-btn" style="display:none;" aria-label="Copy card text">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>
                        <span class="card-copy-label">COPY</span>
                    </button>
                </div>
            </div>
        `;

        const copyBtn = el.querySelector('.card-copy-btn');
        copyBtn.addEventListener('pointerdown', e => e.stopPropagation());
        copyBtn.addEventListener('mousedown', e => e.stopPropagation());
        copyBtn.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
        copyBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this.copyCardText(idx, copyBtn);
        });

        this.updateCardContent(el, card, idx);
        return el;
    },

    updateCardContent(el, card, idx) {
        if (!el) return;
        const textEl = el.querySelector('.card-text');
        const authorEl = el.querySelector('.author-reveal');
        const copyBtn = el.querySelector('.card-copy-btn');
        const frontLabelEl = el.querySelector('.card-front-label');

        el.classList.remove('selected', 'is-flipped');
        el.classList.remove('winner-selected', 'is-charging');
        el.style.removeProperty('--charge-progress');

        if (card.selected) {
            el.classList.add('selected', 'is-flipped');
            if (frontLabelEl) frontLabelEl.innerText = idx + 1;
            if (textEl) textEl.innerText = card.text;
            if (authorEl) {
                authorEl.innerText = `Written by: ${card.creator}`;
                authorEl.style.display = 'block';
            }
            if (copyBtn) copyBtn.style.display = 'inline-flex';
        } else if (card.revealed) {
            el.classList.add('is-flipped');
            if (frontLabelEl) frontLabelEl.innerText = idx + 1;
            if (textEl) textEl.innerText = card.text;
            if (authorEl) authorEl.style.display = 'none';
            if (copyBtn) copyBtn.style.display = 'inline-flex';
        } else {
            el.classList.remove('is-flipped');
            if (frontLabelEl) frontLabelEl.innerText = idx + 1;
            if (textEl) textEl.innerText = '';
            if (textEl && !this.isMeSubject) {
                textEl.innerHTML = `<div style="font-size: 11px; color: var(--neon-pink); font-weight: 700; letter-spacing: 0.5px;">HIDDEN</div>`;
            }
            if (authorEl) authorEl.style.display = 'none';
            if (copyBtn) copyBtn.style.display = 'none';
        }
    },

    async copyCardText(idx, button) {
        const card = this.cards[idx];
        if (!card || (!card.revealed && !card.selected)) return;

        const text = card.selected && card.creator
            ? `${card.text}\n\nWritten by: ${card.creator}`
            : card.text;
        let copied = false;
        let copyError = null;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                copied = true;
            } catch (error) {
                copyError = error;
            }
        }

        if (!copied) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.setAttribute('readonly', '');
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            try {
                textArea.select();
                copied = document.execCommand('copy');
            } catch (error) {
                copyError = error;
            } finally {
                textArea.remove();
            }
        }

        if (!copied) {
            console.error('Unable to copy revealed card text.', copyError);
            if (typeof showToast === 'function') showToast('Could not copy card');
            return;
        }

        const label = button.querySelector('.card-copy-label');
        button.classList.add('is-copied');
        button.setAttribute('aria-label', 'Card text copied');
        if (label) label.innerText = 'COPIED';
        if (typeof showToast === 'function') showToast('Card copied');
        setTimeout(() => {
            button.classList.remove('is-copied');
            button.setAttribute('aria-label', 'Copy card text');
            if (label) label.innerText = 'COPY';
        }, 1400);
    },

    updateCard(idx) {
        if (!this.cards || !this.cards[idx]) return;
        const el = document.getElementById(`rcard-${idx}`);
        if (el) {
            // Clear any live drag-rotation override so the persisted is-flipped
            // class (set inside updateCardContent) takes over cleanly.
            const inner = el.querySelector('.reveal-card-inner');
            if (inner) {
                inner.style.transform = '';
                inner.style.transformOrigin = '';
            }
            this.updateCardContent(el, this.cards[idx], idx);
        }
        this.updatePositions();
    },

    updatePositions() {
        if (!this.cards || this.cards.length === 0) return;

        const total = this.cards.length;

        this.cards.forEach((_, idx) => {
            const el = document.getElementById(`rcard-${idx}`);
            if (!el) return;

            const diff = idx - this.focusIndex;
            const wasFlipped = el.classList.contains('is-flipped');
            const wasSelected = el.classList.contains('selected');

            if (diff === 0) {
                el.className = 'reveal-card-scene pos-center';
                el.style.transform = `translateX(0px) translateY(0px) scale(1) rotate(0deg)`;
                el.style.zIndex = '30';
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            } else if (diff === -1) {
                el.className = 'reveal-card-scene pos-left';
                el.style.transform = `translateX(-105px) translateY(12px) scale(0.88) rotate(-6deg)`;
                el.style.zIndex = '20';
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            } else if (diff === 1) {
                el.className = 'reveal-card-scene pos-right';
                el.style.transform = `translateX(105px) translateY(12px) scale(0.88) rotate(6deg)`;
                el.style.zIndex = '20';
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            } else if (diff < -1) {
                const stackDepth = Math.min(4, Math.abs(diff) - 1);
                el.className = 'reveal-card-scene pos-stacked-left';
                const offsetX = -105 - (stackDepth * 8);
                const offsetY = 12 + (stackDepth * 6);
                const scale = Math.max(0.65, 0.88 - (stackDepth * 0.06));
                const rot = -6 - (stackDepth * 2);

                el.style.transform = `translateX(${offsetX}px) translateY(${offsetY}px) scale(${scale}) rotate(${rot}deg)`;
                el.style.zIndex = `${15 - stackDepth}`;
                el.style.opacity = '1';
                el.style.pointerEvents = 'none';
            } else if (diff > 1) {
                const stackDepth = Math.min(4, diff - 1);
                el.className = 'reveal-card-scene pos-stacked-right';
                const offsetX = 105 + (stackDepth * 8);
                const offsetY = 12 + (stackDepth * 6);
                const scale = Math.max(0.65, 0.88 - (stackDepth * 0.06));
                const rot = 6 + (stackDepth * 2);

                el.style.transform = `translateX(${offsetX}px) translateY(${offsetY}px) scale(${scale}) rotate(${rot}deg)`;
                el.style.zIndex = `${15 - stackDepth}`;
                el.style.opacity = '1';
                el.style.pointerEvents = 'none';
            }

            // className was just reset above - re-apply persisted state classes
            // (revealed/selected) that live independently of screen position.
            if (wasFlipped) el.classList.add('is-flipped');
            if (wasSelected) el.classList.add('selected');
        });

        const counter = this.container ? this.container.querySelector('.cards-counter-badge') : null;
        if (counter) counter.innerText = `${this.focusIndex + 1} / ${total}`;

        const prevBtn = this.container ? this.container.querySelector('.cards-nav-prev') : null;
        if (prevBtn) prevBtn.disabled = this.focusIndex <= 0;

        const nextBtn = this.container ? this.container.querySelector('.cards-nav-next') : null;
        if (nextBtn) nextBtn.disabled = this.focusIndex >= total - 1;
    },

    setFocus(index) {
        if (index < 0 || index >= this.cards.length) return;
        this.focusIndex = index;
        this.updatePositions();
    },

    nextCard() {
        if (this.focusIndex < this.cards.length - 1) {
            this.focusIndex++;
            if (typeof Sound !== 'undefined' && Sound.play) Sound.play(350, 'sine', 0.04);
            if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
            this.updatePositions();
        }
    },

    prevCard() {
        if (this.focusIndex > 0) {
            this.focusIndex--;
            if (typeof Sound !== 'undefined' && Sound.play) Sound.play(320, 'sine', 0.04);
            if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
            this.updatePositions();
        }
    },

    // Reveal state stays local to this device.
    revealCentered() {
        const idx = this.focusIndex;
        const card = this.cards[idx];
        if (!card || card.revealed) return;

        card.revealedAt = Date.now();
        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(300, 'triangle', 0.1);
        if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();

        if (this.onFlipCallback) this.onFlipCallback(idx);
    },

    unrevealCentered() {
        const idx = this.focusIndex;
        const card = this.cards[idx];
        if (!card || !card.revealed || card.selected) return;

        card.revealed = false;
        card.revealedAt = null;
        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(240, 'triangle', 0.08);
        if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();

        if (this.onUnflipCallback) this.onUnflipCallback(idx);
    },

    // Select the centered card as winner. Only valid when centered + revealed.
    selectCentered() {
        const idx = this.focusIndex;
        const card = this.cards[idx];
        if (!card || !card.revealed) return;
        if (this.cards.some(c => c.selected)) return; // winner already chosen
        if (!this.isMeSubject) return;
        if (Date.now() - this.screenTransitionTime < 1000) return; // ignore stray presses right after screen transition

        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(280, 'sine', 0.15);
        if (typeof Vibrate !== 'undefined' && Vibrate.success) Vibrate.success();

        if (this.onSelectCallback) this.onSelectCallback(idx);
    },

    attachGestures() {
        if (!this.container || this.gestureAttached) return;

        // Per-gesture tracking state, reset on every pointerdown.
        let activeIdx = null;
        let isCentered = false;
        let startX = 0;
        let startY = 0;
        let lastX = 0;
        let dragging = false;
        let gestureCancelled = false;
        let longPressTimer = null;
        let chargeFrame = null;
        let longPressFired = false;
        let lastTapTime = 0;
        let lastTapIdx = null;
        let activeCardEl = null;
        let activeInnerEl = null;

        const getCardElAt = (target) => target.closest ? target.closest('.reveal-card-scene') : null;

        const clearLongPress = () => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (chargeFrame) { cancelAnimationFrame(chargeFrame); chargeFrame = null; }
            if (activeCardEl) {
                activeCardEl.classList.remove('is-charging');
                activeCardEl.style.removeProperty('--charge-progress');
            }
        };

        const startCharge = () => {
            if (!activeCardEl) return;
            const startedAt = performance.now();
            activeCardEl.classList.add('is-charging');
            const updateCharge = (now) => {
                if (!activeCardEl) return;
                const progress = Math.min(1, (now - startedAt) / this.LONG_PRESS_MS);
                activeCardEl.style.setProperty('--charge-progress', progress.toString());
                if (progress < 1) chargeFrame = requestAnimationFrame(updateCharge);
            };
            chargeFrame = requestAnimationFrame(updateCharge);
        };

        const onPointerDown = (e) => {
            // Ignore secondary mouse buttons / multi-touch complexity; keep it simple.
            if (e.button !== undefined && e.button !== 0) return;

            const cardEl = getCardElAt(e.target);
            if (!cardEl) return;

            if (e.pointerId !== undefined && this.container.setPointerCapture) {
                this.container.setPointerCapture(e.pointerId);
            }

            activeIdx = parseInt(cardEl.dataset.index, 10);
            isCentered = cardEl.classList.contains('pos-center');
            activeCardEl = cardEl;
            activeInnerEl = cardEl.querySelector('.reveal-card-inner');

            const point = e.touches ? e.touches[0] : e;
            startX = point.clientX;
            startY = point.clientY;
            lastX = startX;
            dragging = false;
            gestureCancelled = false;
            longPressFired = false;

            // Long press only ever makes sense on the centered, revealed card.
            const card = this.cards[activeIdx];
            if (this.isMeSubject && isCentered && card && card.revealed && !card.selected) {
                startCharge();
                longPressTimer = setTimeout(() => {
                    longPressFired = true;
                    longPressTimer = null;
                    if (activeCardEl) activeCardEl.classList.add('winner-selected');
                    this.selectCentered();
                }, this.LONG_PRESS_MS);
            }
        };

        const onPointerMove = (e) => {
            if (activeIdx === null) return;
            const point = e.touches ? e.touches[0] : e;
            const currentX = point.clientX;
            const currentY = point.clientY;
            const deltaX = currentX - startX;
            const deltaY = currentY - startY;
            lastX = currentX;

            if (!dragging && Math.abs(deltaX) < this.TAP_MAX_MOVEMENT && Math.abs(deltaY) < this.TAP_MAX_MOVEMENT) {
                return; // hasn't moved enough to count as a drag yet
            }

            // Movement beyond the tap threshold cancels any pending long press,
            // so a drag can't also fire a long press.
            if (Math.abs(deltaX) > this.LONG_PRESS_MAX_MOVEMENT || Math.abs(deltaY) > this.LONG_PRESS_MAX_MOVEMENT) {
                clearLongPress();
            }

            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                dragging = true;
                if (e.cancelable) e.preventDefault();
            } else if (Math.abs(deltaY) >= this.TAP_MAX_MOVEMENT) {
                dragging = true;
                gestureCancelled = true;
                clearLongPress();
            }
        };

        const onPointerUp = (e) => {
            if (activeIdx === null) return;
            clearLongPress();

            if (e.pointerId !== undefined && this.container.hasPointerCapture && this.container.hasPointerCapture(e.pointerId)) {
                this.container.releasePointerCapture(e.pointerId);
            }

            const idx = activeIdx;
            const wasCentered = isCentered;
            const wasDragging = dragging;
            const inner = activeInnerEl;
            const deltaX = lastX - startX;

            activeIdx = null;
            isCentered = false;
            activeCardEl = null;
            activeInnerEl = null;

            if (inner) inner.style.transition = '';

            if (longPressFired) {
                // Long press already handled the interaction; just clean up the
                // (unrotated, since it was a hold not a drag) inline transform.
                resetTransformIfAny(inner);
                dragging = false;
                return;
            }

            if (wasDragging) {
                lastTapTime = 0;
                lastTapIdx = null;
                if (!gestureCancelled && !wasCentered && Math.abs(deltaX) >= this.NAV_SWIPE_THRESHOLD) {
                    // Dragged on a neighboring card far enough - treat as navigation swipe.
                    if (deltaX < 0) this.nextCard(); else this.prevCard();
                    resetTransformIfAny(inner);
                } else {
                    // Drag didn't cross a threshold - snap back to rest.
                    resetTransformIfAny(inner);
                }
                dragging = false;
                gestureCancelled = false;
                return;
            }

            // Not a drag - this was a tap/click.
            dragging = false;

            const now = Date.now();
            const isDoubleTap = (lastTapIdx === idx) && (now - lastTapTime < this.DOUBLE_TAP_MAX_DELAY);
            lastTapTime = now;
            lastTapIdx = idx;

            if (isDoubleTap) {
                if (wasCentered) {
                    if (this.cards[idx] && this.cards[idx].revealed) {
                        this.unrevealCentered();
                    } else {
                        this.revealCentered();
                    }
                }
                lastTapTime = 0; // consume the double-tap so a third tap doesn't chain
                return;
            }

            if (!wasCentered) {
                // Tap on a visible neighboring card navigates to it. Never reveals.
                this.setFocus(idx);
            }
            // A centered card only flips after a confirmed double-tap.
            gestureCancelled = false;
        };

        function resetTransformIfAny(inner) {
            if (inner) {
                inner.style.transform = '';
                inner.style.transformOrigin = '';
            }
        }

        const onPointerCancel = () => {
            clearLongPress();
            if (activeInnerEl) {
                activeInnerEl.style.transition = '';
                activeInnerEl.style.transform = '';
                activeInnerEl.style.transformOrigin = '';
            }
            activeIdx = null;
            isCentered = false;
            dragging = false;
            gestureCancelled = false;
            activeCardEl = null;
            activeInnerEl = null;
        };

        // Pointer Events cover mouse + touch + pen uniformly and avoid the
        // duplicate-firing issues of mixing touch* and mouse* listeners.
        if (window.PointerEvent) {
            this.container.addEventListener('pointerdown', onPointerDown);
            this.container.addEventListener('pointermove', onPointerMove, { passive: false });
            this.container.addEventListener('pointerup', onPointerUp);
            this.container.addEventListener('pointercancel', onPointerCancel);
        } else {
            // Fallback for older browsers without Pointer Events.
            this.container.addEventListener('touchstart', onPointerDown, { passive: true });
            this.container.addEventListener('touchmove', onPointerMove, { passive: false });
            this.container.addEventListener('touchend', onPointerUp);
            this.container.addEventListener('touchcancel', onPointerCancel);
            this.container.addEventListener('mousedown', onPointerDown);
            this.container.addEventListener('mousemove', onPointerMove);
            this.container.addEventListener('mouseup', onPointerUp);
        }

        this.gestureAttached = true;
    }
};

window.CardSystem = CardSystem;