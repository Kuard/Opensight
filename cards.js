/**
 * Insight - Card System & Viewport Engine
 * Manages local draw/read pile navigation, card reveal, and long-press voting.
 *
 * Interaction model:
 *  - Tap DRAW/READ or swipe the active card -> move one card between piles
 *  - Long-press the active card             -> vote or select a winner
 */

const CardSystem = {
    container: null,
    cards: [],
    focusIndex: 0,
    drawPile: [],
    readPile: [],
    activeCardId: null,
    navigationKey: null,
    options: {},
    isFinalPresentation: false,
    isAnimating: false,
    animationTimer: null,
    isMeSubject: false,
    screenTransitionTime: 0,
    onFlipCallback: null,
    onUnflipCallback: null,
    onSelectCallback: null,
    canSelectCallback: null,
    gestureAttached: false,

    // ── Gesture tuning ──
    NAV_SWIPE_THRESHOLD: 35,        // px of horizontal drag on the centered card to navigate
    TAP_MAX_MOVEMENT: 10,           // px - below this, a pointer up counts as a tap, not a drag
    LONG_PRESS_MS: 550,             // ms of holding still to trigger winner selection
    LONG_PRESS_MAX_MOVEMENT: 12,    // px - moving past this cancels a pending long press

    getCardId(card, index) {
        if (typeof card.id === 'string' && card.id) return card.id;
        if (typeof card.creator === 'string' && card.creator) return `creator:${card.creator}`;
        return `index:${index}`;
    },

    init(container, cards, options = {}) {
        const nextContainer = typeof container === 'string' ? document.getElementById(container) : container;
        if (!nextContainer) return;
        this.container = nextContainer;
        this.options = { ...options };
        if (this.animationTimer) clearTimeout(this.animationTimer);
        this.animationTimer = null;
        this.isAnimating = false;

        const incomingCards = (cards || []).map((card, index) => ({
            ...card,
            cardId: this.getCardId(card, index)
        }));
        const nextNavigationKey = options.navigationKey ||
            incomingCards.map(card => card.cardId).join('|');
        const preserveNavigation = this.navigationKey === nextNavigationKey;
        const previousCards = new Map(this.cards.map(card => [card.cardId, card]));
        this.cards = incomingCards.map(card => {
            const previous = previousCards.get(card.cardId);
            return {
                ...card,
                drawn: preserveNavigation && previous ? previous.drawn : false,
                revealed: preserveNavigation && previous ? previous.revealed : false,
                revealedAt: preserveNavigation && previous ? previous.revealedAt : null,
                myCommunityVote: card.myCommunityVote === undefined
                    ? !!(previous && previous.myCommunityVote)
                    : !!card.myCommunityVote
            };
        });
        if (!preserveNavigation) {
            this.drawPile = this.cards.map(card => card.cardId);
            this.readPile = [];
            this.activeCardId = null;
            this.isFinalPresentation = false;
        } else {
            const validIds = new Set(this.cards.map(card => card.cardId));
            this.drawPile = this.drawPile.filter(id => validIds.has(id));
            this.readPile = this.readPile.filter(id => validIds.has(id));
            if (!validIds.has(this.activeCardId)) this.activeCardId = null;
            const placedIds = new Set([...this.drawPile, ...this.readPile, this.activeCardId].filter(Boolean));
            this.cards.forEach(card => {
                if (!placedIds.has(card.cardId)) this.drawPile.push(card.cardId);
            });
        }
        this.navigationKey = nextNavigationKey;
        this.isMeSubject = !!options.isMeSubject;
        this.screenTransitionTime = options.screenTransitionTime || Date.now();
        this.onFlipCallback = options.onFlip || null;
        this.onUnflipCallback = options.onUnflip || null;
        this.onSelectCallback = options.onSelect || null;
        this.canSelectCallback = options.canSelect || null;
        this.isFinalPresentation = this.isFinalPresentation ||
            options.isFinalPresentation === true || options.phase === 'results';

        if (this.isFinalPresentation) {
            const selected = this.cards.find(card => card.selected || card.subjectFavorite) ||
                this.cards.find(card => card.communityFavorite);
            if (selected) this.setFinalCard(selected.cardId);
        }

        this.syncFocusIndex();
        this.render();
        this.attachGestures();
    },

    setCards(cards) {
        const nextOptions = (cards || []).length
            ? this.options
            : { ...this.options, navigationKey: null, phase: 'lobby', isFinalPresentation: false };
        this.init(this.container, cards, nextOptions);
    },

    syncCard(idx, card) {
        if (!card || idx < 0 || idx >= this.cards.length) return;
        const currentCard = this.cards[idx];
        this.cards[idx] = {
            ...card,
            cardId: currentCard.cardId,
            drawn: !!currentCard.drawn,
            myCommunityVote: card.myCommunityVote === undefined
                ? !!currentCard.myCommunityVote
                : !!card.myCommunityVote
        };
        this.updateCard(idx);
    },

    render() {
        if (!this.container) return;

        this.container.innerHTML = '';
        this.container.className = 'cards-viewport-wrapper';

        if (this.focusIndex < -1) this.focusIndex = 0;
        if (this.focusIndex >= this.cards.length) this.focusIndex = this.cards.length - 1;

        const stage = document.createElement('div');
        stage.className = 'cards-viewport-stage';

        const drawButton = this.createPileButton('draw', 'DRAW');
        const readButton = this.createPileButton('read', 'READ');
        stage.append(drawButton, readButton);

        const placeholder = document.createElement('div');
        placeholder.className = 'reveal-card-placeholder cards-empty-state';
        placeholder.innerText = this.cards.length
            ? 'Tap DRAW to advance or READ to go back.'
            : 'No cards to show.';
        stage.appendChild(placeholder);

        this.cards.forEach((c, idx) => {
            const cardEl = this.createCardElement(c, idx);
            stage.appendChild(cardEl);
        });

        this.container.appendChild(stage);

        const counter = document.createElement('div');
        counter.className = 'cards-counter-badge';
        counter.setAttribute('aria-live', 'polite');
        stage.appendChild(counter);

        this.updatePositions();
    },

    createPileButton(pile, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `card-pile-button card-pile-${pile}`;
        button.dataset.pile = pile;
        button.innerHTML = `
            <span class="card-pile-stack" aria-hidden="true">
                <span class="card-pile-layer card-pile-layer-back"></span>
                <span class="card-pile-layer card-pile-layer-mid"></span>
                <span class="card-pile-layer card-pile-layer-top"></span>
                <span class="card-pile-total"></span>
            </span>
            <span class="card-pile-label">${label}</span>
        `;
        button.addEventListener('click', () => {
            if (pile === 'draw') this.nextCard();
            else this.prevCard();
        });
        return button;
    },

    drawNextCard() {
        return this.moveForward();
    },

    moveForward() {
        if (this.isFinalPresentation || this.isAnimating || this.cards.length === 0) return false;
        const current = this.cards.find(card => card.cardId === this.activeCardId);
        if (this.drawPile.length === 0) {
            if (!current) return false;
            this.readPile.push(current.cardId);
            this.activeCardId = null;
            this.syncFocusIndex();
            this.startTransition();
            this.updatePositions();
            return true;
        }

        const nextId = this.drawPile[0];
        const next = this.cards.find(card => card.cardId === nextId);
        if (!next) return false;
        this.drawPile.shift();
        if (current) {
            current.drawn = true;
            current.revealed = true;
            this.readPile.push(current.cardId);
        }
        this.activeCardId = nextId;
        next.drawn = true;
        next.revealed = true;
        next.revealedAt = Date.now();
        this.syncFocusIndex();
        this.startTransition();
        this.updatePositions();
        if (this.onFlipCallback) this.onFlipCallback(this.focusIndex);
        return true;
    },

    moveBackward() {
        if (this.isFinalPresentation || this.isAnimating || this.cards.length === 0) return false;
        const current = this.cards.find(card => card.cardId === this.activeCardId);
        if (this.readPile.length === 0) {
            if (!current) return false;
            current.drawn = false;
            current.revealed = false;
            current.revealedAt = null;
            this.drawPile.unshift(current.cardId);
            this.activeCardId = null;
            this.syncFocusIndex();
            this.startTransition();
            this.updatePositions();
            if (this.onUnflipCallback) this.onUnflipCallback(this.cards.indexOf(current));
            return true;
        }

        const previousId = this.readPile[this.readPile.length - 1];
        const previous = this.cards.find(card => card.cardId === previousId);
        if (!previous) return false;
        this.readPile.pop();
        if (current) {
            current.drawn = false;
            current.revealed = false;
            current.revealedAt = null;
            this.drawPile.unshift(current.cardId);
        }
        this.activeCardId = previousId;
        previous.drawn = true;
        previous.revealed = true;
        previous.revealedAt = Date.now();
        this.syncFocusIndex();
        this.startTransition();
        this.updatePositions();
        if (current && this.onUnflipCallback) {
            this.onUnflipCallback(this.cards.indexOf(current));
        }
        if (this.onFlipCallback) this.onFlipCallback(this.focusIndex);
        return true;
    },

    startTransition() {
        const reducedMotion = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const duration = reducedMotion ? 0 : 420;
        this.isAnimating = duration > 0;
        if (this.animationTimer) clearTimeout(this.animationTimer);
        if (duration > 0) {
            this.animationTimer = window.setTimeout(() => {
                this.isAnimating = false;
                this.animationTimer = null;
                this.updatePositions();
            }, duration);
        }
    },

    setFinalCard(cardId) {
        const card = this.cards.find(entry => entry.cardId === cardId);
        if (!card) return;
        this.drawPile = this.drawPile.filter(id => id !== cardId);
        this.readPile = this.readPile.filter(id => id !== cardId);
        if (this.activeCardId && this.activeCardId !== cardId) {
            const active = this.cards.find(entry => entry.cardId === this.activeCardId);
            if (active) {
                active.drawn = false;
                active.revealed = false;
                active.revealedAt = null;
                this.drawPile.unshift(active.cardId);
            }
        }
        this.activeCardId = cardId;
        this.isFinalPresentation = true;
        card.drawn = true;
        card.revealed = true;
        this.syncFocusIndex();
    },

    syncFocusIndex() {
        this.focusIndex = this.cards.findIndex(card => card.cardId === this.activeCardId);
    },

    updatePileControls() {
        if (!this.container) return;
        const drawButton = this.container.querySelector('[data-pile="draw"]');
        const readButton = this.container.querySelector('[data-pile="read"]');
        const updateButton = (button, pile, label) => {
            if (!button) return;
            const count = pile.length;
            button.disabled = this.cards.length === 0 ||
                this.isFinalPresentation || this.isAnimating ||
                (count === 0 && !this.activeCardId);
            button.setAttribute('aria-label', `${label} pile, ${count} ${count === 1 ? 'card' : 'cards'}`);
            button.querySelector('.card-pile-total').textContent = String(count);
        };
        updateButton(drawButton, this.drawPile, 'Draw');
        updateButton(readButton, this.readPile, 'Read');
    },

    navigateToCard(index) {
        if (index < 0 || index >= this.cards.length) return;
        const id = this.cards[index].cardId;
        if (this.drawPile[0] === id) this.moveForward();
        else if (this.readPile[this.readPile.length - 1] === id) this.moveBackward();
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
            <span class="my-community-vote-dot" aria-label="Your community vote"></span>
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

        el.classList.remove('selected', 'is-flipped', 'community-favorite', 'subject-favorite');
        el.classList.remove('winner-selected', 'is-charging', 'has-my-community-vote');
        if (card.communityFavorite) el.classList.add('community-favorite');
        if (card.subjectFavorite || card.selected) el.classList.add('subject-favorite');
        if (card.myCommunityVote) el.classList.add('has-my-community-vote');
        el.style.removeProperty('--charge-progress');

        if (card.selected) {
            el.classList.add('selected');
            if (frontLabelEl) frontLabelEl.innerText = idx + 1;
            if (card.drawn) {
                el.classList.add('is-flipped');
                if (textEl) textEl.innerText = card.text;
                if (authorEl) {
                    authorEl.innerText = `Written by: ${card.creator}`;
                    authorEl.style.display = 'block';
                }
                if (copyBtn) copyBtn.style.display = 'inline-flex';
            } else {
                if (textEl) textEl.innerText = '';
                if (authorEl) authorEl.style.display = 'none';
                if (copyBtn) copyBtn.style.display = 'none';
            }
        } else if (card.drawn) {
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
        if (!card || !card.drawn) return;

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
        if (!this.container) return;
        const placeholder = this.container.querySelector('.cards-empty-state');
        const hasActiveCard = !!this.activeCardId;
        if (placeholder) {
            placeholder.hidden = hasActiveCard;
            placeholder.textContent = this.isFinalPresentation
                ? 'No card was selected this round.'
                : !this.cards.length
                    ? 'No cards to show.'
                    : 'Tap DRAW to advance or READ to go back.';
        }

        const drawPositions = new Map(this.drawPile.map((id, index) => [id, index]));
        const readPositions = new Map(this.readPile.map((id, index) => [
            id,
            this.readPile.length - index - 1
        ]));
        this.cards.forEach((card, idx) => {
            const el = document.getElementById(`rcard-${idx}`);
            if (!el) return;

            const isActive = card.cardId === this.activeCardId;
            const drawDepth = drawPositions.get(card.cardId);
            const readDepth = readPositions.get(card.cardId);
            let position = 'pos-hidden';
            let depth = 0;
            if (isActive) position = 'pos-center';
            else if (drawDepth !== undefined && drawDepth < 3) {
                position = 'pos-draw-pile';
                depth = drawDepth;
            } else if (readDepth !== undefined && readDepth < 3) {
                position = 'pos-read-pile';
                depth = readDepth;
            }

            el.className = `reveal-card-scene ${position}`;
            el.style.zIndex = isActive ? '30' : position === 'pos-hidden' ? '0' : String(12 - depth);
            // Parked cards fade out as they reach a pile: the DRAW/READ buttons
            // already draw the piles, so showing both made two stacks overlap.
            el.style.opacity = position === 'pos-center' ? '1' : '0';
            el.style.visibility = position === 'pos-hidden' ? 'hidden' : 'visible';
            el.style.pointerEvents = position === 'pos-center' && !this.isAnimating ? 'auto' : 'none';
            el.style.setProperty('--stack-x', `${depth * (position === 'pos-draw-pile' ? 4 : -4)}px`);
            el.style.setProperty('--stack-y', `${depth * -5}px`);
            el.style.setProperty('--stack-rotation', `${depth * (position === 'pos-draw-pile' ? -2 : 2)}deg`);
            this.updateCardContent(el, card, idx);
        });

        this.updatePileControls();
        const counter = this.container.querySelector('.cards-counter-badge');
        if (counter) {
            counter.textContent = hasActiveCard
                ? `${this.focusIndex + 1} / ${this.cards.length}`
                : `0 / ${this.cards.length}`;
        }
    },

    setFocus(index) {
        this.navigateToCard(index);
    },

    nextCard() {
        if (this.moveForward()) {
            if (typeof Sound !== 'undefined' && Sound.play) Sound.play(350, 'sine', 0.04);
            if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
        }
    },

    prevCard() {
        if (this.moveBackward()) {
            if (typeof Sound !== 'undefined' && Sound.play) Sound.play(320, 'sine', 0.04);
            if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
        }
    },

    selectCentered() {
        const idx = this.focusIndex;
        const card = this.cards[idx];
        if (this.isFinalPresentation || !card || card.cardId !== this.activeCardId || !card.drawn) return;
        if (this.cards.some(c => c.selected)) return; // winner already chosen
        const canSelect = this.canSelectCallback
            ? this.canSelectCallback(card, idx)
            : this.isMeSubject;
        if (!canSelect) return;
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
            if (typeof Vibrations !== 'undefined' && Vibrations.charge) {
                Vibrations.charge(0);
            }
            const updateCharge = (now) => {
                if (!activeCardEl) return;
                const progress = Math.min(1, (now - startedAt) / this.LONG_PRESS_MS);
                activeCardEl.style.setProperty('--charge-progress', progress.toString());
                if (typeof Vibrations !== 'undefined' && Vibrations.charge) {
                    Vibrations.charge(progress);
                }
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
            const canLongPressSelect = card && (this.canSelectCallback
                ? this.canSelectCallback(card, activeIdx)
                : this.isMeSubject);
            if (canLongPressSelect && isCentered && card && card.drawn && !card.selected) {
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
                if (!gestureCancelled && Math.abs(deltaX) >= this.NAV_SWIPE_THRESHOLD) {
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

            dragging = false;
            if (!wasCentered) {
                this.setFocus(idx);
            }
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