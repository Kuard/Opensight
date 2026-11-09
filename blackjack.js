// Host-authoritative, player-versus-player Blackjack played in the lobby.
const Blackjack = {
    state: {
        open: false,
        phase: 'waiting',
        participants: [],
        hands: {},
        stood: [],
        stoodCount: 0,
        deck: [],
        results: []
    },
    testBotName: 'Blackjack Test Bot',
    myHand: [],
    myStanding: false,
    botTurnTimer: null,
    botTurnToken: 0,

    rankNames: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
    suits: [
        { name: 'hearts', symbol: '♥', red: true },
        { name: 'diamonds', symbol: '♦', red: true },
        { name: 'clubs', symbol: '♣', red: false },
        { name: 'spades', symbol: '♠', red: false }
    ],

    scoreHand(hand) {
        let total = 0;
        let aces = 0;
        (hand || []).forEach(card => {
            if (card.rank === 'A') {
                total += 11;
                aces++;
            } else if (['K', 'Q', 'J'].includes(card.rank)) {
                total += 10;
            } else {
                total += Number(card.rank) || 0;
            }
        });
        while (total > 21 && aces > 0) {
            total -= 10;
            aces--;
        }
        return total;
    },

    isNatural(hand) {
        return hand.length === 2 && this.scoreHand(hand) === 21;
    },

    createDeck() {
        const deck = [];
        this.suits.forEach(suit => {
            this.rankNames.forEach((rank, index) => {
                deck.push({ rank, suit: suit.name, symbol: suit.symbol, red: suit.red, value: index + 1 });
            });
        });
        for (let index = deck.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
        }
        return deck;
    },

    reset() {
        this.clearBotTurn();
        this.state = { open: false, phase: 'waiting', participants: [], hands: {}, stood: [], stoodCount: 0, deck: [], results: [] };
        this.myHand = [];
        this.myStanding = false;
        this.render();
    },

    clearBotTurn() {
        this.botTurnToken++;
        if (this.botTurnTimer) clearTimeout(this.botTurnTimer);
        this.botTurnTimer = null;
    },

    openTable() {
        if (room.phase !== 'lobby') return;
        if (net.role === 'host' && !this.state.open) {
            this.state.open = true;
            this.broadcastState();
        }
        if (!this.state.open) return;
        showScreen('scrBlackjack');
    },

    exitTable() {
        if (net.role === 'host') {
            this.state.open = false;
            this.clearBotTurn();
            this.state = { open: false, phase: 'waiting', participants: [], hands: {}, stood: [], stoodCount: 0, deck: [], results: [] };
            this.myHand = [];
            this.myStanding = false;
            this.broadcastState();
        } else if (this.state.participants.includes(net.myName)) {
            this.sendRequest({ type: 'BLACKJACK_LEAVE' });
        }
        showScreen('scrLobby');
    },

    addOrRemoveTestBot() {
        if (net.role !== 'host' || !this.state.open ||
            !['waiting', 'results'].includes(this.state.phase)) return;
        const participants = this.state.participants;
        if (participants.includes(this.testBotName)) {
            participants.splice(participants.indexOf(this.testBotName), 1);
        } else {
            participants.push(this.testBotName);
        }
        this.broadcastState();
    },

    openRules() {
        document.getElementById('blackjackRulesModal').classList.add('active');
    },

    closeRules() {
        document.getElementById('blackjackRulesModal').classList.remove('active');
    },

    requestJoin() {
        if (room.phase !== 'lobby' || !['waiting', 'results'].includes(this.state.phase)) return;
        const type = this.state.participants.includes(net.myName) ? 'BLACKJACK_LEAVE' : 'BLACKJACK_JOIN';
        this.sendRequest({ type });
    },

    hit() {
        this.sendRequest({ type: 'BLACKJACK_ACTION', action: 'hit' });
    },

    stand() {
        this.sendRequest({ type: 'BLACKJACK_ACTION', action: 'stand' });
    },

    sendRequest(payload) {
        if (net.role === 'host') {
            handleData({ ...payload, player: net.myName }, null);
            return;
        }
        if (!net.conn || !net.conn.open) {
            showToast('Waiting for the host connection');
            return;
        }
        try {
            net.conn.send(payload);
        } catch (error) {
            console.error('Could not send the Blackjack action to the host.', error);
            showToast('Could not reach the host. Please try again.');
        }
    },

    start() {
        if (net.role !== 'host' || room.phase !== 'lobby' || !this.state.open ||
            !['waiting', 'results'].includes(this.state.phase)) return;
        this.handleHostMessage({ type: 'BLACKJACK_START', player: net.myName }, null);
    },

    endEarly() {
        if (net.role !== 'host' || this.state.phase !== 'playing') return;
        this.handleHostMessage({ type: 'BLACKJACK_END', player: net.myName }, null);
    },

    handleHostMessage(data, connection) {
        if (net.role !== 'host' || room.phase !== 'lobby' || !this.state.open) return;
        const player = connection ? connection._kickName : data.player;
        const isTestBot = !connection && player === this.testBotName &&
            this.state.participants.includes(this.testBotName);
        if (!player || (!isTestBot && !room.players.includes(player)) ||
            (connection && connection._kickName !== player)) return;

        if (data.type === 'BLACKJACK_JOIN' && ['waiting', 'results'].includes(this.state.phase)) {
            if (!this.state.participants.includes(player)) this.state.participants.push(player);
            this.broadcastState();
            return;
        }
        if (data.type === 'BLACKJACK_LEAVE' &&
            ['waiting', 'playing', 'results'].includes(this.state.phase) &&
            this.state.participants.includes(player)) {
            this.state.participants = this.state.participants.filter(name => name !== player);
            delete this.state.hands[player];
            this.state.stood = this.state.stood.filter(name => name !== player);
            if (this.state.phase === 'playing' && this.state.stood.length >= this.state.participants.length) {
                if (this.state.participants.length) this.finish();
                else {
                    this.state.phase = 'waiting';
                    this.state.hands = {};
                    this.state.deck = [];
                    this.state.results = [];
                    this.broadcastState();
                }
                return;
            }
            this.broadcastState();
            return;
        }
        if (data.type === 'BLACKJACK_START' && player === net.myName &&
            ['waiting', 'results'].includes(this.state.phase) && this.state.participants.length >= 2) {
            this.clearBotTurn();
            this.state.phase = 'playing';
            this.state.deck = this.createDeck();
            this.state.hands = {};
            this.state.stood = [];
            this.state.stoodCount = 0;
            this.state.results = [];
            this.state.participants.forEach(name => { this.state.hands[name] = []; });
            for (let cardIndex = 0; cardIndex < 2; cardIndex++) {
                this.state.participants.forEach(name => {
                    this.state.hands[name].push(this.state.deck.pop());
                });
            }
            this.state.participants.forEach(name => {
                if (this.isNatural(this.state.hands[name])) this.state.stood.push(name);
            });
            this.broadcastState();
            if (this.state.stood.length === this.state.participants.length) this.finish();
            else this.scheduleBotTurn();
            return;
        }
        if (data.type === 'BLACKJACK_END' && player === net.myName && this.state.phase === 'playing') {
            this.finish();
            return;
        }
        if (data.type !== 'BLACKJACK_ACTION' || this.state.phase !== 'playing' ||
            !this.state.participants.includes(player) || this.state.stood.includes(player)) return;

        if (data.action === 'stand') {
            this.state.stood.push(player);
        } else if (data.action === 'hit') {
            if (this.state.deck.length === 0) {
                this.state.stood.push(player);
            } else {
                this.state.hands[player].push(this.state.deck.pop());
                if (this.scoreHand(this.state.hands[player]) >= 21) this.state.stood.push(player);
            }
        } else {
            return;
        }

        if (this.state.stood.length >= this.state.participants.length) this.finish();
        else {
            this.broadcastState();
            this.scheduleBotTurn();
        }
    },

    scheduleBotTurn() {
        this.clearBotTurn();
        if (net.role !== 'host' || this.state.phase !== 'playing' ||
            !this.state.participants.includes(this.testBotName) ||
            this.state.stood.includes(this.testBotName)) return;
        const token = this.botTurnToken;
        this.botTurnTimer = setTimeout(() => {
            this.botTurnTimer = null;
            if (token !== this.botTurnToken || this.state.phase !== 'playing') return;
            const hand = this.state.hands[this.testBotName] || [];
            this.handleHostMessage({
                type: 'BLACKJACK_ACTION',
                action: this.scoreHand(hand) < 17 ? 'hit' : 'stand',
                player: this.testBotName
            }, null);
        }, 700);
    },

    finish() {
        if (net.role !== 'host' || this.state.phase !== 'playing') return;
        this.clearBotTurn();
        this.state.phase = 'results';
        const entries = this.state.participants.map(player => {
            const hand = this.state.hands[player] || [];
            const total = this.scoreHand(hand);
            return { player, cards: hand, total, natural: this.isNatural(hand), bust: total > 21 };
        });
        const active = entries.filter(entry => !entry.bust);
        const highest = Math.max(0, ...active.map(entry => entry.total));
        const naturals = active.filter(entry => entry.natural && entry.total === highest);
        const winningPlayers = naturals.length > 0
            ? naturals.map(entry => entry.player)
            : active.filter(entry => entry.total === highest).map(entry => entry.player);
        this.state.results = entries.map(entry => ({
            ...entry,
            winner: winningPlayers.includes(entry.player)
        }));
        this.broadcastState();
    },

    onPlayerDisconnected(player) {
        if (net.role !== 'host' || !this.state.participants.includes(player)) return;
        if (this.state.phase === 'waiting') {
            this.state.participants = this.state.participants.filter(name => name !== player);
            this.broadcastState();
        } else if (this.state.phase === 'playing' && !this.state.stood.includes(player)) {
            this.state.stood.push(player);
            if (this.state.stood.length >= this.state.participants.length) this.finish();
            else this.broadcastState();
        }
    },

    onPlayerLeft(player) {
        if (net.role !== 'host' || !this.state.participants.includes(player)) return;
        if (this.state.phase === 'waiting') {
            this.state.participants = this.state.participants.filter(name => name !== player);
            this.broadcastState();
        } else if (this.state.phase === 'playing') {
            if (!this.state.stood.includes(player)) this.state.stood.push(player);
            if (this.state.stood.length >= this.state.participants.length) this.finish();
            else this.broadcastState();
        }
    },

    publicState() {
        return {
            open: this.state.open,
            phase: this.state.phase,
            participants: this.state.participants.slice(),
            stoodCount: this.state.stood.length,
            results: this.state.phase === 'results' ? this.state.results : []
        };
    },

    privateHand(player) {
        return this.state.hands[player] || [];
    },

    sendPrivateHand(player) {
        if (this.state.phase !== 'playing' || !this.state.participants.includes(player)) return;
        sendToPlayer(player, {
            type: 'BLACKJACK_HAND',
            player,
            hand: this.privateHand(player),
            stood: this.state.stood.includes(player)
        });
    },

    sendStateTo(player) {
        if (net.role !== 'host') return;
        sendToPlayer(player, { type: 'BLACKJACK_SYNC', state: this.publicState() });
        this.sendPrivateHand(player);
    },

    broadcastState() {
        if (net.role !== 'host') return;
        broadcastToAll({ type: 'BLACKJACK_SYNC', state: this.publicState() });
        this.state.participants.forEach(player => this.sendPrivateHand(player));
        this.render();
    },

    receivePublicState(data) {
        const state = data && data.state;
        if (!state || !['waiting', 'playing', 'results'].includes(state.phase) ||
            !Array.isArray(state.participants)) return;
        const wasOpen = this.state.open;
        const isOpen = state.open === true;
        const phaseChanged = this.state.phase !== state.phase;
        this.state.open = isOpen;
        this.state.phase = state.phase;
        this.state.participants = state.participants.filter(name => typeof name === 'string');
        this.state.stood = [];
        this.state.stoodCount = Number.isInteger(state.stoodCount) ? state.stoodCount : 0;
        this.state.hands = {};
        this.state.deck = [];
        this.state.results = state.phase === 'results' && Array.isArray(state.results)
            ? state.results
            : [];
        if (state.phase === 'waiting') {
            this.myHand = [];
            this.myStanding = false;
        } else if (state.phase === 'playing' && phaseChanged) {
            this.myHand = [];
            this.myStanding = false;
        }
        if (state.phase === 'results') {
            const ownResult = this.state.results.find(result => result.player === net.myName);
            this.myHand = ownResult && Array.isArray(ownResult.cards) ? ownResult.cards : [];
        }
        this.render();
        if (!wasOpen && isOpen && $('scrLobby').classList.contains('active')) {
            showScreen('scrBlackjack');
        } else if (wasOpen && !isOpen && $('scrBlackjack').classList.contains('active')) {
            showScreen('scrLobby');
        }
    },

    receivePrivateHand(data) {
        if (!data || data.player !== net.myName || !Array.isArray(data.hand) ||
            this.state.phase !== 'playing') return;
        this.myHand = data.hand;
        this.myStanding = !!data.stood;
        this.render();
    },

    cardElement(card) {
        const element = document.createElement('div');
        element.className = `blackjack-card${card.red ? ' is-red' : ''}`;
        const top = document.createElement('span');
        top.className = 'blackjack-card-corner';
        top.textContent = `${card.rank}${card.symbol}`;
        const center = document.createElement('span');
        center.className = 'blackjack-card-center';
        center.textContent = card.symbol;
        const bottom = document.createElement('span');
        bottom.className = 'blackjack-card-corner blackjack-card-corner-bottom';
        bottom.textContent = `${card.rank}${card.symbol}`;
        element.append(top, center, bottom);
        return element;
    },

    renderHand(container, hand) {
        container.replaceChildren();
        (hand || []).forEach(card => container.appendChild(this.cardElement(card)));
    },

    render() {
        const panel = document.getElementById('blackjackLobby');
        if (!panel) return;
        const roomIsLobby = !!room && room.phase === 'lobby';
        panel.hidden = !roomIsLobby || !this.state.open;
        const lobbyButton = document.getElementById('blackjackLobbyBtn');
        if (lobbyButton) lobbyButton.hidden = !roomIsLobby || (net.role !== 'host' && !this.state.open);
        if (panel.hidden) return;

        const joinButton = document.getElementById('blackjackJoinBtn');
        const botButton = document.getElementById('blackjackBotBtn');
        const startButton = document.getElementById('blackjackStartBtn');
        const endButton = document.getElementById('blackjackEndBtn');
        const actions = document.getElementById('blackjackActions');
        const ownHand = document.getElementById('blackjackOwnHand');
        const ownScore = document.getElementById('blackjackOwnScore');
        const status = document.getElementById('blackjackStatus');
        const players = document.getElementById('blackjackPlayers');
        const results = document.getElementById('blackjackResults');
        const isParticipant = this.state.participants.includes(net.myName);
        const isHost = net.role === 'host';
        const hasTestBot = this.state.participants.includes(this.testBotName);
        const ownStanding = isHost
            ? this.state.stood.includes(net.myName)
            : this.myStanding;

        if (joinButton) {
            joinButton.hidden = !['waiting', 'results'].includes(this.state.phase);
            joinButton.textContent = isParticipant
                ? (this.state.phase === 'results' ? 'Leave next hand' : 'Leave table')
                : (this.state.phase === 'results' ? 'Join next hand' : 'Join Blackjack');
        }
        if (startButton) {
            startButton.hidden = !isHost || !['waiting', 'results'].includes(this.state.phase);
            startButton.disabled = this.state.participants.length < 2;
            startButton.textContent = this.state.phase === 'results' ? 'Deal Again' : 'Deal Cards';
        }
        if (botButton) {
            botButton.hidden = !isHost || !['waiting', 'results'].includes(this.state.phase);
            botButton.textContent = hasTestBot ? 'Remove Test Bot' : 'Add Test Bot';
        }
        if (endButton) endButton.hidden = !isHost || this.state.phase !== 'playing';
        if (players) {
            players.textContent = this.state.participants.length
                ? `At the table: ${this.state.participants.join(', ')}`
                : 'No players have joined yet.';
        }
        if (status) {
            if (this.state.phase === 'waiting') {
                status.textContent = 'Waiting for the host to deal (2+ players).';
            } else if (this.state.phase === 'playing') {
                if (!isParticipant) {
                    status.textContent = 'This hand is underway. Join the next hand after the results.';
                } else {
                    status.textContent = ownStanding
                        ? 'Your hand is locked. Waiting for the other players...'
                        : `Your turn: hit or stand. ${(isHost ? this.state.stood.length : this.state.stoodCount)} of ${this.state.participants.length} players are done.`;
                }
            } else {
                const winners = this.state.results.filter(result => result.winner).map(result => result.player);
                status.textContent = winners.length
                    ? `Winner${winners.length > 1 ? 's' : ''}: ${winners.join(', ')}`
                    : 'Everyone busted — no winner this hand.';
            }
        }
        if (ownHand) {
            const showOwnHand = isParticipant && (this.state.phase === 'playing' ||
                (this.state.phase === 'results' && this.myHand.length > 0));
            ownHand.hidden = !showOwnHand;
            if (showOwnHand && this.state.phase === 'playing') this.renderHand(ownHand, this.myHand);
        }
        if (ownScore) {
            ownScore.hidden = this.state.phase !== 'playing' || !isParticipant;
            if (!ownScore.hidden) ownScore.textContent = `Your total: ${this.myHand.length ? this.scoreHand(this.myHand) : '...'}`;
        }
        if (actions) {
            const canAct = this.state.phase === 'playing' && isParticipant && !ownStanding;
            actions.hidden = !canAct;
            actions.querySelectorAll('button').forEach(button => { button.disabled = !canAct; });
        }
        if (results) {
            results.hidden = this.state.phase !== 'results';
            results.replaceChildren();
            if (this.state.phase === 'results') {
                this.state.results.forEach(result => {
                    const row = document.createElement('div');
                    row.className = `blackjack-result-row${result.winner ? ' is-winner' : ''}${result.bust ? ' is-bust' : ''}`;
                    const heading = document.createElement('div');
                    heading.className = 'blackjack-result-heading';
                    heading.textContent = `${result.player}: ${result.total}${result.natural ? ' — Blackjack!' : result.bust ? ' — Bust' : ''}${result.winner ? ' — Winner' : ''}`;
                    const hand = document.createElement('div');
                    hand.className = 'blackjack-card-row blackjack-result-hand';
                    this.renderHand(hand, result.cards);
                    row.append(heading, hand);
                    results.appendChild(row);
                });
            }
        }
    }
};

window.Blackjack = Blackjack;
