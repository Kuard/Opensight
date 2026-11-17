// Host-authoritative Classic Mode slot rewards and shared phone reel animation.
const SlotReels = {
    interval: null,
    finishTimer: null,
    stopTimers: [],
    reels: null,
    token: 0,

    stop() {
        this.token++;
        if (this.interval) clearInterval(this.interval);
        if (this.finishTimer) clearTimeout(this.finishTimer);
        this.stopTimers.forEach(timer => clearTimeout(timer));
        if (this.reels) this.reels.classList.remove('is-spinning', 'is-reeling');
        this.interval = null;
        this.finishTimer = null;
        this.stopTimers = [];
        this.reels = null;
    },

    play(reels, resultSymbols, availableSymbols, duration, onComplete) {
        this.stop();
        if (!reels) throw new Error('The phone slot reel container is missing.');
        this.reels = reels;
        const token = this.token;
        const stopDelays = [
            Math.round(duration * 0.56),
            Math.round(duration * 0.78),
            Math.max(0, duration - 200)
        ];
        const columns = [];
        reels.replaceChildren();
        reels.classList.add('is-spinning', 'is-reeling');
        resultSymbols.forEach((resultSymbol, reelIndex) => {
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
                    : availableSymbols[(itemIndex + reelIndex) % availableSymbols.length];
                strip.appendChild(symbol);
            }
            column.appendChild(strip);
            reels.appendChild(column);
            columns.push({ column, strip, position: 0, stopIndex, stopped: false });
        });

        if (typeof Sound !== 'undefined' && Sound.play) Sound.play(520, 'sawtooth', 0.12);
        let tick = 0;
        this.interval = setInterval(() => {
            if (token !== this.token) return;
            tick++;
            columns.forEach(reel => {
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
            this.stopTimers.push(setTimeout(() => {
                if (token !== this.token) return;
                const reel = columns[reelIndex];
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
            if (token !== this.token) return;
            if (this.interval) clearInterval(this.interval);
            this.interval = null;
            this.finishTimer = null;
            this.stopTimers = [];
            reels.classList.remove('is-spinning', 'is-reeling');
            columns.forEach((reel, index) => {
                const symbol = document.createElement('span');
                symbol.className = 'gambling-reel-symbol';
                symbol.textContent = resultSymbols[index];
                reel.strip.replaceChildren(symbol);
                reel.strip.style.transition = 'none';
                reel.strip.style.transform = 'translateY(0)';
            });
            onComplete();
        }, duration);
    }
};

const Gambling = {
    SPIN_DURATION_MS: 2700,
    RESULT_HOLD_MS: 2000,
    MAX_SPINS: 2,
    SUCCESS_CHANCE: 0.8,
    playerState: {},
    subject: '',
    round: 0,
    localState: { spinsRemaining: 0, spinning: false, resultHolding: false, requestPending: false, timeBoostPending: false, lastReward: null },
    finishTimer: null,
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
        const reels = document.getElementById('casinoAppReels');
        if (reels) {
            reels.classList.remove('is-spinning', 'is-reeling', 'is-jackpot');
            reels.replaceChildren(...Object.values(this.rewards).slice(0, 3).map(reward => {
                const symbol = document.createElement('span');
                symbol.textContent = reward.symbol;
                return symbol;
            }));
        }
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
        SlotReels.stop();
        if (this.finishTimer) clearTimeout(this.finishTimer);
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
        if (window.Phone) Phone.openLuckyDraw();
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
        if (window.Phone) Phone.openLuckyDraw();
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
        const reels = document.getElementById('casinoAppReels');
        const animationMs = Math.max(1500, Math.min(5000, Number(data.animationMs) || this.SPIN_DURATION_MS));
        SlotReels.play(reels, data.symbols, symbols, animationMs, () => {
            if (token !== this.animationToken) return;
            this.localState.spinning = false;
            this.localState.resultHolding = true;
            this.localState.lastReward = data.reward || 'miss';
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
        });
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
        const reels = document.getElementById('casinoAppReels');
        const status = document.getElementById('casinoAppResult');
        const action = document.getElementById('casinoAppSpin');
        const skipButton = document.getElementById('casinoAppSkip');
        const legend = document.getElementById('gamblingLegend');
        if (legend) {
            const isSubject = typeof net !== 'undefined' && net.myName === this.subject;
            legend.innerHTML = Object.entries(this.rewards)
                .filter(([key]) => key !== 'luckyVote' || !isSubject)
                .map(([, reward]) => `<div class="gambling-legend-item"><span class="gambling-legend-symbol">${reward.symbol}</span><span>${reward.label}<small>${reward.detail}</small></span></div>`)
                .join('');
        }
        const guide = document.getElementById('phoneSlotGuide');
        if (guide && Phone.slotMode === 'reward') guide.hidden = false;
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

const CasinoSlot = {
    SPIN_DURATION_MS: 2200,
    symbols: ['★', '◆', '♥', '♣', '✦'],
    active: false,
    spinning: false,
    hasSpun: false,
    botTimers: [],

    clearTimers() {
        SlotReels.stop();
        this.botTimers.forEach(timer => clearTimeout(timer));
        this.botTimers = [];
    },

    roll() {
        const jackpot = Math.random() < 0.08;
        let landedSymbols = this.symbols
            .slice(0, 3)
            .map(() => this.symbols[Math.floor(Math.random() * this.symbols.length)]);
        if (jackpot) {
            const symbol = this.symbols[Math.floor(Math.random() * this.symbols.length)];
            landedSymbols = [symbol, symbol, symbol];
        } else if (landedSymbols[0] === landedSymbols[1] &&
            landedSymbols[1] === landedSymbols[2]) {
            landedSymbols[2] = this.symbols[(this.symbols.indexOf(landedSymbols[2]) + 1) % this.symbols.length];
        }
        return { jackpot, symbols: landedSymbols };
    },

    open() {
        if (room.gameMode !== 'casino' || room.casinoCategory !== 'slots' ||
            room.phase !== 'lobby') return;
        this.clearTimers();
        this.active = true;
        this.spinning = false;
        this.hasSpun = false;
        if (window.Phone) Phone.openCasinoSlot();
        const reels = document.getElementById('casinoAppReels');
        if (reels) {
            reels.classList.remove('is-spinning', 'is-reeling', 'is-jackpot');
            reels.replaceChildren(...['★', '◆', '♥'].map(symbol => {
                const item = document.createElement('span');
                item.textContent = symbol;
                return item;
            }));
        }
        const result = document.getElementById('casinoAppResult');
        if (result) result.textContent = 'Ready when you are.';
        this.renderBotResults();
        this.render();
    },

    renderBotResults() {
        const list = document.getElementById('casinoAppBotResults');
        if (!list) return;
        list.replaceChildren();
        const bots = typeof Bots !== 'undefined' && Array.isArray(room.players)
            ? room.players.filter(player => Bots.isBot(player))
            : [];
        list.hidden = bots.length === 0;
        bots.forEach((bot, index) => {
            const timer = setTimeout(() => {
                if (!this.active) return;
                const outcome = this.roll();
                const row = document.createElement('div');
                row.className = `casino-app-bot-result${outcome.jackpot ? ' is-winner' : ''}`;
                row.textContent = `${bot}: ${outcome.symbols.join(' ')}${outcome.jackpot ? ' · Jackpot!' : ''}`;
                list.appendChild(row);
            }, 320 + index * 260);
            this.botTimers.push(timer);
        });
    },

    spin() {
        if (!this.active || this.spinning) return;
        this.spinning = true;
        const reels = document.getElementById('casinoAppReels');
        const result = document.getElementById('casinoAppResult');
        if (reels) reels.classList.remove('is-jackpot');
        if (result) result.textContent = 'The reels are rolling...';
        this.render();

        const { jackpot, symbols: landedSymbols } = this.roll();
        SlotReels.play(reels, landedSymbols, this.symbols, this.SPIN_DURATION_MS, () => {
            if (!this.active) return;
            this.spinning = false;
            this.hasSpun = true;
            if (reels) {
                reels.classList.toggle('is-jackpot', jackpot);
            }
            if (result) result.textContent = jackpot ? 'Jackpot! Nice spin.' : 'No match this time.';
            this.render();
        });
    },

    render() {
        const button = document.getElementById('casinoAppSpin');
        if (!button) return;
        button.disabled = !this.active || this.spinning;
        button.textContent = this.spinning ? 'Spinning...' : this.hasSpun ? 'Spin again' : 'Spin once';
    },

    close() {
        this.clearTimers();
        this.active = false;
        this.spinning = false;
        this.hasSpun = false;
        if (window.Phone) Phone.close();
    }
};

window.CasinoSlot = CasinoSlot;
