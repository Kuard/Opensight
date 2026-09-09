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
    usedQuestionsByCategory: {},
    previousSubject: null,
    sessionInitialized: false,
    roundsInitialized: false
};

// ── SESSION LIFECYCLE HOOK ──
(function hookLeaveRoomForCoinReset() {
    const originalLeaveRoom = window.leaveRoom;
    if (typeof originalLeaveRoom === 'function') {
        window.leaveRoom = function (...args) {
            coinState.sessionInitialized = false;
            coinState.usedQuestionsByCategory = {};
            coinState.previousSubject = null;
            coinState.roundsInitialized = false;
            return originalLeaveRoom.apply(this, args);
        };
    }
})();

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
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        room.gameMode = mode; // Integrate with global room state
        const btnClassic = document.getElementById('btnModeClassic');
        const btnCoin = document.getElementById('btnModeCoin');
        const catPicker = document.getElementById('coinCategoryPicker');
        const roundPicker = document.getElementById('coinRoundPicker');
        const classicControls = document.getElementById('classicOnlyControls');
        const hostControls = document.getElementById('hostOnlyControls');

        const isCoin = (mode === 'coin');

        if (btnCoin) btnCoin.style.background = isCoin ? 'rgba(0, 240, 255, 0.2)' : 'transparent';
        if (btnClassic) btnClassic.style.background = isCoin ? 'transparent' : 'rgba(255, 0, 85, 0.2)';
        if (catPicker) catPicker.style.display = isCoin ? 'block' : 'none';
        if (roundPicker) roundPicker.style.display = isCoin ? 'block' : 'none';
        if (classicControls) classicControls.style.display = isCoin ? 'none' : 'block';

        if (hostControls) {
            hostControls.classList.toggle('coin-mode-active', isCoin);
        }

        // Entering Coin Mode: default category to Party and rounds to 10
        if (isCoin) {
            coinState.selectedCategory = 'Party';
            room.maxRounds = 10;
            coinState.roundsInitialized = true;

            const defaultPill = document.getElementById('coinRoundPill10');
            if (defaultPill) {
                document.querySelectorAll('.btn-coin-round').forEach(b => b.classList.remove('active'));
                defaultPill.classList.add('active');
            }

            const catBtns = document.querySelectorAll('#coinCategoryPicker .btn-cat');
            catBtns.forEach(b => {
                b.classList.remove('active');
                b.style.removeProperty('border-color');
                b.style.removeProperty('background');
            });
            if (catBtns[0]) {
                catBtns[0].classList.add('active');
            }
        }

        // Broadcast the change so connected clients update their local state
        if (net.role === 'host') {
            broadcastToAll({ type: 'SYNC_LOBBY', players: room.players, category: room.currentCategory, gameMode: room.gameMode, maxRounds: room.maxRounds, roundCount: room.roundCount, scores: room.scores, lateJoiners: room.lateJoiners });
        }
    },

    setCoinMaxRounds(n, el) {
        room.maxRounds = n;
        document.querySelectorAll('.btn-coin-round').forEach(b => b.classList.remove('active'));
        if (el) el.classList.add('active');
        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(400, 'sine', 0.05);
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        if (net.role === 'host') broadcastToAll({ type: 'SYNC_MAX_ROUNDS', maxRounds: n });
    },

    selectCategory(catName, btnElem) {
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        coinState.selectedCategory = catName;
        document.querySelectorAll('.btn-cat').forEach(b => {
            b.classList.remove('active');
            b.style.removeProperty('border-color');
            b.style.removeProperty('background');
        });
        if (btnElem) {
            btnElem.classList.add('active');
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
                
                broadcastToAll({ type: 'COIN_TARGET_SELECTED', targetPlayer: target });
                
                setTimeout(() => {
                    broadcastToAll({ type: 'COIN_ADVANCE_MATRIX' });
                }, Bots.decisionDelay());
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
                broadcastToAll({ type: 'COIN_SIDE_CHOSEN', side: side });

                setTimeout(() => {
                    this.triggerCoinFlip();
                }, Bots.decisionDelay());
            }, Bots.decisionDelay());
        }
    },

    resetSessionTracking() {
        coinState.usedQuestionsByCategory = {};
        coinState.previousSubject = null;
        coinState.sessionInitialized = true;
    },

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
            console.warn(`[CoinMode] Question pool exhausted for category "${category}" this session; reusing.`);
            chosen = fullList[Math.floor(Math.random() * fullList.length)];
        }

        used.push(chosen);
        return chosen;
    },

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
        if (room.gameMode !== 'coin') return;

        if (room.maxRounds !== 'unlimited' && room.roundCount >= room.maxRounds) {
            broadcastToAll({ type: 'GAME_OVER', scores: room.scores, lateJoiners: room.lateJoiners });
            return;
        }

        room.roundCount++;

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
            question: coinState.question,
            roundCount: room.roundCount
        });
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
            targetPlayer: coinState.targetPlayer
        };

        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);

        this.advanceToMatrixPhase();
    },

    advanceToMatrixPhase() {
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        const payload = { type: 'COIN_ADVANCE_MATRIX' };
        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);
    },

    choosePillSide(side) {
        if (net.myName !== coinState.subject) return;
        if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
        coinState.chosenSide = side;

        const payload = { type: 'COIN_SIDE_CHOSEN', side: side };
        if (net.role === 'host') broadcastToAll(payload);
        else net.conn.send(payload);
    },

    triggerCoinFlip() {
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
        if (net.role === 'host') broadcastToAll(payload);
        else if (net.conn) net.conn.send(payload);
    },

    handleNetwork(data) {
        switch (data.type) {
            case 'COIN_START_ROUND':
                coinState.active = true;
                coinState.subject = data.subject;
                coinState.question = data.question;
                if (data.roundCount) room.roundCount = data.roundCount;
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
                content.innerText = ` ${data.subject} selected ${data.targetPlayer}.`;
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
            document.getElementById('coinContinueBtn').style.display = 'none';
            document.getElementById('coinSilentBroadcastBtn').style.display = 'none';
        } else {
            document.getElementById('coinWaitSubjectName').innerText = coinState.subject;
            document.getElementById('coinWaitTargetLabel').innerText = "Waiting for selection...";

            Fidget.setup({ clickerId: 'coinToyClicker', toggleId: 'coinToyToggle', bubbleGridId: 'coinToyBubbleGrid' });
        }
        if (typeof showScreen === 'function') showScreen('scrCoinPhase1');
    },

    renderPhase2() {
        const isSubject = (net.myName === coinState.subject);
        document.getElementById('coinMatrixSubjectControls').style.display = isSubject ? 'block' : 'none';
        document.getElementById('coinMatrixWaitNotice').style.display = isSubject ? 'none' : 'block';
        if (!isSubject) {
            document.getElementById('coinMatrixWaitNotice').innerText = `${coinState.subject} is choosing Heads or Tails ...`;
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
            coin.onclick = () => Buttons.coinFlip();
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