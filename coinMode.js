/**
 * Insight - Coin Mode Engine (JSON-Driven)
 */

// ── GLOBAL STATE ──
let TARGET_QUESTIONS_BY_CATEGORY = {}; // Will be populated from target_questions.json

// Testing control: 0 = never, 1 = current odds, 100 = every flip.
const MATRIX_OVERRIDE_CHANCE_PERCENT = 1;       //0 means turned off, 1 means 1% chance=normal, 100 means every flip is matrix //

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

// Load the dedicated Coin Mode question pool when this engine initializes.
loadCoinQuestions();

let coinState = {
    active: false,
    phase: 'lobby',
    selectedCategory: 'Party',
    subject: '',
    targetPlayer: '',
    question: '',
    chosenSide: null,
    flipResult: null,
    flipCompletionTimer: null,
    nextSubjectOverride: null,
    // ── ANTI-REPETITION STATE (Coin Mode only, isolated from classic mode) ──
    usedQuestionsByCategory: {},
    previousSubject: null,
    sessionInitialized: false
};

// game.js defines leaveRoom later in the document, so install the wrapper only
// after every script has loaded.
document.addEventListener('DOMContentLoaded', () => {
    const originalLeaveRoom = window.leaveRoom;
    if (typeof originalLeaveRoom !== 'function') return;

    window.leaveRoom = function (...args) {
        CoinMode.resetSession();
        return originalLeaveRoom.apply(this, args);
    };
}, { once: true });

// ── NETWORK INTERCEPTOR ──
// NOTE: routing of COIN_* vs regular messages now happens in game.js's
// _routeNetworkMessage (registered with networking.js via onNetworkData).
// A window.handleData-wrapping IIFE used to live here, but script load order
// (this file loads before game.js defines `handleData`, which - as a
// top-level function declaration - overwrites window.handleData) meant that
// wrapper was always silently clobbered and never actually ran. Removed to
// avoid the dead/misleading code; CoinMode.handleNetwork below is still the
// entry point game.js calls directly.

