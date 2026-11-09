// Host-authoritative Classic Mode slot rewards and full-screen spin presentation.
const Gambling = {
    SPIN_DURATION_MS: 2700,
    RESULT_HOLD_MS: 2000,
    MAX_SPINS: 2,
    SUCCESS_CHANCE: 0.8,
    playerState: {},
    subject: '',
    round: 0,
    localState: { spinsRemaining: 0, spinning: false, resultHolding: false, requestPending: false, timeBoostPending: false, lastReward: null },
    animationTimer: null,
    finishTimer: null,
    reelStopTimers: [],
    animationToken: 0,

    rewards: {
        extraTime: { label: '+15 Seconds', detail: 'Bank one 15-second boost for a writing round', symbol: '◷' },
        luckyVote: { label: 'Lucky Vote', detail: 'Vote for any other player’s card; you earn 1 point for voting', symbol: '♥' },
        doublePoints: { label: '2x Points', detail: 'Double all points you earn this round', symbol: '★' },
        extraSpin: { label: '+1 Spin', detail: 'Win one extra spin this round; it cannot grant another spin', symbol: '↻' }
    },

    setEnabled(enabled) {
        if (net.role !== 'host' || room.phase !== 'lobby') return;
        room.gamblingEnabled = !!enabled;
        this.renderSetting();
        broadcastToAll({ type: 'SYNC_GAMBLING', enabled: room.gamblingEnabled });
    },

    renderSetting() {
        const toggle = document.getElementById('gamblingEnabledToggle');
        if (toggle) {
            toggle.checked = room.gamblingEnabled;
            toggle.disabled = net.role !== 'host' || room.phase !== 'lobby';
        }
        const status = document.getElementById('gamblingSettingStatus');
        if (status) {
            status.textContent = room.gamblingEnabled ? 'Enabled for every round' : 'Disabled for this game';
        }
    },

    reset(round, players, subject) {
        this.clearAnimation();
        const reels = document.getElementById('gamblingReels');
        if (reels) {
            reels.classList.remove('is-spinning');
            reels.innerHTML = '';
            Object.values(this.rewards).slice(0, 3).forEach(reward => {
                const column = document.createElement('div');
                column.className = 'gambling-reel-column';
                const symbol = document.createElement('div');
                symbol.className = 'gambling-reel-result';
                symbol.textContent = reward.symbol;
                column.appendChild(symbol);
                reels.appendChild(column);
            });
        }
        this.reelColumns = [];
        this.round = round;
        this.subject = subject;
        const previousState = round > 0 ? this.playerState : {};
        this.playerState = {};
        (players || []).forEach(player => {
            this.playerState[player] = {
                spinsRemaining: player === subject ? 0 : 1,
                spinsUsed: 0,
                luckyVote: false,
                doublePoints: false,
                extraSpinAwarded: false,
                storedTime: previousState[player] ? previousState[player].storedTime : 0,
                readyAt: 0,
                lastReward: null,
                lastOutcome: null
            };
        });
        const previousLocalTime = round > 0 && this.localState ? this.localState.storedTime : 0;
        this.localState = {
            spinsRemaining: net.myName === subject ? 0 : 1,
            spinning: false,
            resultHolding: false,
            requestPending: false,
            timeBoostPending: false,
            lastReward: null,
            storedTime: previousLocalTime,
            extraSpinAwarded: false
        };
        this.render();
    },

    clearAnimation() {
        this.animationToken++;
        if (this.animationTimer) clearInterval(this.animationTimer);
        if (this.finishTimer) clearTimeout(this.finishTimer);
        this.reelStopTimers.forEach(timer => clearTimeout(timer));
        this.reelStopTimers = [];
        this.animationTimer = null;
        this.finishTimer = null;
        if (this.localState) {
            this.localState.spinning = false;
            this.localState.resultHolding = false;
            this.localState.requestPending = false;
            this.localState.timeBoostPending = false;
        }
    },

    getBonuses(player) {
        return this.playerState[player] || null;
    },

    roll(player, now = Date.now()) {
        const state = this.playerState[player];
        if (player === this.subject) return null;
        if (!state || state.spinsRemaining <= 0 || state.readyAt > now) return null;
        const timeChargeAvailable = state.storedTime < 15;
        const rewardPool = timeChargeAvailable
            ? (state.extraSpinAwarded
                ? [[47.5, 'extraTime'], [47.5, 'luckyVote'], [5, 'doublePoints']]
                : [[45, 'extraTime'], [45, 'luckyVote'], [5, 'doublePoints'], [5, 'extraSpin']])
            : (state.extraSpinAwarded
                ? [[95, 'luckyVote'], [5, 'doublePoints']]
                : [[90, 'luckyVote'], [5, 'doublePoints'], [5, 'extraSpin']]);

        const isWin = Math.random() < this.SUCCESS_CHANCE;
        let reward = null;
        let symbols;
        if (isWin) {
            const pick = Math.random() * 100;
            let total = 0;
            reward = rewardPool[rewardPool.length - 1][1];
            for (const [weight, key] of rewardPool) {
                total += weight;
                if (pick < total) {
                    reward = key;
                    break;
                }
            }
            symbols = [this.rewards[reward].symbol, this.rewards[reward].symbol, this.rewards[reward].symbol];
        } else {
            const availableSymbols = Object.values(this.rewards).map(item => item.symbol);
            const first = availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
            const second = availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
            let third = availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
            while (first === second && second === third) {
                third = availableSymbols[(availableSymbols.indexOf(third) + 1) % availableSymbols.length];
            }
            symbols = [first, second, third];
        }

        state.spinsRemaining = 0;
        state.spinsUsed++;
        state.readyAt = now + this.SPIN_DURATION_MS + this.RESULT_HOLD_MS;
        if (reward === 'luckyVote') {
            state.luckyVote = true;
        } else if (reward === 'doublePoints') {
            state.doublePoints = true;
        } else if (reward === 'extraSpin' && !state.extraSpinAwarded) {
            state.extraSpinAwarded = true;
            state.spinsRemaining = 1;
        } else if (reward === 'extraTime' && timeChargeAvailable) {
            state.storedTime = 15;
        }
        state.lastReward = reward || 'miss';
        state.lastOutcome = {
            reward,
            symbols,
            spinsRemaining: state.spinsRemaining,
            storedTime: state.storedTime,
            extraSpinAwarded: state.extraSpinAwarded,
            rewardDiscarded: reward === 'extraTime' && !timeChargeAvailable,
            round: this.round,
            animationMs: this.SPIN_DURATION_MS
        };
        return state.lastOutcome;
    },

    syncLocal(data) {
        if (!data || !Number.isInteger(data.spinsRemaining)) return;
        this.clearAnimation();
        if (Number.isInteger(data.round)) this.round = data.round;
        if (typeof data.subject === 'string') this.subject = data.subject;
        this.localState = {
            spinsRemaining: Math.max(0, Math.min(this.MAX_SPINS, data.spinsRemaining)),
            spinning: false,
            resultHolding: false,
            requestPending: false,
            timeBoostPending: false,
            lastReward: data.lastReward || null,
            storedTime: Math.max(0, Math.min(15, Number(data.storedTime) || 0)),
            extraSpinAwarded: !!data.extraSpinAwarded
        };
        const localPlayer = typeof net !== 'undefined' && this.playerState[net.myName];
        const playerState = localPlayer || (typeof net !== 'undefined'
            ? this.playerState[net.myName] = {
                spinsRemaining: this.localState.spinsRemaining,
                spinsUsed: this.localState.spinsRemaining === 0 ? 1 : 0,
                luckyVote: false,
                doublePoints: false,
                extraSpinAwarded: !!data.extraSpinAwarded,
                storedTime: this.localState.storedTime,
                readyAt: Date.now() + Math.max(0, Number(data.spinWaitMs) || 0),
                lastReward: null,
                lastOutcome: null
            }
            : null);
        if (playerState) {
            playerState.spinsRemaining = this.localState.spinsRemaining;
            playerState.storedTime = this.localState.storedTime;
            playerState.luckyVote = !!data.luckyVote;
            playerState.doublePoints = !!data.doublePoints;
            playerState.extraSpinAwarded = !!data.extraSpinAwarded;
            playerState.lastReward = data.lastReward || null;
        }
        this.render();
    },

    beginRound() {
        if (net.myName === this.subject) return;
        const screen = document.getElementById('scrGambling');
        if (!screen) return;
        showScreen('scrGambling');
        this.render();
    },

    requestSpin() {
        if (net.myName === this.subject || this.localState.spinning || this.localState.resultHolding ||
            this.localState.requestPending ||
            this.localState.spinsRemaining <= 0) return;
        this.localState.requestPending = true;
        this.render();
        if (net.role === 'host') {
            handleData({ type: 'SPIN_REQUEST', player: net.myName }, null);
        } else if (net.conn && net.conn.open) {
            try {
                net.conn.send({ type: 'SPIN_REQUEST' });
            } catch (error) {
                this.localState.requestPending = false;
                console.error('Could not request the slot spin from the host.', error);
                showToast('Could not reach the host. Tap to retry.');
                this.render();
            }
        } else {
            this.localState.requestPending = false;
            showToast('Waiting for the host connection');
            this.render();
        }
    },

    showResult(data) {
        if (!data || data.round !== this.round ||
            (data.reward !== null && !Object.prototype.hasOwnProperty.call(this.rewards, data.reward)) ||
            !Array.isArray(data.symbols) || data.symbols.length !== 3 ||
            data.symbols.some(symbol => typeof symbol !== 'string')) return;

        this.clearAnimation();
        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(520, 'sawtooth', 0.12);
        const token = this.animationToken;
        this.localState.spinsRemaining = Math.max(0, Math.min(this.MAX_SPINS, data.spinsRemaining));
        this.localState.spinning = true;
        this.localState.resultHolding = false;
        this.localState.requestPending = false;
        this.localState.timeBoostPending = false;
        this.localState.storedTime = Math.max(0, Math.min(15, Number(data.storedTime) || 0));
        this.localState.rewardDiscarded = !!data.rewardDiscarded;
        this.localState.lastReward = null;
        const localPlayer = typeof net !== 'undefined' && this.playerState[net.myName];
        if (localPlayer) {
            localPlayer.spinsRemaining = this.localState.spinsRemaining;
            localPlayer.storedTime = this.localState.storedTime;
            localPlayer.luckyVote = localPlayer.luckyVote || data.reward === 'luckyVote';
            localPlayer.doublePoints = localPlayer.doublePoints || data.reward === 'doublePoints';
            localPlayer.extraSpinAwarded = !!data.extraSpinAwarded;
            localPlayer.lastReward = data.reward || 'miss';
        }
        this.render();

        const symbols = Object.values(this.rewards).map(item => item.symbol);
        const reels = document.getElementById('gamblingReels');
        const animationMs = Math.max(1500, Math.min(5000, Number(data.animationMs) || this.SPIN_DURATION_MS));
        const stopDelays = [
            Math.round(animationMs * 0.56),
            Math.round(animationMs * 0.78),
            Math.max(0, animationMs - 200)
        ];
        if (reels) {
            reels.innerHTML = '';
            reels.classList.add('is-spinning');
            this.reelColumns = [];
            data.symbols.forEach((resultSymbol, reelIndex) => {
                const column = document.createElement('div');
                column.className = 'gambling-reel-column';
                const strip = document.createElement('div');
                strip.className = 'gambling-reel-strip';
                const stopIndex = Math.floor(stopDelays[reelIndex] / 45) + 1;
                for (let itemIndex = 0; itemIndex <= stopIndex; itemIndex++) {
                    const symbol = document.createElement('span');
                    symbol.className = 'gambling-reel-symbol';
                    symbol.textContent = itemIndex === stopIndex
                        ? resultSymbol
                        : symbols[(itemIndex + reelIndex) % symbols.length];
                    strip.appendChild(symbol);
                }
                column.appendChild(strip);
                reels.appendChild(column);
                this.reelColumns.push({
                    column,
                    strip,
                    position: 0,
                    stopIndex,
                    stopped: false
                });
            });
        }
        let tick = 0;
        this.animationTimer = setInterval(() => {
            if (token !== this.animationToken) return;
            tick++;
            (this.reelColumns || []).forEach(reel => {
                if (reel.stopped) return;
                reel.position = Math.min(reel.position + 1, reel.stopIndex - 1);
                const cellHeight = reel.column.querySelector('.gambling-reel-symbol')
                    .getBoundingClientRect().height;
                reel.strip.style.transform = `translateY(-${reel.position * cellHeight}px)`;
            });
            if (typeof Sound !== 'undefined' && Sound.play && tick % 2 === 0) {
                Sound.play(230 + (tick % 5) * 35, 'square', 0.045);
            }
        }, 45);

        stopDelays.forEach((delay, reelIndex) => {
            this.reelStopTimers.push(setTimeout(() => {
                if (token !== this.animationToken) return;
                const reel = this.reelColumns && this.reelColumns[reelIndex];
                if (!reel) return;
                reel.stopped = true;
                reel.strip.style.transition = 'transform 180ms cubic-bezier(.2,.8,.25,1)';
                const cellHeight = reel.column.querySelector('.gambling-reel-symbol')
                    .getBoundingClientRect().height;
                reel.strip.style.transform = `translateY(-${reel.stopIndex * cellHeight}px)`;
                if (typeof Sound !== 'undefined' && Sound.play) {
                    Sound.play(430 + reelIndex * 90, 'triangle', 0.09);
                }
            }, delay));
        });

        this.finishTimer = setTimeout(() => {
            if (token !== this.animationToken) return;
            if (this.animationTimer) clearInterval(this.animationTimer);
            this.animationTimer = null;
            this.reelStopTimers = [];
            this.localState.spinning = false;
            this.localState.resultHolding = true;
            this.localState.lastReward = data.reward || 'miss';
            if (reels) {
                reels.classList.remove('is-spinning');
            }
            if (typeof Sound !== 'undefined' && Sound.play) {
                Sound.play(data.reward ? 680 : 190, data.reward ? 'triangle' : 'sine', 0.18);
            }
            this.render();
            this.finishTimer = setTimeout(() => {
                if (token !== this.animationToken) return;
                this.finishTimer = null;
                this.localState.resultHolding = false;
                if (this.localState.spinsRemaining === 0) this.finishRound();
                else this.render();
            }, this.RESULT_HOLD_MS);
        }, animationMs);
    },

    finishRound() {
        this.clearAnimation();
        if (net.role === 'host') {
            handleData({ type: 'GAMBLE_DONE', player: net.myName }, null);
        } else if (net.conn && net.conn.open) {
            try {
                net.conn.send({ type: 'GAMBLE_DONE' });
            } catch (error) {
                console.error('Could not notify the host that the slot spins are complete.', error);
                showToast('Could not reach the host; retrying');
                this.finishTimer = setTimeout(() => {
                    this.finishTimer = null;
                    this.finishRound();
                }, 1000);
            }
        } else {
            showToast('Waiting for the host connection');
            this.finishTimer = setTimeout(() => {
                this.finishTimer = null;
                this.finishRound();
            }, 1000);
        }
    },

    skip() {
        if (net.myName === this.subject || this.localState.spinning || this.localState.resultHolding ||
            this.localState.requestPending) return;
        this.localState.requestPending = true;
        this.render();
        if (net.role === 'host') {
            handleData({ type: 'GAMBLE_DONE', player: net.myName, skipped: true }, null);
        } else if (net.conn && net.conn.open) {
            try {
                net.conn.send({ type: 'GAMBLE_DONE', skipped: true });
            } catch (error) {
                this.localState.requestPending = false;
                console.error('Could not tell the host this player is skipping the slot.', error);
                showToast('Could not reach the host. Tap Skip again.');
                this.render();
            }
        } else {
            this.localState.requestPending = false;
            showToast('Waiting for the host connection');
            this.render();
        }
    },

    useTimeBoost() {
        if (this.localState.timeBoostPending || this.localState.storedTime < 15 || net.myName === this.subject ||
            !room.activeWriters.includes(net.myName) || room.cards.some(card => card.creator === net.myName)) return;
        if (net.role === 'host') {
            handleData({ type: 'USE_TIME_BOOST', player: net.myName }, null);
        } else if (net.conn && net.conn.open) {
            this.localState.timeBoostPending = true;
            this.render();
            try {
                net.conn.send({ type: 'USE_TIME_BOOST' });
            } catch (error) {
                this.localState.timeBoostPending = false;
                console.error('Could not ask the host to use the 15-second boost.', error);
                showToast('Could not reach the host. Try using the boost again.');
                this.render();
            }
        } else {
            showToast('Waiting for the host connection');
        }
    },

    render() {
        const screen = document.getElementById('scrGambling');
        if (!screen) return;
        const reels = document.getElementById('gamblingReels');
        const status = document.getElementById('gamblingStatus');
        const action = document.getElementById('gamblingSpinButton');
        const skipButton = document.getElementById('gamblingSkipButton');
        const legend = document.getElementById('gamblingLegend');
        if (legend) {
            const isSubject = typeof net !== 'undefined' && net.myName === this.subject;
            legend.innerHTML = Object.entries(this.rewards)
                .filter(([key]) => key !== 'luckyVote' || !isSubject)
                .map(([, reward]) => `<div class="gambling-legend-item"><span class="gambling-legend-symbol">${reward.symbol}</span><span>${reward.label}<small>${reward.detail}</small></span></div>`)
                .join('');
        }
        if (reels) reels.classList.toggle('is-spinning', this.localState.spinning);
        if (status) {
            if (this.localState.spinning) status.innerText = 'The reels are rolling...';
            else if (this.localState.requestPending) status.innerText = 'Waiting for the host...';
            else if (this.localState.lastReward === 'miss') status.innerText = 'No match — no reward';
            else if (this.localState.lastReward) {
                const reward = this.rewards[this.localState.lastReward];
                status.innerText = this.localState.rewardDiscarded
                    ? `${reward.label} — your 15 seconds are already banked`
                    : `${reward.label} — ${reward.detail}`;
            } else status.innerText = `Start Spin or skip. Three matching symbols win (${Math.round(this.SUCCESS_CHANCE * 100)}% chance).`;
        }
        if (action) {
            action.hidden = this.localState.spinning || this.localState.resultHolding || this.localState.requestPending ||
                this.localState.spinsRemaining <= 0;
            action.disabled = this.localState.requestPending || this.localState.spinning || this.localState.resultHolding ||
                this.localState.spinsRemaining <= 0;
            action.innerText = 'Start Spin';
        }
        if (skipButton) {
            skipButton.hidden = this.localState.spinning || this.localState.resultHolding || this.localState.requestPending ||
                this.localState.spinsRemaining <= 0;
            skipButton.disabled = this.localState.requestPending || this.localState.spinning || this.localState.resultHolding ||
                this.localState.spinsRemaining <= 0;
        }
        const timeBoost = document.getElementById('useTimeBoostBtn');
        if (timeBoost) {
            const usable = this.localState.storedTime >= 15 && typeof room !== 'undefined' &&
                room.phase === 'writing' && room.roundActive && net.myName !== this.subject &&
                room.activeWriters.includes(net.myName) &&
                !room.cards.some(card => card.creator === net.myName);
            timeBoost.hidden = !usable;
            timeBoost.disabled = !usable || this.localState.timeBoostPending;
            timeBoost.innerText = this.localState.timeBoostPending
                ? 'Adding 15 seconds...'
                : `Use +15 seconds (${Math.floor(this.localState.storedTime)} banked)`;
        }
    }
};

window.Gambling = Gambling;
