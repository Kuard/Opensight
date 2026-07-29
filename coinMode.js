/**
 * Insight - Coin Mode Engine (JSON-Driven)
 */

// ── GLOBAL STATE ──
let TARGET_QUESTIONS_BY_CATEGORY = {}; // Will be populated from target_questions.json

// Async function to load your dedicated Coin Mode question database
async function loadCoinQuestions() {
    try {
        const response = await fetch('target_questions.json');
        if (!response.ok) throw new Error('Failed to load target_questions.json');
        TARGET_QUESTIONS_BY_CATEGORY = await response.json();
        console.log("Coin Mode: Successfully loaded target_questions.json!");
    } catch (error) {
        console.error("Error loading target_questions.json, falling back to defaults:", error);
        // Fallback safety net if the fetch fails
        TARGET_QUESTIONS_BY_CATEGORY = {
            "Party": ["Who here would be the absolute first person to die in a horror movie scenario?"]
        };
    }
}

// Automatically trigger the load when coin.js initializes
loadCoinQuestions();

let coinState = {
    active: false,
    selectedCategory: 'Party',
    subject: '',
    targetPlayer: '',
    question: '',
    chosenSide: null,
    flipResult: null,
    nextSubjectOverride: null,
    gameMode: 'classic',

    // ── ANTI-REPETITION STATE (Coin Mode only, isolated from classic mode) ──
    // Tracks which questions have already been drawn this game session, keyed
    // by category, so the same question can never appear twice in one game.
    usedQuestionsByCategory: {},
    // Tracks the subject/"reader" from the previous round so the same player
    // can never be picked two rounds in a row.
    previousSubject: null,
    // True once a Coin Mode session has begun, so the tracking state above
    // can be reset exactly once per new game rather than on every round.
    sessionInitialized: false
};

fetch('target_questions.json')
    .then(res => res.json())
    .then(data => {
        if (Array.isArray(data)) {
            TARGET_QUESTIONS_BY_CATEGORY["Party"] = data.map(q => typeof q === 'string' ? q : q.question);
        }
    })
    .catch(() => {});