// ── COIN MODE ENGINE ──
const CoinMode = {
    setGameMode(mode) {
        if (net.role !== 'host' || room.phase !== 'lobby') return;
        if (!['classic', 'coin', 'casino', 'openbox'].includes(mode)) {
            if (typeof updateLobbySummary === 'function') updateLobbySummary();
            return;
        }
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        const modeChanged = room.gameMode !== mode;
        if (modeChanged && typeof closeLobbySettings === 'function') closeLobbySettings();
        room.gameMode = mode;
        const roundPicker = document.getElementById('coinRoundPicker');
        const classicControls = document.getElementById('classicOnlyControls');
        if (modeChanged && typeof Sound !== 'undefined' && Sound.draw) Sound.draw();

        if (modeChanged && mode === 'coin') {
            coinState.selectedCategory = 'Party';
            room.coinCategory = 'Party';
            room.maxRounds = 10;
            document.querySelectorAll('.btn-coin-round').forEach(button => button.classList.remove('active'));
            const defaultPill = document.getElementById('coinRoundPill10');
            if (defaultPill) defaultPill.classList.add('active');
        }
        if (modeChanged && mode === 'casino') room.casinoCategory = 'slots';
        if (modeChanged && mode === 'openbox') {
            room.currentCategory = 'classic';
            room.openboxConfig = Openbox.normalizeConfig({
                ...room.openboxConfig,
                category: 'classic'
            });
        }

        if (roundPicker) roundPicker.hidden = mode !== 'coin';
        if (classicControls) classicControls.hidden = mode !== 'classic';
        const roundLimitControls = document.getElementById('roundLimitControls');
        if (roundLimitControls) roundLimitControls.hidden = !['classic', 'openbox'].includes(mode);
        const openboxControls = document.getElementById('openboxOnlyControls');
        if (openboxControls) openboxControls.hidden = mode !== 'openbox';
        const modeSelect = document.getElementById('lobbyModeSelect');
        if (modeSelect) modeSelect.value = mode;
        if (typeof syncRoundLimitSelection === 'function') syncRoundLimitSelection();

        if (typeof updateLobbyUI === 'function') updateLobbyUI();
        else if (typeof updateLobbySummary === 'function') updateLobbySummary();
        if (typeof broadcastLobbySettings === 'function') broadcastLobbySettings();
    },

    setCoinMaxRounds(n, el) {
        room.maxRounds = n;
        document.querySelectorAll('.btn-coin-round').forEach(b => b.classList.remove('active'));
        if (el) el.classList.add('active');
        if (typeof syncRoundLimitSelection === 'function') syncRoundLimitSelection();
        if (typeof Sound !== 'undefined' && Sound.drawRound) Sound.drawRound();
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        if (net.role === 'host') broadcastToAll({ type: 'SYNC_MAX_ROUNDS', maxRounds: n });
        if (typeof updateLobbySummary === 'function') updateLobbySummary();
    },

    selectCategory(catName, btnElem) {
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        if (typeof Sound !== 'undefined' && Sound.draw) Sound.draw();
        coinState.selectedCategory = catName;
        document.querySelectorAll('.btn-cat').forEach(b => {
            b.classList.remove('active');
            b.style.removeProperty('border-color');
            b.style.removeProperty('background');
        });
        if (btnElem) {
            btnElem.classList.add('active');
        }
        room.coinCategory = catName;
        if (typeof updateLobbySummary === 'function') updateLobbySummary();
        if (net.role === 'host') {
            broadcastToAll({ type: 'SYNC_COIN_CATEGORY', category: catName });
        }
    },

    sendAction(payload) {
        if (net.role === 'host') {
            this.handleNetwork(payload, null);
            broadcastToAll(payload);
            return;
        }
        if (!net.conn || !net.conn.open) {
            if (typeof showToast === 'function') showToast('Waiting for the host connection');
            return;
        }
        try {
            net.conn.send(payload);
        } catch (error) {
            console.error('Could not send the Coin Mode action to the host.', error);
            if (typeof showToast === 'function') showToast('Could not reach the host. Try again.');
        }
    },

    triggerBotTurn() {
        if (net.role !== 'host' || !coinState.active || typeof Bots === 'undefined') return;
        const currentSub = coinState.subject;

        if (Bots.isBot(currentSub)) {
            setTimeout(() => {
                if (!coinState.active || coinState.subject !== currentSub) return;
                const target = Bots.chooseOtherPlayer(room.players, currentSub);
                if (!target) return;
                coinState.targetPlayer = target;
                this.sendAction({ type: 'COIN_TARGET_SELECTED', targetPlayer: target });
            }, Bots.decisionDelay());
        }
    },

    triggerBotMatrixTurn() {
        if (net.role !== 'host' || typeof Bots === 'undefined') return;
        const currentSub = coinState.subject;
        if (Bots.isBot(currentSub)) {
            setTimeout(() => {
                if (!coinState.active || coinState.subject !== currentSub) return;
                const side = Bots.chooseSide();
                coinState.chosenSide = side;
                this.sendAction({ type: 'COIN_SIDE_CHOSEN', side: side });
            }, Bots.decisionDelay());
        }
    },

    resetSessionTracking() {
        coinState.usedQuestionsByCategory = {};
        coinState.previousSubject = null;
        coinState.sessionInitialized = true;
    },

    resetSession() {
        clearTimeout(coinState.flipCompletionTimer);
        coinState.flipCompletionTimer = null;
        coinState.active = false;
        coinState.phase = 'lobby';
        coinState.subject = '';
        coinState.targetPlayer = '';
        coinState.question = '';
        coinState.chosenSide = null;
        coinState.flipResult = null;
        coinState.nextSubjectOverride = null;
        coinState.sessionInitialized = false;
        this.resetSessionTracking();
        coinState.sessionInitialized = false;
    },

    drawUnusedQuestion(category) {
        const fullList = TARGET_QUESTIONS_BY_CATEGORY[category] || TARGET_QUESTIONS_BY_CATEGORY["Party"] || [];
        if (!fullList.length) {
            throw new Error(`No Coin Mode questions are available for category "${category}".`);
        }

        if (!coinState.usedQuestionsByCategory[category]) {
            coinState.usedQuestionsByCategory[category] = [];
        }
        const used = coinState.usedQuestionsByCategory[category];

        const remaining = fullList.filter(q => !used.includes(q));

        let chosen;
        if (remaining.length > 0) {
            chosen = remaining[Math.floor(Math.random() * remaining.length)];
        } else {
            console.warn(`[CoinMode] Question pool exhausted for category "${category}" this session; reusing.`);
            chosen = fullList[Math.floor(Math.random() * fullList.length)];
        }

        used.push(chosen);
        return chosen;
    },

    drawNextSubject() {
        room.subjectCounts = room.subjectCounts || {};
        const next = selectFairSubject(room.players, room.subjectCounts, coinState.previousSubject);
        coinState.previousSubject = next;
        return next;
    },

    startRound() {
        if (net.role !== 'host') return;
        if (room.gameMode !== 'coin') return;
        clearTimeout(coinState.flipCompletionTimer);
        coinState.flipCompletionTimer = null;
        if (room.players.length < 3) {
            alert('Need at least 3 players!');
            return;
        }

        if (room.maxRounds !== 'unlimited' && room.roundCount >= room.maxRounds) {
            coinState.active = false;
            coinState.phase = 'gameover';
            broadcastToAll({ type: 'GAME_OVER', scores: room.scores, lateJoiners: room.lateJoiners });
            return;
        }

        if (!Object.keys(TARGET_QUESTIONS_BY_CATEGORY).length) {
            alert('Coin Mode questions are still loading. Please try again in a moment.');
            return;
        }

        room.roundCount++;

        if (!coinState.sessionInitialized) {
            this.resetSessionTracking();
        }

        coinState.active = true;
        coinState.phase = 'side';
        coinState.targetPlayer = '';
        coinState.chosenSide = null;
        coinState.flipResult = null;

        if (coinState.nextSubjectOverride && room.players.includes(coinState.nextSubjectOverride)) {
            coinState.subject = coinState.nextSubjectOverride;
            coinState.nextSubjectOverride = null;
            room.subjectCounts = room.subjectCounts || {};
            room.subjectCounts[coinState.subject] = (room.subjectCounts[coinState.subject] || 0) + 1;
            coinState.previousSubject = coinState.subject;
        } else {
            coinState.subject = this.drawNextSubject();
        }

        if (!coinState.subject) {
            room.roundCount--;
            coinState.active = false;
            coinState.phase = 'lobby';
            return;
        }
        room.currentSubject = coinState.subject;
        coinState.question = this.drawUnusedQuestion(coinState.selectedCategory);

        this.sendAction({
            type: 'COIN_START_ROUND',
            subject: coinState.subject,
            question: coinState.question,
            roundCount: room.roundCount
        });
    },

    getSyncState() {
        return {
            type: 'COIN_SYNC_STATE',
            active: coinState.active,
            phase: coinState.phase,
            selectedCategory: coinState.selectedCategory,
            subject: coinState.subject,
            targetPlayer: coinState.targetPlayer,
            question: coinState.question,
            chosenSide: coinState.chosenSide,
            flipResult: coinState.flipResult,
            roundCount: room.roundCount
        };
    },

    restoreSyncState(data) {
        coinState.active = !!data.active;
        room.gameMode = 'coin';
        coinState.phase = data.phase || 'lobby';
        coinState.selectedCategory = data.selectedCategory || 'Party';
        coinState.subject = data.subject || '';
        coinState.targetPlayer = data.targetPlayer || '';
        coinState.question = data.question || '';
        coinState.chosenSide = data.chosenSide || null;
        coinState.flipResult = data.flipResult || null;
        room.roundCount = data.roundCount ?? room.roundCount;

        if (coinState.phase === 'gameover') {
            executeGameOverUI();
        } else if (!coinState.active || coinState.phase === 'lobby') {
            showScreen('scrLobby');
        } else if (coinState.phase === 'target') {
            this.renderPhase1();
        } else if (coinState.phase === 'side') {
            this.renderPhase2();
        } else if (coinState.phase === 'flip') {
            this.renderPhase3();
        } else if (coinState.phase === 'flipping' || coinState.phase === 'outcome') {
            clearTimeout(coinState.flipCompletionTimer);
            coinState.flipCompletionTimer = null;
            this.renderPhase3();
            if (coinState.flipResult) {
                const angle = coinState.flipResult === 'tails' ? 1980 : coinState.flipResult === 'edge' ? 1890 : 1800;
                if (coinState.phase === 'outcome') {
                    const coin = document.getElementById('neonCoinElem');
                    coin.style.transition = 'none';
                    coin.style.transform = `rotateY(${angle}deg)`;
                    void coin.offsetWidth;
                    coin.style.removeProperty('transition');
                    this.resolveOutcome(coinState.flipResult);
                } else {
                    this.executeFlipAnimation(angle, coinState.flipResult);
                }
            }
        }
    },

    selectTargetPlayer(playerName) {
        if (net.myName !== coinState.subject) return;
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();

        coinState.targetPlayer = playerName;
        if (typeof Sound !== 'undefined') Sound.play(320, 'sine', 0.08);

        document.querySelectorAll('.coin-target-pill').forEach(p => {
            p.classList.toggle('selected', p.dataset.player === playerName);
        });

        const payload = { type: 'COIN_TARGET_SELECTED', targetPlayer: playerName };
        this.sendAction(payload);
    },

    choosePillSide(side) {
        if (net.myName !== coinState.subject) return;
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        coinState.chosenSide = side;

        const payload = { type: 'COIN_SIDE_CHOSEN', side: side };
        this.sendAction(payload);
    },

    triggerCoinFlip() {
        if (coinState.phase !== 'flip' || coinState.chosenSide === null) return;
        const isBotSubject = net.role === 'host' &&
            typeof Bots !== 'undefined' && Bots.isBot(coinState.subject);
        if (net.myName !== coinState.subject && !isBotSubject) return;
        if (typeof Vibrate !== 'undefined' && Vibrate.coinFlip) Vibrate.coinFlip();
        const roll = Math.random() * 100;
        let result = 'heads';
        if (roll < MATRIX_OVERRIDE_CHANCE_PERCENT) result = 'edge';
        else if (roll < 50.5) result = 'heads';
        else result = 'tails';

        let targetAngle = 1800;
        if (result === 'tails') targetAngle += 180;
        else if (result === 'edge') targetAngle += 90;

        const payload = { type: 'COIN_TRIGGER_FLIP', flipResult: result, targetAngle: targetAngle };
        this.sendAction(payload);
    },

    canAcceptNetworkAction(data, playerName) {
        if (!coinState.active || room.gameMode !== 'coin' || playerName !== coinState.subject) return false;

        switch (data.type) {
            case 'COIN_TARGET_SELECTED':
                return coinState.phase === 'target' &&
                    room.players.includes(data.targetPlayer) && data.targetPlayer !== coinState.subject;
            case 'COIN_SIDE_CHOSEN':
                return coinState.phase === 'side' && (data.side === 'heads' || data.side === 'tails');
            case 'COIN_TRIGGER_FLIP':
                return coinState.phase === 'flip' && coinState.chosenSide !== null &&
                    ((data.flipResult === 'heads' && data.targetAngle === 1800) ||
                    (data.flipResult === 'tails' && data.targetAngle === 1980) ||
                    (data.flipResult === 'edge' && data.targetAngle === 1890));
            case 'COIN_SET_NEXT_SUBJECT':
                return coinState.phase === 'outcome' && coinState.flipResult === 'edge' &&
                    (data.nextSubject === null ||
                    (room.players.includes(data.nextSubject) && data.nextSubject !== coinState.subject));
            default:
                return false;
        }
    },

    handleNetwork(data, connection) {
        if (!data || typeof data.type !== 'string') return;
        if (net.role === 'client' && connection && connection !== net.conn) return;

        if (data.type === 'COIN_SYNC_STATE' && net.role === 'client') {
            this.restoreSyncState(data);
            return;
        }

        if (net.role === 'host' && connection) {
            const player = connection._playerId && net.roster[connection._playerId];
            if (!player || player.conn !== connection || !player.connected ||
                !this.canAcceptNetworkAction(data, player.label)) return;
        }

        switch (data.type) {
            case 'COIN_START_ROUND':
                coinState.active = true;
                coinState.phase = 'side';
                coinState.subject = data.subject;
                coinState.question = data.question;
                if (data.roundCount) room.roundCount = data.roundCount;
                this.renderPhase2();
                this.triggerBotMatrixTurn();
                break;

            case 'COIN_TARGET_SELECTED':
                coinState.targetPlayer = data.targetPlayer;
                coinState.phase = 'flip';
                this.renderPhase3();
                this.scheduleAutomaticFlip();
                break;

            case 'COIN_SIDE_CHOSEN':
                coinState.chosenSide = data.side;
                coinState.phase = 'target';
                this.renderPhase1();
                this.triggerBotTurn();
                break;

            case 'COIN_TRIGGER_FLIP':
                coinState.phase = 'flipping';
                coinState.flipResult = data.flipResult;
                this.executeFlipAnimation(data.targetAngle, data.flipResult);
                break;

            case 'COIN_SET_NEXT_SUBJECT':
                coinState.nextSubjectOverride = data.nextSubject;
                document.getElementById('coinEasterEggModal').classList.remove('active');
                break;
        }

        // Client-originated actions are applied by the host first, then relayed to
        // the other peers so every participant advances through the same phase.
        if (net.role === 'host' && connection) broadcastToConnections(data);
    },

    renderPhase1() {
        const isSubject = (net.myName === coinState.subject);
        document.getElementById('coinEasterEggModal').classList.remove('active');
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
                pill.onclick = () => Buttons.coinTarget(p);
                grid.appendChild(pill);
            });
        } else {
            document.getElementById('coinWaitSubjectName').innerText = coinState.subject;
            document.getElementById('coinWaitTargetLabel').innerText = 'Waiting for target selection...';
        }
        if (typeof showScreen === 'function') showScreen('scrCoinPhase1');
        if (window.Phone) Phone.openCoinApp('target');
    },

    renderPhase2() {
        const isSubject = (net.myName === coinState.subject);
        document.getElementById('coinMatrixSubjectControls').style.display = isSubject ? 'block' : 'none';
        document.getElementById('coinMatrixWaitNotice').style.display = isSubject ? 'none' : 'block';
        if (!isSubject) {
            document.getElementById('coinMatrixWaitNotice').innerText = `${coinState.subject} is choosing a secret side...`;
        }
        if (typeof showScreen === 'function') showScreen('scrCoinPhase2');
        if (window.Phone) Phone.openCoinApp('side');
    },

    renderPhase3() {
        const coin = document.getElementById('neonCoinElem');
        const tapPrompt = document.getElementById('coinTapInstruction');
        const rim = document.getElementById('coinRim');
        if (rim && rim.childElementCount === 0) {
            const segments = document.createDocumentFragment();
            for (let index = 0; index < 40; index++) {
                const segment = document.createElement('span');
                segment.className = 'coin-rim-segment';
                segment.style.transform =
                    `rotateZ(${index * 9}deg) translateY(calc(0px - var(--coin-rim-radius, 63px))) rotateX(90deg)`;
                segments.appendChild(segment);
            }
            rim.appendChild(segments);
        }
        if (coinState.phase !== 'flipping' && coinState.phase !== 'outcome') {
            coin.style.transition = 'none';
            coin.style.transform = 'rotateY(0deg)';
            void coin.offsetWidth;
            coin.style.removeProperty('transition');
            coin.classList.remove('edge-landing');
            document.getElementById('coinOutcomeBanner').style.display = 'none';
            document.getElementById('coinRevealedQuestionCard').style.display = 'none';
            document.getElementById('coinNextRoundBtn').style.display = 'none';
        }

        tapPrompt.innerText = 'THE COIN IS ABOUT TO FLIP...';
        coin.style.pointerEvents = 'none';
        coin.onclick = null;
        if (typeof showScreen === 'function') showScreen('scrCoinStage');
        if (window.Phone) {
            Phone.openCoinApp('flip');
            if (coinState.targetPlayer) {
                Phone.notify(`${coinState.targetPlayer} was chosen. Watch the flip.`, true);
            }
        }
    },

    scheduleAutomaticFlip() {
        const isBotSubject = net.role === 'host' &&
            typeof Bots !== 'undefined' && Bots.isBot(coinState.subject);
        if (net.myName !== coinState.subject && !isBotSubject) return;
        const subject = coinState.subject;
        setTimeout(() => {
            if (coinState.active && coinState.phase === 'flip' &&
                coinState.subject === subject) this.triggerCoinFlip();
        }, 520);
    },

    executeFlipAnimation(targetAngle, result) {
        clearTimeout(coinState.flipCompletionTimer);
        const coin = document.getElementById('neonCoinElem');
        coin.style.pointerEvents = 'none';
        document.getElementById('coinTapInstruction').innerText = "Flipping...";
        coin.style.transform = `rotateY(${targetAngle}deg)`;

        coinState.flipCompletionTimer = setTimeout(() => {
            coinState.flipCompletionTimer = null;
            if (coinState.phase !== 'flipping' || coinState.flipResult !== result) return;
            coinState.flipResult = result;
            coinState.phase = 'outcome';
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

            if (net.myName === coinState.subject && coinState.flipResult === 'edge') {
                setTimeout(() => {
                    const modal = document.getElementById('coinEasterEggModal');
                    if (coinState.flipResult === 'edge' && !modal.classList.contains('active')) {
                        this.openEasterEggModal();
                    }
                }, 1000);
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
            card.innerText = `${coinState.subject} said about ${coinState.targetPlayer}:\n\n"${coinState.question}"`;
        }

        if (net.role === 'host') {
            nextBtn.style.display = 'block';
            nextBtn.onclick = () => Buttons.coinNextRound();
        } else {
            nextBtn.style.display = 'none';
        }
    },

    openEasterEggModal() {
        const grid = document.getElementById('coinEasterEggPlayerGrid');
        grid.innerHTML = '';
        room.players.forEach(p => {
            if (p === coinState.subject) return;
            const btn = document.createElement('button');
            btn.className = 'btn-secondary';
            btn.style.margin = '4px';
            btn.innerText = p;
            btn.onclick = () => Buttons.coinOverrideSubject(p);
            grid.appendChild(btn);
        });
        const randomBtn = document.createElement('button');
        randomBtn.className = 'btn-main';
        randomBtn.style.margin = '4px';
        randomBtn.innerText = 'Random Subject';
        randomBtn.onclick = () => Buttons.coinOverrideSubject(null);
        grid.appendChild(randomBtn);
        document.getElementById('coinEasterEggModal').classList.add('active');
    }
};