// ── AUTO-INJECT UI ──
function injectCoinModeUI() {
    const appContainer = document.querySelector('.app-container') || document.body;
    const hostControls = document.getElementById('hostOnlyControls') || appContainer;
    
    // 1. Compact Mode Widget (No Bot Button)
    if (!document.getElementById('modeSelectionContainer')) {
        const compactModeHTML = `
        <div id="modeSelectionContainer" style="margin: 8px 0; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <div class="section-title" style="font-size: 11px; margin-bottom: 10px; color: rgba(255,255,255,0.5); letter-spacing: 1px; text-align: center;">GAME MODE</div>
            
            <div style="display: flex; gap: 6px;">
                <button type="button" class="btn-secondary active" id="btnModeClassic" onclick="CoinMode.setGameMode('classic')" style="flex: 1; padding: 8px 4px; font-size: 13px; border-color: var(--neon-pink, #ff0055);">Classic</button>
                <button type="button" class="btn-secondary" id="btnModeCoin" onclick="CoinMode.setGameMode('coin')" style="flex: 1; padding: 8px 4px; font-size: 13px; border-color: var(--neon-cyan, #00f0ff);">⚡ Coin Mode</button>
            </div>

            <!-- COMPACT CATEGORY PICKER & START BUTTON FOR COIN MODE -->
            <div id="coinCategoryPicker" style="display: none; margin-top: 10px;">
                <div style="display: flex; gap: 4px; margin-bottom: 10px;">
                    <button type="button" class="btn-secondary btn-cat active" onclick="CoinMode.selectCategory('Party', this)" style="flex: 1; padding: 6px 2px; font-size: 11px;">Party</button>
                    <button type="button" class="btn-secondary btn-cat" onclick="CoinMode.selectCategory('Spicy', this)" style="flex: 1; padding: 6px 2px; font-size: 11px;">Spicy</button>
                    <button type="button" class="btn-secondary btn-cat" onclick="CoinMode.selectCategory('Deep', this)" style="flex: 1; padding: 6px 2px; font-size: 11px;">Deep</button>
                </div>
                <button type="button" class="btn-main" onclick="CoinMode.startRound()" style="width: 100%; padding: 10px; font-size: 14px;"> Start Coin Round</button>
            </div>
        </div>
        `;
        hostControls.insertAdjacentHTML('afterbegin', compactModeHTML);
    }

    // 2. Inject Screens
    if (!document.getElementById('scrCoinPhase1')) {
        const screensHTML = `
        <!-- PHASE 1: TARGET SELECTION & FIDGETS -->
        <div class="screen" id="scrCoinPhase1">
            <div class="lobby-header">
                <div class="circle-btn" style="opacity:0;"></div>
                <div class="brand-title" style="color:var(--neon-cyan, #00f0ff);">COIN MODE</div>
                <div class="circle-btn" onclick="triggerLeaveConfirmation && triggerLeaveConfirmation()">✕</div>
            </div>

            <div id="coinSubjectSelectionBox" style="display:none; width:100%;">
                <div class="brand-subtitle" style="text-align:center;">Read scenario & pick a target player:</div>
                <div class="prompt-box" style="margin: 12px 0;"><div class="prompt-text" id="coinPromptDisplay">...</div></div>
                <div class="section-title">Select Target Player</div>
                <div id="coinTargetPlayerGrid" class="deck-grid" style="grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 15px;"></div>
                
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <button class="btn-main" id="coinContinueBtn" style="display:none; padding: 10px; font-size: 13px;" onclick="CoinMode.advanceToMatrixPhase()">
                        I Spoke My Answer Out Loud (Continue)
                    </button>
                    
                    <button class="btn-secondary" id="coinSilentBroadcastBtn" style="display:none; padding: 8px; font-size: 12px; border-color: var(--neon-cyan, #00f0ff); color: var(--neon-cyan, #00f0ff);" onclick="CoinMode.broadcastSilentAnswer()">
                        🔇 Muted: Show Choice on Screen
                    </button>
                </div>
            </div>

            <div id="coinNonSubjectWaitingBox" style="display:none; width:100%;">
                <div class="brand-subtitle" style="text-align:center;"><span id="coinWaitSubjectName">Subject</span> is picking a target...</div>
                <div class="sub-track" id="coinWaitTargetLabel" style="text-align:center; color: var(--neon-pink, #ff0055); margin: 10px 0; font-weight:700;">Waiting...</div>
                
                <div class="fidget-board coin-fidget-board">
                    <div class="fidget-toy">
                        <div class="clicker-btn" id="coinToyClicker" onclick="CoinMode.handleFidgetClick(this)">0</div>
                    </div>
                    <div class="fidget-toy">
                        <div class="switch-track" id="coinToyToggle" onclick="CoinMode.handleFidgetToggle(this)">
                            <div class="switch-handle"></div>
                        </div>
                    </div>
                    <div class="fidget-toy coin-fidget-toy-wide">
                        <div class="bubble-grid" id="coinToyBubbleGrid"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- PHASE 2: MATRIX CHOICE -->
        <div class="screen" id="scrCoinPhase2" style="justify-content: center;">
            <div class="brand-header" style="text-align: center; margin-bottom: 15px;">
                <div class="brand-title" style="color:var(--neon-cyan, #00f0ff);">MATRIX CHOICE</div>
                <div class="brand-subtitle">Choose your side to keep it secret</div>
            </div>
            <div id="coinMatrixSubjectControls" style="display:none; width:100%;">
                <div class="pill-container">
                    <button class="matrix-pill red" onclick="CoinMode.choosePillSide('heads')">
                        <div class="pill-title">RED PILL</div>
                        <div class="pill-sub">HEADS</div>
                    </button>
                    <button class="matrix-pill blue" onclick="CoinMode.choosePillSide('tails')">
                        <div class="pill-title">BLUE PILL</div>
                        <div class="pill-sub">TAILS</div>
                    </button>
                </div>
            </div>
            <div id="coinMatrixWaitNotice" class="sub-track" style="display:none; text-align:center; color: var(--neon-pink, #ff0055);">Waiting...</div>
        </div>

        <!-- PHASE 3: COIN FLIP STAGE -->
        <div class="screen" id="scrCoinStage">
            <div class="lobby-header">
                <div class="circle-btn" style="opacity:0;"></div>
                <div class="brand-title" style="color:var(--neon-cyan, #00f0ff);">THE FLIP</div>
                <div class="circle-btn" onclick="triggerLeaveConfirmation && triggerLeaveConfirmation()">✕</div>
            </div>
            <div class="brand-subtitle" id="coinTapInstruction" style="text-align:center; margin-bottom: 10px;">TAP COIN TO FLIP</div>
            <div class="coin-stage">
                <div class="neon-coin" id="neonCoinElem">
                    <div class="coin-face coin-front">HEADS</div>
                    <div class="coin-face coin-back">TAILS</div>
                </div>
            </div>
            <div class="coin-outcome-banner" id="coinOutcomeBanner" style="display:none;"></div>
            <div class="prompt-box" id="coinRevealedQuestionCard" style="display:none; margin-top:15px;">...</div>
            <button class="btn-main" id="coinNextRoundBtn" style="display:none; margin-top:auto;">Next Coin Round</button>
        </div>
        `;

        appContainer.insertAdjacentHTML('beforeend', screensHTML);
    }

    // 3. Inject Modals directly onto <body>, NOT inside .app-container.
    // .app-container has `filter: saturate(...) contrast(...)`, and any
    // non-none CSS filter creates a new containing block for descendants
    // that use position:fixed. That traps these modals inside the narrow
    // 420px app column instead of letting them center on the real
    // viewport, which is exactly the off-center/non-fullscreen bug.
    if (!document.getElementById('coinSilentBroadcastModal')) {
        const modalsHTML = `
        <!-- SILENT BROADCAST MODAL OVERLAY -->
        <div class="modal-overlay" id="coinSilentBroadcastModal">
            <div class="modal-card">
                <div class="modal-title" style="color: var(--neon-cyan, #00f0ff);"> ANSWER REVEALED</div>
                <div id="coinSilentModalContent" style="margin: 15px 0; font-size: 15px; font-weight: 600; text-align: center;"></div>
                <button class="btn-main" style="padding: 10px;" onclick="document.getElementById('coinSilentBroadcastModal').classList.remove('active')">Got it!</button>
            </div>
        </div>

        <!-- EASTER EGG MODAL -->
        <div class="modal-overlay" id="coinEasterEggModal">
            <div class="modal-card" style="border-color: #ffd700; box-shadow: 0 0 30px rgba(255, 215, 0, 0.4);">
                <div class="modal-title" style="color: #ffd700;"> MATRIX OVERRIDE </div>
                <div class="modal-desc">The coin landed on its edge! Choose who becomes the next Subject.</div>
                <div id="coinEasterEggPlayerGrid" style="display:flex; flex-wrap:wrap; justify-content:center; margin-top:15px;"></div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalsHTML);
    }
}

// ── SESSION LIFECYCLE HOOK ──
// Wraps the existing leaveRoom() from game.js (untouched) purely so that
// Coin Mode's anti-repetition tracking (used questions + previous subject)
// is cleared whenever a room is left, ensuring the *next* game session
// starts with a fully fresh pool/reader history instead of carrying over
// state from a prior match. Classic mode logic is not modified in any way.
(function hookLeaveRoomForCoinReset() {
    const originalLeaveRoom = window.leaveRoom;
    if (typeof originalLeaveRoom === 'function') {
        window.leaveRoom = function (...args) {
            coinState.sessionInitialized = false;
            coinState.usedQuestionsByCategory = {};
            coinState.previousSubject = null;
            return originalLeaveRoom.apply(this, args);
        };
    }
})();

// ── NETWORK INTERCEPTOR ──
(function hookNetwork() {
    const originalHandleData = window.handleData;
    window.handleData = function (data, connection) {
        if (data && data.type && data.type.startsWith('COIN_')) {
            CoinMode.handleNetwork(data, connection);
        } else if (typeof originalHandleData === 'function') {
            originalHandleData(data, connection);
        }
    };
})();

// ── COIN MODE ENGINE ──
const CoinMode = {
    clickCount: 0,

    setGameMode(mode) {
        coinState.gameMode = mode;
        const btnClassic = document.getElementById('btnModeClassic');
        const btnCoin = document.getElementById('btnModeCoin');
        const catPicker = document.getElementById('coinCategoryPicker');
        const hostControls = document.getElementById('hostOnlyControls');

        const isCoin = (mode === 'coin');

        btnCoin.style.background = isCoin ? 'rgba(0, 240, 255, 0.2)' : 'transparent';
        btnClassic.style.background = isCoin ? 'transparent' : 'rgba(255, 0, 85, 0.2)';
        if (catPicker) catPicker.style.display = isCoin ? 'block' : 'none';

        // Toggle classic host controls purely via a CSS class rather than
        // caching/restoring each child's inline display value. Caching is
        // fragile (a child's "original" display can itself have been ''
        // instead of the CSS default, e.g. grid/flex containers), and stray
        // leftover inline styles from other flows can leave blank/black
        // blocks behind that still occupy layout space and intercept clicks.
        if (hostControls) {
            hostControls.classList.toggle('coin-mode-active', isCoin);
        }
    },

    selectCategory(catName, btnElem) {
        coinState.selectedCategory = catName;
        document.querySelectorAll('.btn-cat').forEach(b => {
            b.style.borderColor = 'rgba(255,255,255,0.2)';
            b.style.background = 'transparent';
        });
        if (btnElem) {
            btnElem.style.borderColor = 'var(--neon-cyan, #00f0ff)';
            btnElem.style.background = 'rgba(0, 240, 255, 0.15)';
        }
    },

    // Bot Handlers (Hooks into existing bots)
    triggerBotTurn() {
        if (!coinState.active) return;
        const currentSub = coinState.subject;

        if (currentSub && currentSub.toLowerCase().includes('bot')) {
            setTimeout(() => {
                const candidates = room.players.filter(p => p !== currentSub);
                const target = candidates[Math.floor(Math.random() * candidates.length)];
                coinState.targetPlayer = target;
                
                broadcastToAll({ type: 'COIN_TARGET_SELECTED', targetPlayer: target });
                
                setTimeout(() => {
                    broadcastToAll({ type: 'COIN_ADVANCE_MATRIX' });
                }, 1500);
            }, 1200);
        }
    },

    triggerBotMatrixTurn() {
        const currentSub = coinState.subject;
        if (currentSub && currentSub.toLowerCase().includes('bot')) {
            setTimeout(() => {
                const side = Math.random() > 0.5 ? 'heads' : 'tails';
                coinState.chosenSide = side;
                broadcastToAll({ type: 'COIN_SIDE_CHOSEN', side: side });

                setTimeout(() => {
                    this.triggerCoinFlip();
                }, 1200);
            }, 1200);
        }
    },

    // Resets the per-session anti-repetition trackers. Called exactly once
    // when a brand-new Coin Mode game begins (host side only — the host is
    // authoritative for question/subject selection and broadcasts the
    // result, so clients never need to run this logic themselves).
    resetSessionTracking() {
        coinState.usedQuestionsByCategory = {};
        coinState.previousSubject = null;
        coinState.sessionInitialized = true;
    },

    // Draws a question for the given category that has not yet been used
    // this game session, and marks it as used. Falls back gracefully (with
    // a console warning) if a category's pool is ever exhausted, rather than
    // throwing — this can't realistically happen with 50 questions and a
    // 20/30 round cap, but it keeps Coin Mode from breaking if it does.
    drawUnusedQuestion(category) {
        const fullList = TARGET_QUESTIONS_BY_CATEGORY[category] || TARGET_QUESTIONS_BY_CATEGORY["Party"];

        if (!coinState.usedQuestionsByCategory[category]) {
            coinState.usedQuestionsByCategory[category] = [];
        }
        const used = coinState.usedQuestionsByCategory[category];

        const remaining = fullList.filter(q => !used.includes(q));

        let chosen;
        if (remaining.length > 0) {
            chosen = remaining[Math.floor(Math.random() * remaining.length)];
        } else {
            // Pool exhausted for this category this game — should not happen
            // given 50 questions per category vs. a 20/30 round cap, but
            // fall back to the full list rather than crashing the round.
            console.warn(`[CoinMode] Question pool exhausted for category "${category}" this session; reusing.`);
            chosen = fullList[Math.floor(Math.random() * fullList.length)];
        }

        used.push(chosen);
        return chosen;
    },

    // Picks the next subject/"reader" at random from all eligible players,
    // guaranteeing the same player is never picked two rounds in a row.
    // If only one player is available (edge case), that player is reused
    // since there is no valid alternative.
    drawNextSubject() {
        const previous = coinState.previousSubject;
        let eligible = room.players.filter(p => p !== previous);

        if (eligible.length === 0) {
            eligible = room.players.slice();
        }

        const next = eligible[Math.floor(Math.random() * eligible.length)] || room.players[0];
        coinState.previousSubject = next;
        return next;
    },

    startRound() {
        if (coinState.gameMode !== 'coin') return;

        // Begin a fresh anti-repetition session the first time Coin Mode is
        // started for this game. Left untouched on subsequent rounds so
        // used-question and previous-subject history persists for the
        // remainder of the session, as intended.
        if (!coinState.sessionInitialized) {
            this.resetSessionTracking();
        }

        coinState.active = true;
        coinState.targetPlayer = '';
        coinState.chosenSide = null;
        coinState.flipResult = null;

        if (coinState.nextSubjectOverride && room.players.includes(coinState.nextSubjectOverride)) {
            coinState.subject = coinState.nextSubjectOverride;
            coinState.nextSubjectOverride = null;
            coinState.previousSubject = coinState.subject;
        } else {
            coinState.subject = this.drawNextSubject();
        }

        room.currentSubject = coinState.subject;
        coinState.question = this.drawUnusedQuestion(coinState.selectedCategory);

        broadcastToAll({
            type: 'COIN_START_ROUND',
            subject: coinState.subject,
            question: coinState.question
        });
    },

    selectTargetPlayer(playerName) {
        if (net.myName !== coinState.subject) return;

        coinState.targetPlayer = playerName;
        if (typeof Sound !== 'undefined') Sound.play(320, 'sine', 0.08);

        document.querySelectorAll('.coin-target-pill').forEach(p => {
            p.classList.toggle('selected', p.dataset.player === playerName);
        });

        const payload = { type: 'COIN_TARGET_SELECTED', targetPlayer: playerName };
        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);

        const continueBtn = document.getElementById('coinContinueBtn');
        const silentBtn = document.getElementById('coinSilentBroadcastBtn');

        continueBtn.style.display = 'none';
        silentBtn.style.display = 'none';

        setTimeout(() => {
            continueBtn.style.display = 'block';
            silentBtn.style.display = 'block';
            if (typeof Sound !== 'undefined') Sound.play(500, 'triangle', 0.1);
        }, 2000);
    },

    broadcastSilentAnswer() {
        if (!coinState.targetPlayer) return;

        const payload = {
            type: 'COIN_SILENT_BROADCAST',
            subject: coinState.subject,
            targetPlayer: coinState.targetPlayer,
            question: coinState.question
        };

        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);

        this.advanceToMatrixPhase();
    },

    advanceToMatrixPhase() {
        const payload = { type: 'COIN_ADVANCE_MATRIX' };
        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);
    },

    choosePillSide(side) {
        if (net.myName !== coinState.subject) return;
        coinState.chosenSide = side;

        const payload = { type: 'COIN_SIDE_CHOSEN', side: side };
        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);
    },

    triggerCoinFlip() {
        const roll = Math.random() * 100;
        let result = 'heads';
        if (roll < 1.0) result = 'edge';
        else if (roll < 50.5) result = 'heads';
        else result = 'tails';

        let targetAngle = 1800;
        if (result === 'tails') targetAngle += 180;
        else if (result === 'edge') targetAngle += 90;

        const payload = { type: 'COIN_TRIGGER_FLIP', flipResult: result, targetAngle: targetAngle };
        if (net.role === 'host') broadcastToAll(payload);
        else if (net.conn) net.conn.send(payload);
    },

    handleFidgetClick(elem) {
        this.clickCount++;
        elem.innerText = this.clickCount;
        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(400 + (this.clickCount % 10) * 20, 'triangle', 0.05);
        if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
    },

    handleFidgetToggle(elem) {
        elem.classList.toggle('on');
        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(150, 'sine', 0.05);
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
    },

    setupFidgetBubbles() {
        const grid = document.getElementById('coinToyBubbleGrid');
        if (!grid) return;
        grid.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const b = document.createElement('div');
            b.className = 'bubble';
            b.onclick = () => {
                if (b.classList.contains('popped')) return;
                b.classList.add('popped');
                if (typeof Sound !== 'undefined' && Sound.play) Sound.play(600, 'sine', 0.02);
                if (typeof Vibrate !== 'undefined' && Vibrate.pop) Vibrate.pop();
                setTimeout(() => b.classList.remove('popped'), 3000);
            };
            grid.appendChild(b);
        }
    },

    handleNetwork(data) {
        switch (data.type) {
            case 'COIN_START_ROUND':
                coinState.subject = data.subject;
                coinState.question = data.question;
                this.renderPhase1();
                this.triggerBotTurn();
                break;

            case 'COIN_TARGET_SELECTED':
                coinState.targetPlayer = data.targetPlayer;
                if (net.myName !== coinState.subject) {
                    document.getElementById('coinWaitTargetLabel').innerText = `${coinState.subject} picked ${data.targetPlayer}!`;
                }
                break;

            case 'COIN_SILENT_BROADCAST':
                const modal = document.getElementById('coinSilentBroadcastModal');
                const content = document.getElementById('coinSilentModalContent');
                content.innerText = ` ${data.subject} selected ${data.targetPlayer} for prompt:\n\n"${data.question}"`;
                modal.classList.add('active');
                break;

            case 'COIN_ADVANCE_MATRIX':
                this.renderPhase2();
                this.triggerBotMatrixTurn();
                break;

            case 'COIN_SIDE_CHOSEN':
                coinState.chosenSide = data.side;
                this.renderPhase3();
                break;

            case 'COIN_TRIGGER_FLIP':
                this.executeFlipAnimation(data.targetAngle, data.flipResult);
                break;

            case 'COIN_SET_NEXT_SUBJECT':
                coinState.nextSubjectOverride = data.nextSubject;
                document.getElementById('coinEasterEggModal').classList.remove('active');
                break;
        }
    },

    renderPhase1() {
        const isSubject = (net.myName === coinState.subject);
        document.getElementById('coinSubjectSelectionBox').style.display = isSubject ? 'block' : 'none';
        document.getElementById('coinNonSubjectWaitingBox').style.display = isSubject ? 'none' : 'block';

        if (isSubject) {
            document.getElementById('coinPromptDisplay').innerText = coinState.question;
            const grid = document.getElementById('coinTargetPlayerGrid');
            grid.innerHTML = '';
            room.players.forEach(p => {
                if (p === coinState.subject) return;
                const pill = document.createElement('div');
                pill.className = 'player-pill coin-target-pill';
                pill.dataset.player = p;
                pill.innerText = p;
                pill.onclick = () => this.selectTargetPlayer(p);
                grid.appendChild(pill);
            });
            document.getElementById('coinContinueBtn').style.display = 'none';
            document.getElementById('coinSilentBroadcastBtn').style.display = 'none';
        } else {
            document.getElementById('coinWaitSubjectName').innerText = coinState.subject;
            document.getElementById('coinWaitTargetLabel').innerText = "Waiting for selection...";

            this.clickCount = 0;
            const clicker = document.getElementById('coinToyClicker');
            if (clicker) clicker.innerText = '0';
            const toggle = document.getElementById('coinToyToggle');
            if (toggle) toggle.classList.remove('on');
            this.setupFidgetBubbles();
        }
        if (typeof showScreen === 'function') showScreen('scrCoinPhase1');
    },

    renderPhase2() {
        const isSubject = (net.myName === coinState.subject);
        document.getElementById('coinMatrixSubjectControls').style.display = isSubject ? 'block' : 'none';
        document.getElementById('coinMatrixWaitNotice').style.display = isSubject ? 'none' : 'block';
        if (!isSubject) {
            document.getElementById('coinMatrixWaitNotice').innerText = `${coinState.subject} is choosing Red or Blue Pill...`;
        }
        if (typeof showScreen === 'function') showScreen('scrCoinPhase2');
    },

    renderPhase3() {
        const coin = document.getElementById('neonCoinElem');
        const tapPrompt = document.getElementById('coinTapInstruction');
        coin.style.transform = 'rotateY(0deg)';
        coin.classList.remove('edge-landing');
        document.getElementById('coinOutcomeBanner').style.display = 'none';
        document.getElementById('coinRevealedQuestionCard').style.display = 'none';

        const isSubject = (net.myName === coinState.subject);
        if (isSubject) {
            tapPrompt.innerText = "TAP THE COIN TO FLIP!";
            coin.style.pointerEvents = 'auto';
            coin.onclick = () => this.triggerCoinFlip();
        } else {
            tapPrompt.innerText = `Waiting for ${coinState.subject} to flip...`;
            coin.style.pointerEvents = 'none';
            coin.onclick = null;
        }
        if (typeof showScreen === 'function') showScreen('scrCoinStage');
    },

    executeFlipAnimation(targetAngle, result) {
        const coin = document.getElementById('neonCoinElem');
        coin.style.pointerEvents = 'none';
        document.getElementById('coinTapInstruction').innerText = "Flipping...";
        coin.style.transform = `rotateY(${targetAngle}deg)`;

        setTimeout(() => {
            coinState.flipResult = result;
            this.resolveOutcome(result);
        }, 3100);
    },

    resolveOutcome(result) {
        const banner = document.getElementById('coinOutcomeBanner');
        const card = document.getElementById('coinRevealedQuestionCard');
        const nextBtn = document.getElementById('coinNextRoundBtn');

        document.getElementById('coinTapInstruction').innerText = "";
        banner.style.display = 'block';

        const safe = (result === coinState.chosenSide);

        if (result === 'edge') {
            document.getElementById('neonCoinElem').classList.add('edge-landing');
            banner.className = 'coin-outcome-banner golden';
            banner.innerText = '1% MATRIX ANOMALY! EDGE LANDING!';
            card.style.display = 'block';
            card.innerText = ` SECRET PROTECTED BY THE MATRIX!`;

            if (net.myName === coinState.subject) {
                setTimeout(() => this.openEasterEggModal(), 1000);
            }
        } else if (safe) {
            banner.className = 'coin-outcome-banner safe';
            banner.innerText = 'SECRET SAFE!';
            card.style.display = 'block';
            card.innerText = ` Question remains hidden from the room!`;
        } else {
            banner.className = 'coin-outcome-banner busted';
            banner.innerText = 'REVEALED!';
            card.style.display = 'block';
            card.innerText = `‼️ ${coinState.subject} said about ${coinState.targetPlayer}:\n\n"${coinState.question}"`;
        }

        if (net.role === 'host') {
            nextBtn.style.display = 'block';
            nextBtn.onclick = () => CoinMode.startRound();
        } else {
            nextBtn.style.display = 'none';
        }
    },

    openEasterEggModal() {
        const grid = document.getElementById('coinEasterEggPlayerGrid');
        grid.innerHTML = '';
        room.players.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn-secondary';
            btn.style.margin = '4px';
            btn.innerText = p;
            btn.onclick = () => {
                const payload = { type: 'COIN_SET_NEXT_SUBJECT', nextSubject: p };
                if (net.role === 'host') window.handleData(payload, null);
                else net.conn.send(payload);
            };
            grid.appendChild(btn);
        });
        document.getElementById('coinEasterEggModal').classList.add('active');
    }
};

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCoinModeUI);
} else {
    injectCoinModeUI();
}