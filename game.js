// ── UTILITIES ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

if (navigator.audioSession && 'type' in navigator.audioSession) {
    try {
        navigator.audioSession.type = 'ambient';
    } catch (error) {
        console.warn('Could not enable audio mixing with other apps.', error);
    }
};

const Sound = {
    ctx: null,
    volume: 1,
    setVolume(value) {
        const volume = Number(value);
        this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    },
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    play(freq, type, duration) {
        if (this.volume === 0) return;
        try {
            this.init();
            const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
            osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.04 * this.volume, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + duration);
        } catch(e) {}
    },
    draw() {
        this.playSketchSound(false);
    },
    drawRound() {
        this.playSketchSound(true);
    },
    playSketchSound(isRound) {
        if (this.volume === 0) return;
        try {
            this.init();
            const now = this.ctx.currentTime;
            const duration = isRound ? 0.13 : 0.09;
            const oscillator = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(isRound ? 360 : 480, now);
            oscillator.frequency.exponentialRampToValueAtTime(isRound ? 220 : 300, now + duration);
            gain.gain.setValueAtTime(0.035 * this.volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            oscillator.connect(gain);
            gain.connect(this.ctx.destination);
            oscillator.start(now);
            oscillator.stop(now + duration);
        } catch (error) {
            console.warn('Could not synthesize UI sound.', error);
        }
    }
};

// ── QUESTION POOLS (Loaded dynamically) ─────────────────────────────────────────
let QUESTIONS = {};

fetch('questions.json')
    .then(response => {
        if (!response.ok) throw new Error("Network response was not ok");
        return response.json();
    })
    .then(data => {
        QUESTIONS = data;
        QUESTIONS.misc = [];
        for (const cat in QUESTIONS) {
            if (cat !== 'misc' && Array.isArray(QUESTIONS[cat])) {
                QUESTIONS.misc.push(...QUESTIONS[cat]);
            }
        }
        console.log("Questions loaded successfully!");
    })
    .catch(err => {
        console.error("Error loading questions.json:", err);
    });

// ── STATE ──────────────────────────────────────────────────────────────────────
let room = {
    id:'', players:[], currentSubject:'', currentPrompt:'', currentCategory:'classic',
    gameMode: 'classic',
    cards:[], timeLimit:45, playedQuestions:[],
    scores: {},          
    subjectCounts: {},    
    lateJoiners: [],      
    maxRounds: 10,        
    roundCount: 0,        
    roundActive: false,   
    activeWriters: []     
};
let roundTimerInterval = null;
let timeRemaining = 0;
let screenTransitionChangeTime = 0; 

// ── MOBILE ADDRESS BAR HIDING ────────────────────────────────────────────────
window.addEventListener('load', () => {
    window.scrollTo(0, 1);
    setTimeout(() => window.scrollTo(0, 1), 100);
    setTimeout(() => window.scrollTo(0, 1), 500);
});

// ── LOBBY DEFAULTS SYNC ───────────────────────────────────────────────────────
function resetLobbyDefaultsUI() {
    document.querySelectorAll('.deck-pill').forEach(p => p.classList.remove('active'));
    const classicPill = $('deckPillClassic');
    if (classicPill) classicPill.classList.add('active');

    document.querySelectorAll('.round-pill').forEach(p => p.classList.remove('active'));
    const tenRoundsPill = $('roundPill10');
    if (tenRoundsPill) tenRoundsPill.classList.add('active');

    if (typeof CoinMode !== 'undefined' && CoinMode.setGameMode) {
        CoinMode.setGameMode('classic');
    }
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
    $(id).scrollTop = 0;

    if (id === 'scrWriterInput') resizeWriterInput($('writerInput'));
    
    if (id === 'scrRevealStage') {
        screenTransitionChangeTime = Date.now();
    }

    window.scrollTo(0, 1);
    setTimeout(() => window.scrollTo(0, 1), 50);
}

function setCategory(cat, el) {
    room.currentCategory = cat;
    document.querySelectorAll('.deck-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    Sound.draw();
    if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
    if (net.role === 'host') broadcastToAll({ type: 'SYNC_CATEGORY', category: cat });
}

function setMaxRounds(n, el) {
    room.maxRounds = n;
    document.querySelectorAll('.round-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    Sound.drawRound();
    if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
    if (net.role === 'host') broadcastToAll({ type: 'SYNC_MAX_ROUNDS', maxRounds: n });
}

async function copyRoomId(button) {
    const roomId = ($('lobbyIdLabel')?.innerText || '').trim();
    if (!roomId || roomId === '⌛') {
        showToast('Room ID is not ready yet');
        return;
    }

    let copied = false;
    let copyError = null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(roomId);
            copied = true;
        } catch (error) {
            copyError = error;
        }
    }

    if (!copied) {
        const textArea = document.createElement('textarea');
        textArea.value = roomId;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.userSelect = 'text';
        textArea.style.webkitUserSelect = 'text';
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
        console.error('Unable to copy room ID.', copyError);
        showToast('Could not copy Room ID');
        return;
    }

    if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
    if (button) {
        const label = button.querySelector('.copy-room-label');
        const originalLabel = label ? label.innerText : 'Copy Room ID';
        button.classList.add('is-copied');
        button.setAttribute('aria-label', 'Room ID copied');
        if (label) label.innerText = 'Copied!';
        setTimeout(() => {
            button.classList.remove('is-copied');
            button.setAttribute('aria-label', 'Copy Room ID');
            if (label) label.innerText = originalLabel;
        }, 1400);
    }
    showToast('Room ID copied');
}

function finishWritingRound(timedOut = false) {
    if (net.role !== 'host' || !room.roundActive) return;

    clearInterval(roundTimerInterval);
    roundTimerInterval = null;

    if (timedOut) {
        room.activeWriters.forEach(player => {
            if (!room.cards.some(card => card.creator === player)) {
                room.cards.push({ text: '*Ran out of time*', creator: player, revealed: false, selected: false });
            }
        });
    }

    room.roundActive = false;
    room.cards.sort(() => Math.random() - 0.5);
    broadcastToAll({ type: 'GO_TO_REVEAL', cards: getSharedCardState(room.cards), scores: room.scores });
}

function getSharedCardState(cards) {
    return cards.map(card => ({ ...card, revealed: false, revealedAt: null }));
}

function upsertRoundCard(card) {
    const existing = room.cards.findIndex(existingCard => existingCard.creator === card.creator);
    const revealed = existing >= 0 && room.cards[existing].revealed;
    const revealedAt = existing >= 0 ? room.cards[existing].revealedAt : null;
    const sharedCard = { ...card, revealed, revealedAt, selected: existing >= 0 && room.cards[existing].selected };
    if (existing >= 0) room.cards[existing] = sharedCard;
    else room.cards.push(sharedCard);
}

function refreshProgressiveReveal() {
    if (room.cards.length === 0) return;
    const revealActive = $('scrRevealStage').classList.contains('active');
    const subjectWaiting = net.myName === room.currentSubject && $('scrSubjectLounge').classList.contains('active');
    if (subjectWaiting) {
        renderRevealStage();
    } else if (revealActive) {
        CardSystem.setCards(room.cards);
        updateRevealInstructions();
    }
}

function leaveRoom() {
    clearInterval(roundTimerInterval);
    if (window.hostWaitInterval) clearInterval(window.hostWaitInterval);
    if (typeof disconnectPeer === 'function') disconnectPeer();
    room = {
        id:'', players:[], currentSubject:'', currentPrompt:'', currentCategory:'classic',
        gameMode: 'classic',
        cards:[], timeLimit:45, playedQuestions:[],
        scores: {}, subjectCounts: {}, lateJoiners: [], maxRounds: 10, roundCount: 0, roundActive: false, activeWriters: []
    };
    
    $('hostOnlyControls').style.display = 'none';
    $('hostStartBtn').style.display = 'none';
    $('clientWaitNotice').style.display = 'none';
    $('botAddBtn').style.display = 'none';
    $('writerInput').value = "";
    
    showScreen('scrMenu');
    if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
}

// ── WORD COUNTER ─────────────────────────────────────────────
function resizeWriterInput(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = parseFloat(getComputedStyle(textarea).maxHeight);
    textarea.style.height = `${Math.min(textarea.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight)}px`;
}

document.addEventListener('DOMContentLoaded', () => {
    const wi = $('writerInput');
    const cc = $('charCount');
    if (wi && cc) {
        resizeWriterInput(wi);
        wi.addEventListener('input', function() {
            let wordsCount = (this.value.match(/\S+/g) || []).length;
            if (wordsCount > 120) {
                let matched = this.value.match(/^(\s*\S+){120}/);
                if (matched) {
                    this.value = matched[0];
                    wordsCount = 120;
                }
            }
            resizeWriterInput(this);
            cc.innerText = `${wordsCount} / 120 words`;
        });
    }
});

// ── TOAST NOTIFICATION ────────────────────────────────────────────────────────
function showToast(msg) {
    let existing = document.getElementById('gameToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'gameToast';
    toast.className = 'game-toast';
    toast.innerText = msg;
    document.querySelector('.app-container').appendChild(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => { toast.classList.add('visible'); });
    });

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
    }, 3500);
}

// ── NETWORK MESSAGE HANDLING ─────────────────────────────────────────────────
function handleData(data, connection) {
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

    if (net.role === 'host' && connection) {
        const player = connection._playerId && net.roster[connection._playerId];
        if (data.type === 'JOIN') {
            if (player) return;
        } else if (!player || player.conn !== connection || !player.connected) {
            return;
        }

        if (data.type !== 'JOIN' &&
            !['REQUEST_NEXT_ROUND', 'SUBMIT_CARD', 'SELECT_CARD'].includes(data.type)) {
            return;
        }
    } else if (net.role === 'client' && connection && connection !== net.conn) {
        return;
    }

    if (data.type === 'JOIN' && net.role === 'host') {
        if (!connection) return; // a JOIN only ever arrives over a real connection

        // Identity comes from the Insight Player ID in the handshake - never from the
        // display name. attachPlayerConnection() (networking.js) says whether this ID
        // is a player we already have (REJOIN) or a new one (JOIN).
        const who = attachPlayerConnection(connection, data.playerId, data.name);
        const label = who.label;

        // Tell the client which label it plays under (may differ from the typed name if
        // that name was already taken) and whether the host recognised it.
        connection.send({ type: 'JOIN_ACK', label, playerId: who.playerId, rejoined: who.rejoined });

        if (who.rejoined) {
            // Same player on a new connection. Nothing about the game changes: same roster
            // entry, score, role, submission and round membership. Explicitly NOT the
            // late-join path (no lateJoiners entry, no CATCH_UP, no PLAYER_JOINED_LATE).
            if (!(label in room.scores)) room.scores[label] = 0;
            if (room.gameMode !== 'coin') {
                connection.send(buildRejoinSync(label));
            } else if (coinState.active) {
                connection.send(CoinMode.getSyncState());
            }
            broadcastToAll({ type: 'PLAYER_STATUS', name: label, status: 'rejoined' });
            return;
        }

        // Genuinely new player.
        room.players.push(label);
        if (!(label in room.scores)) room.scores[label] = 0;

        if (room.roundActive) {
            if (!room.lateJoiners.includes(label)) room.lateJoiners.push(label);

            connection.send({
                type: 'CATCH_UP',
                subject: room.currentSubject,
                prompt: room.currentPrompt,
                category: room.currentCategory,
                cards: getSharedCardState(room.cards),
                scores: room.scores,
                lateJoiners: room.lateJoiners,
                maxRounds: room.maxRounds,
                roundCount: room.roundCount
            });

            broadcastToAll({
                type: 'PLAYER_JOINED_LATE',
                name: label,
                players: room.players,
                lateJoiners: room.lateJoiners,
                scores: room.scores
            });
        } else {
            broadcastToAll({
                type: 'SYNC_LOBBY',
                players: room.players,
                category: room.currentCategory,
                gameMode: room.gameMode,
                playedQuestions: room.playedQuestions,
                maxRounds: room.maxRounds,
                roundCount: room.roundCount,
                scores: room.scores,
                lateJoiners: room.lateJoiners
            });
            if (typeof updateLobbyUI === 'function') updateLobbyUI();
        }

        if (room.gameMode === 'coin' && coinState.active) {
            connection.send(CoinMode.getSyncState());
        }
    }
    else if (data.type === 'SYNC_LOBBY') {
        room.players = data.players;
        room.currentCategory = data.category;
        if (data.gameMode) room.gameMode = data.gameMode;
        room.playedQuestions = data.playedQuestions || [];
        if (data.maxRounds !== undefined) room.maxRounds = data.maxRounds;
        if (data.roundCount !== undefined) room.roundCount = data.roundCount;
        if (data.scores !== undefined) room.scores = data.scores;
        if (data.lateJoiners !== undefined) room.lateJoiners = data.lateJoiners;
        if (typeof updateLobbyUI === 'function') updateLobbyUI();
    }
    else if (data.type === 'SYNC_CATEGORY') {
        room.currentCategory = data.category;
    }
    else if (data.type === 'SYNC_MAX_ROUNDS') {
        room.maxRounds = data.maxRounds;
    }
    else if (data.type === 'START_ROUND') {
        room.currentSubject  = data.subject;
        room.currentPrompt   = data.prompt;
        room.currentCategory = data.category;
        if (data.rawQuestion) {
            room.playedQuestions.push(data.rawQuestion);
        }
        if (data.roundCount !== undefined) room.roundCount = data.roundCount;
        if (data.lateJoiners !== undefined) room.lateJoiners = data.lateJoiners;
        room.cards = [];
        room.roundActive = true;
        startRoundExecution();
    }
    else if (data.type === 'REQUEST_NEXT_ROUND' && net.role === 'host') {
        if (connection && connection._kickName !== room.currentSubject) return;
        if (window.hostWaitInterval) {
            clearInterval(window.hostWaitInterval);
            window.hostWaitInterval = null;
        }
        broadcastStartRound();
    }
    else if (data.type === 'SUBMIT_CARD' && net.role === 'host') {
        if (!room.roundActive) return;
        const creator = connection ? connection._kickName : data.creator;
        if (!room.activeWriters.includes(creator) || typeof data.text !== 'string') return;
        if (!room.cards.some(c => c.creator === creator)) {
            const text = data.text.trim();
            if (!text) return;
            const card = { text, creator, revealed: false, selected: false };
            upsertRoundCard(card);
            broadcastToConnections({
                type: 'CARD_SUBMITTED',
                card: { text, creator },
                count: room.cards.length,
                total: room.activeWriters.length
            });
            $('submissionTrackLabel').innerText = `${room.cards.length} of ${room.activeWriters.length} cards locked in...`;
            refreshProgressiveReveal();
            if (room.cards.length >= room.activeWriters.length) {
                finishWritingRound();
            }
        }
    }
    else if (data.type === 'CARD_SUBMITTED') {
        if (!data.card || typeof data.card.creator !== 'string' || typeof data.card.text !== 'string') return;
        upsertRoundCard(data.card);
        if (data.count !== undefined && data.total !== undefined && $('submissionTrackLabel')) {
            $('submissionTrackLabel').innerText = `${data.count} of ${data.total} cards locked in...`;
        }
        refreshProgressiveReveal();
    }
    else if (data.type === 'GO_TO_REVEAL') {
        const localRevealState = new Map(room.cards.map(card => [card.creator, {
            revealed: card.revealed,
            revealedAt: card.revealedAt
        }]));
        room.cards = (data.cards || []).map(card => {
            const localState = localRevealState.get(card.creator);
            return {
                ...card,
                revealed: !!(localState && localState.revealed),
                revealedAt: localState ? localState.revealedAt : null
            };
        });
        if (data.scores !== undefined) room.scores = data.scores;
        room.roundActive = false;
        clearInterval(roundTimerInterval);
        renderRevealStage();
    }
    else if (data.type === 'SELECT_CARD') {
        if (net.role === 'host' && connection && connection._kickName !== room.currentSubject) return;
        if (!Number.isInteger(data.index)) return;
        const card = room.cards[data.index];
        if (!card || room.roundActive || room.cards.some(c => c.selected && c !== card) || card.winnerScored) return;
        room.cards.forEach((c,i) => c.selected = (i === data.index));
        if (window.CardSystem) CardSystem.render();

        if (net.role === 'host') {
            const winner = card.creator;
            room.scores[winner] = (room.scores[winner] || 0) + 1;
            card.winnerScored = true;
            broadcastToAll({ type: 'SYNC_SCORES', scores: room.scores });
            // Tell every client which card was picked, not just whoever sent it -
            // this was previously echoed back to the originating connection only.
            broadcastToConnections(data);
        }

        updateRevealInstructions();
        
        if ($('scrRevealStage').classList.contains('active')) {
            updateNextRoundButtonState();
        }
    }
    else if (data.type === 'SYNC_SCORES') {
        room.scores = data.scores;
    }
    else if (data.type === 'TIMER_TICK') {
        document.querySelectorAll('.timer-display').forEach(d => {
            d.innerText = `0:${data.t.toString().padStart(2,'0')}`;
        });
    }
    else if (data.type === 'GAME_OVER') {
        if (data.scores !== undefined) room.scores = data.scores;
        if (data.lateJoiners !== undefined) room.lateJoiners = data.lateJoiners;
        executeGameOverUI();
    }
    else if (data.type === 'KICKED') {
        leaveRoom();
        alert("You were removed from the room by the host.");
    }
    else if (data.type === 'CATCH_UP') {
        room.currentSubject  = data.subject;
        room.currentPrompt   = data.prompt;
        room.currentCategory = data.category;
        room.cards           = data.cards || [];
        room.scores          = data.scores || {};
        room.lateJoiners     = data.lateJoiners || [];
        room.maxRounds       = data.maxRounds || room.maxRounds;
        room.roundCount      = data.roundCount || room.roundCount;
        room.roundActive     = true;

        $('revealPromptLabel').innerText  = room.currentPrompt;
        $('revealInstructions').innerText = `You joined mid-round - sit tight for the next one!`;
        $('nextRoundBtn').style.display   = 'none';

        const container = $('cardsWrapper');
        container.innerHTML = `
            <div class="late-join-notice">
                Round in progress...<br>
                <span>You'll be a full player starting next round.</span>
            </div>
        `;
        showScreen('scrRevealStage');
    }
    else if (data.type === 'REJOIN_SYNC') {
        // Host's authoritative snapshot for a player it recognised by Player ID. Applied
        // idempotently, so it works both after a brief drop (local state still there) and
        // after a page reload (local state gone).
        if (net.role === 'host') return;
        if (data.label) net.myName = data.label;

        const onWriteScreen = $('scrWriterInput').classList.contains('active') ||
                              $('scrSubjectLounge').classList.contains('active');
        const sameRound = onWriteScreen && room.roundCount === data.roundCount && room.currentPrompt === data.prompt;

        room.players         = data.players || room.players;
        room.currentSubject  = data.subject;
        room.currentPrompt   = data.prompt;
        room.currentCategory = data.category;
        if (data.gameMode) room.gameMode = data.gameMode;
        room.playedQuestions = data.playedQuestions || [];
        room.cards           = data.cards || [];
        room.scores          = data.scores || {};
        room.lateJoiners     = data.lateJoiners || [];
        if (data.maxRounds !== undefined) room.maxRounds = data.maxRounds;
        if (data.roundCount !== undefined) room.roundCount = data.roundCount;
        room.roundActive     = (data.phase === 'writing');

        if (data.phase === 'writing') {
            if (room.lateJoiners.includes(net.myName)) {
                // Joined late this round and dropped: still a spectator until next round.
                handleData({
                    type: 'CATCH_UP', subject: data.subject, prompt: data.prompt, category: data.category,
                    cards: [], scores: data.scores, lateJoiners: data.lateJoiners,
                    maxRounds: data.maxRounds, roundCount: data.roundCount
                }, null);
            } else if (data.hasSubmitted || (net.myName === room.currentSubject && room.cards.length > 0)) {
                renderRevealStage();
            } else {
                restoreWritingScreen(sameRound, !!data.hasSubmitted, data.cardCount || 0, data.totalWriters || 0);
            }
        } else if (data.phase === 'reveal') {
            renderRevealStage();
        } else if (data.phase === 'gameover') {
            executeGameOverUI();
        } else {
            if (typeof updateLobbyUI === 'function') updateLobbyUI();
            showScreen('scrLobby');
        }
    }
    else if (data.type === 'PLAYER_STATUS') {
        if (data.name === net.myName) return;
        if (data.status === 'disconnected') showToast(`${data.name} disconnected`);
        else if (data.status === 'rejoined') {
            showToast(`${data.name} rejoined`);
            if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
        }
    }
    else if (data.type === 'PLAYER_JOINED_LATE') {
        room.players    = data.players;
        room.lateJoiners = data.lateJoiners || room.lateJoiners;
        room.scores     = data.scores || room.scores;
        if (!room.lateJoiners.includes(data.name)) room.lateJoiners.push(data.name);
        if (typeof updateLobbyUI === 'function') updateLobbyUI();
        showToast(`${data.name} joined the game!`);
        if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
    }
}

// ── NETWORK STATUS HANDLING (connection lifecycle, not game messages) ───────
function handleNetworkStatus(status, detail) {
    if (status === 'player-disconnected' && net.role === 'host') {
        // Connection dropped. The player keeps their seat, score and round state during
        // the grace period (networking.js); everyone just gets told.
        const name = detail && detail.name;
        if (name && room.players.includes(name)) {
            broadcastToAll({ type: 'PLAYER_STATUS', name, status: 'disconnected' });
        }
    } else if (status === 'player-left' && net.role === 'host') {
        // Grace period expired (or the player left on purpose). Only now is the player
        // pruned from the roster.
        const name = detail && detail.name;
        if (name && room.players.includes(name)) {
            room.players = room.players.filter(p => p !== name);
            delete room.scores[name];
            broadcastToAll({
                type: 'SYNC_LOBBY',
                players: room.players,
                category: room.currentCategory,
                gameMode: room.gameMode,
                playedQuestions: room.playedQuestions,
                maxRounds: room.maxRounds,
                roundCount: room.roundCount,
                scores: room.scores,
                lateJoiners: room.lateJoiners
            });
            if (typeof updateLobbyUI === 'function') updateLobbyUI();
            showToast(`${name} left the game`);
        }
    } else if (status === 'disconnected' && net.role === 'client') {
        showToast('Connection lost. Reconnecting...');
    } else if (status === 'connected' && net.role === 'client') {
        showToast(detail && detail.rejoined === false
            ? 'You were removed while offline - rejoined as a new player'
            : 'Reconnected!');
    } else if (status === 'replaced' && net.role === 'client') {
        leaveRoom();
        alert("You joined this room from another tab or device, so this session was closed.");
    } else if (status === 'reconnect-failed' && net.role === 'client') {
        showToast('Could not reconnect. Please rejoin the room.');
    }
}

// Register with networking.js. This dispatcher routes COIN_* messages to
// CoinMode.handleNetwork and everything else to the local handleData above.
// NOTE: coinMode.js also tries to wrap window.handleData at load time to do
// this same routing, but script order (coinMode.js loads before game.js
// defines `handleData`) means that wrapper gets silently overwritten by this
// file's top-level `function handleData` declaration - so that interceptor
// never actually runs. Doing the routing here instead makes it work
// regardless of load order and is the single place messages are dispatched.
function _routeNetworkMessage(data, connection) {
    if (data && data.type && data.type.startsWith('COIN_') && typeof CoinMode !== 'undefined') {
        CoinMode.handleNetwork(data, connection);
    } else {
        handleData(data, connection);
    }
}

function _wireNetworkCallbacks() {
    if (typeof onNetworkData === 'function') {
        onNetworkData(_routeNetworkMessage);
    }
    if (typeof onNetworkStatus === 'function') {
        onNetworkStatus(handleNetworkStatus);
    }
}

if (typeof onNetworkData === 'function') {
    _wireNetworkCallbacks();
} else {
    document.addEventListener('DOMContentLoaded', _wireNetworkCallbacks);
}

// ── REJOIN SNAPSHOT (host -> a recognised returning player) ───────────────────
// Phase is derived from what the host is actually showing/doing; classic mode only.
function buildRejoinSync(label) {
    let phase = 'lobby';
    if (room.roundActive) {
        phase = 'writing';
    } else if ($('scrRevealStage').classList.contains('active')) {
        phase = $('cardsWrapper').querySelector('.scoreboard') ? 'gameover' : 'reveal';
    }
    return {
        type: 'REJOIN_SYNC',
        phase,
        label,
        players: room.players,
        subject: room.currentSubject,
        prompt: room.currentPrompt,
        category: room.currentCategory,
        gameMode: room.gameMode,
        playedQuestions: room.playedQuestions,
        maxRounds: room.maxRounds,
        roundCount: room.roundCount,
        scores: room.scores,
        lateJoiners: room.lateJoiners,
        cards: getSharedCardState(room.cards),
        hasSubmitted: room.cards.some(c => c.creator === label),
        cardCount: room.cards.length,
        totalWriters: room.activeWriters.length
    };
}

// Client: put a returning writer/subject back on the right screen for the round in
// progress, WITHOUT the round-start reset (which would wipe their typed answer) when
// they are already in this round. Submission state comes from the host's truth.
function restoreWritingScreen(sameRound, hasSubmitted, cardCount, totalWriters) {
    if (net.myName === room.currentSubject) {
        if (!$('scrSubjectLounge').classList.contains('active')) {
            $('subjectPromptBox').style.display = 'none';
            showScreen('scrSubjectLounge');
            requestAnimationFrame(() => setupFidgets());
        }
        $('submissionTrackLabel').innerText = `${cardCount} of ${totalWriters} cards locked in...`;
    } else {
        if (!sameRound) {
            $('writerInput').value   = "";
            $('charCount').innerText = "0 / 120 words";
        }
        $('writerCategoryLabel').innerText = (room.currentCategory === 'classic' ? 'party' : room.currentCategory).toUpperCase();
        $('activePromptLabel').innerText   = room.currentPrompt;
        if (!$('scrWriterInput').classList.contains('active')) showScreen('scrWriterInput');
        // Host is the source of truth: if a submit was lost in the outage this re-enables the button.
        $('lockInBtn').disabled  = hasSubmitted;
        $('lockInBtn').innerText = hasSubmitted ? "Locked" : "Lock In Card";
    }
}

// ── ROUND FLOW ─────────────────────────────────────────────────────────────────
function broadcastStartRound() {
    if (room.players.length < 3) { alert("Need at least 3 players!"); return; }

    if (room.gameMode === 'coin') {
        CoinMode.startRound();
        return;
    }

    room.subjectCounts = room.subjectCounts || {};

    const initialPool = QUESTIONS[room.currentCategory] || QUESTIONS.spicy;
    if (!initialPool || initialPool.length === 0) {
        alert("Questions are still loading from the server! Give it a second or refresh the page.");
        return;
    }

    room.lateJoiners = [];

    if (room.maxRounds !== 'unlimited' && room.roundCount >= room.maxRounds) {
        broadcastToAll({ type: 'GAME_OVER', scores: room.scores, lateJoiners: room.lateJoiners });
        return;
    }
    
    const pool = QUESTIONS[room.currentCategory] || QUESTIONS.spicy;
    const unusedQuestions = pool.filter(q => !room.playedQuestions.includes(q));
    
    if (unusedQuestions.length === 0) {
        broadcastToAll({ type: 'GAME_OVER', scores: room.scores, lateJoiners: room.lateJoiners });
        return;
    }
    
    const eligible = room.players.filter(p => p !== room.currentSubject);
    
    let minCount = Infinity;
    eligible.forEach(p => {
        const count = (room.subjectCounts || {})[p] || 0;
        if (count < minCount) minCount = count;
    });

    const fairestPool = eligible.filter(p => ((room.subjectCounts || {})[p] || 0) === minCount);
    const subject  = fairestPool[Math.floor(Math.random() * fairestPool.length)];
    
    room.subjectCounts = room.subjectCounts || {};
    room.subjectCounts[subject] = (room.subjectCounts[subject] || 0) + 1;

    const raw      = unusedQuestions[Math.floor(Math.random() * unusedQuestions.length)];
    const prompt   = raw.replace(/\[Subject\]/g, subject);

    room.roundCount++;
    room.activeWriters = room.players.filter(p => p !== subject && !p.startsWith('bot_late'));

    room.players.forEach(p => {
        if (!(p in room.scores)) room.scores[p] = 0;
    });
    
    broadcastToAll({
        type: 'START_ROUND',
        subject,
        prompt,
        category: room.currentCategory,
        rawQuestion: raw,
        roundCount: room.roundCount,
        lateJoiners: room.lateJoiners
    });
}

function startRoundExecution() {
    $('lockInBtn').disabled  = false;
    $('lockInBtn').innerText = "Lock In Card";
    $('writerInput').value   = "";
    $('charCount').innerText = "0 / 120 words";

    if (net.role === 'host') {
        clearInterval(roundTimerInterval);
        roundTimerInterval = null;
        timeRemaining = room.timeLimit;
        broadcastToAll({ type: 'TIMER_TICK', t: timeRemaining });
        roundTimerInterval = setInterval(() => {
            if (!room.roundActive) {
                clearInterval(roundTimerInterval);
                roundTimerInterval = null;
                return;
            }
            timeRemaining = Math.max(0, timeRemaining - 1);
            broadcastToAll({ type: 'TIMER_TICK', t: timeRemaining });
            if (timeRemaining === 0) {
                clearInterval(roundTimerInterval);
                roundTimerInterval = null;
                if (net.myName !== room.currentSubject && !$('lockInBtn').disabled) {
                    const val = $('writerInput').value.trim();
                    $('writerInput').value = val || '*Ran out of time*';
                    submitWriterCard();
                }
                finishWritingRound(true);
            }
        }, 1000);

        if (typeof Bots !== 'undefined') {
            Bots.scheduleClassicAnswers(
                room.players,
                room.currentSubject,
                () => room.roundActive,
                player => room.cards.some(card => card.creator === player),
                payload => handleData(payload, null)
            );
        }
    }

    if (net.myName === room.currentSubject) {
        $('subjectPromptBox').style.display = 'none';
        $('submissionTrackLabel').innerText = "0 cards locked in...";
        showScreen('scrSubjectLounge');
        requestAnimationFrame(() => setupFidgets());
    } else {
        $('writerCategoryLabel').innerText = (room.currentCategory === 'classic' ? 'party' : room.currentCategory).toUpperCase();
        $('activePromptLabel').innerText   = room.currentPrompt;
        showScreen('scrWriterInput');
    }
}

function submitWriterCard() {
    if (net.myName === room.currentSubject || !room.roundActive) return;
    const txt = $('writerInput').value.trim();
    if (!txt) return;

    if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
    $('lockInBtn').disabled  = true;
    $('lockInBtn').innerText = "Locked";

    const payload = { type: 'SUBMIT_CARD', text: txt, creator: net.myName };
    if (net.role === 'host') handleData(payload, null);
    else {
        upsertRoundCard({ text: txt, creator: net.myName, revealed: false, selected: false });
        net.conn.send(payload);
    }
    renderRevealStage();
}

// ── REVEAL STAGE ───────────────────────────────────────────────────────────────
function updateRevealInstructions() {
    const selectedCard = room.cards.find(card => card.selected);
    $('revealInstructions').innerText = selectedCard
        ? `${selectedCard.creator || 'A player'} wins! ${room.currentSubject} picked the winning card.`
        : room.roundActive && net.myName === room.currentSubject
            ? "Cards are arriving. Double-tap to reveal; choose a winner when everyone has submitted."
            : room.roundActive
                ? "Cards appear as players submit. Double-tap to reveal cards on your screen."
                : net.myName === room.currentSubject
                    ? "Double-tap to reveal cards, then pick a favourite to win!"
                    : `${room.currentSubject} is choosing a winner...`;
}

function renderRevealStage() {
    if (window.hostWaitInterval) {
        clearInterval(window.hostWaitInterval);
        window.hostWaitInterval = null;
    }

    $('revealPromptLabel').innerText = room.currentPrompt;
    
    const pool = QUESTIONS[room.currentCategory] || QUESTIONS.spicy;
    const outOfPrompts = pool.every(q => room.playedQuestions.includes(q));
    const roundLimitReached = (room.maxRounds !== 'unlimited') && (room.roundCount >= room.maxRounds);
    const isMeSubject = (net.myName === room.currentSubject);
    const isHost = (net.role === 'host');
    const gameOver = outOfPrompts || roundLimitReached;

    let nextBtn = $('nextRoundBtn');

    if (room.roundActive) {
        nextBtn.style.display = "none";
    } else if (gameOver) {
        if (isHost) {
            nextBtn.style.display = "block";
            nextBtn.disabled = false;
            nextBtn.innerText = roundLimitReached
                ? `End Game (Round ${room.roundCount}/${room.maxRounds})`
                : "End Game (No Prompts Left)";
            nextBtn.onclick = () => {
                if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
                broadcastToAll({ type: 'GAME_OVER', scores: room.scores, lateJoiners: room.lateJoiners });
            };
        } else {
            nextBtn.style.display = "none";
        }
    } else {
        updateNextRoundButtonState();
    }

    updateRevealInstructions();

    const container = $('cardsWrapper');

    CardSystem.init(container, room.cards, {
        isMeSubject: isMeSubject && !room.roundActive,
        screenTransitionTime: screenTransitionChangeTime,
        onFlip: (idx) => {
            room.cards[idx].revealed = true;
            room.cards[idx].revealedAt = Date.now();
            syncRevealCard(idx);
        },
        onUnflip: (idx) => {
            room.cards[idx].revealed = false;
            room.cards[idx].revealedAt = null;
            syncRevealCard(idx);
        },
        onSelect: (idx) => {
            const payload = { type: 'SELECT_CARD', index: idx };
            room.cards.forEach((c, i) => c.selected = (i === idx));
            CardSystem.render();
            if (net.role === 'host') handleData(payload, null);
            else net.conn.send(payload);
        }
    });

    showScreen('scrRevealStage');

        if (net.role === 'host' && Bots.isBot(room.currentSubject)) {
        let currentFlipIdx = 0;
            let botWinnerChosen = false;
        function autoProcessBotSubject() {
            if (!$('scrRevealStage').classList.contains('active')) return;
            
            if (currentFlipIdx < room.cards.length) {
                if (!room.cards[currentFlipIdx].revealed) {
                    room.cards[currentFlipIdx].revealed = true;
                    syncRevealCard(currentFlipIdx);
                }
                currentFlipIdx++;
                setTimeout(autoProcessBotSubject, 1500);
            } else {
                const checkUnselected = room.cards.every(c => !c.selected);
                if (checkUnselected && room.cards.length > 0 && !botWinnerChosen) {
                    botWinnerChosen = true;
                    const winningIdx = Math.floor(Math.random() * room.cards.length);
                    room.cards.forEach((c, i) => c.selected = (i === winningIdx));
                    CardSystem.render();
                    const selection = { type: 'SELECT_CARD', index: winningIdx };
                    handleData(selection, null);
                }
            }
        }
        setTimeout(autoProcessBotSubject, 2000);
    }
}

function syncRevealCard(idx) {
    if (window.CardSystem) {
        CardSystem.syncCard(idx, room.cards[idx]);
    }
}

// ── GAME OVER / SCOREBOARD ────────────────────────────────────────────────────
function executeGameOverUI() {
    clearInterval(roundTimerInterval);
    room.roundActive = false;

    $('revealPromptLabel').innerText  = `Game Over - ${room.roundCount} Round${room.roundCount !== 1 ? 's' : ''} Played`;
    $('revealInstructions').innerText = "Final Results";

    const humanPlayers = room.players.filter(p => !p.startsWith('bot'));
    const sorted = [...humanPlayers].sort((a, b) => (room.scores[b] || 0) - (room.scores[a] || 0));

    const svg1st = `<svg viewBox="0 0 962.689 962.689" fill="currentColor" width="28" height="28"><path d="M254.233,833.65l115.735,129.039l111.377-275.766l111.377,275.766L708.457,833.65l172.888,12.469L734.478,482.484 c35.706-51.094,54.944-111.771,54.944-175.408c0-82.023-31.941-159.138-89.941-217.137C641.481,31.941,564.368,0,482.345,0 S323.208,31.941,265.209,89.94c-58,57.999-89.941,135.113-89.941,217.137c0,62.88,18.792,122.864,53.685,173.573L81.345,846.119 L254.233,833.65z M482.345,68c63.86,0,123.896,24.868,169.053,70.024c45.156,45.155,70.024,105.193,70.024,169.053 c0,33.158-6.72,65.28-19.489,94.829c-10.885,25.191-26.171,48.508-45.473,68.99c-1.661,1.764-3.342,3.513-5.063,5.232 c-30.952,30.954-68.897,52.37-110.272,62.782c-14.146,3.561-28.693,5.82-43.498,6.748c-5.067,0.316-10.16,0.494-15.282,0.494 c-5.779,0-11.526-0.209-17.234-0.613c-14.914-1.057-29.555-3.488-43.784-7.217c-40.504-10.615-77.643-31.801-108.035-62.194 c-2.206-2.205-4.349-4.457-6.457-6.731c-19.25-20.774-34.424-44.396-45.108-69.894c-12.103-28.885-18.459-60.167-18.459-92.428 c0-63.859,24.868-123.897,70.024-169.053C358.447,92.868,418.484,68,482.345,68z M777.445,770.449l-97.351-7.021l-65.168,72.66 l-90.778-224.762c59.204-8.01,114.369-32.984,159.727-72.555L777.445,770.449z M279.341,537.469 c45.152,39.895,100.174,65.229,159.303,73.602l-90.881,225.02l-65.168-72.66l-97.351,7.02L279.341,537.469z"></path><polygon points="464.764,260.005 464.764,437.148 464.764,450.542 464.764,459.668 520.521,459.668 532.764,459.668 532.764,423.078 532.764,132.962 375.254,237.944 412.968,294.528"></polygon></svg>`;
    const svg2nd = `<svg viewBox="0 0 64 64" fill="currentColor" width="28" height="28"><path d="M44.656 26.519v-8.698c0-.364-.199-.67-.48-.86L54 2H35.164L32 6.746L28.836 2H10l9.822 14.96c-.281.19-.48.497-.48.861v8.698C14.861 30.187 12 35.758 12 42c0 11.045 8.955 20 20 20c.682 0 1.354-.035 2.018-.102C44.115 60.887 52 52.365 52 42c0-6.242-2.863-11.813-7.344-15.481M40.826 3h6.328l-8.826 13.239l-3.164-4.746L40.826 3m.666 17.985l.973-1.458c.053.125.082.261.082.404v4.219a.99.99 0 0 1-.297.7C39.25 23.052 35.752 22 32 22a19.87 19.87 0 0 0-10.252 2.851a1 1 0 0 1-.297-.701v-4.219c0-.143.031-.28.082-.404l.973 1.459h18.986zM16.846 3h6.328l11.324 16.985H28.17L16.846 3M32 59c-9.389 0-17-7.611-17-17c0-9.388 7.611-17 17-17c9.387 0 17 7.612 17 17c0 9.389-7.613 17-17 17"></path><path d="M32.236 26.546c-8.666 0-15.691 7.036-15.691 15.718c0 2.59.637 5.025 1.744 7.178a17.44 17.44 0 0 1-.871-5.432c0-9.203 7.109-16.725 16.127-17.397a15.711 15.711 0 0 0-1.309-.067"></path><path d="M38.533 55.139a17.733 17.733 0 0 1-4.988 2.316a15.905 15.905 0 0 0 6.918-2.578c7.203-4.842 9.158-14.5 4.367-21.576c-.244-.36-.508-.698-.777-1.031c4.427 7.736 2.117 17.736-5.52 22.869"></path><path d="M38.448 49.207h-9.104v-2.275a3.036 3.036 0 0 1 3.034-3.035a6.067 6.067 0 0 0 6.069-6.068c0-2.957-1.5-6.828-6.827-6.828c-3.549 0-6.069 2.695-6.069 6.828h3.793c0-1.561 1.177-3.002 2.702-3.002c1.816 0 2.608 1.195 2.608 2.244a3.034 3.034 0 0 1-3.034 3.033a6.069 6.069 0 0 0-6.069 6.07V53h12.896v-3.793z"></path></svg>`;
    const svg3rd = `<svg viewBox="0 0 64 64" fill="currentColor" width="28" height="28"><path d="M44.656 26.521v-8.697a1.04 1.04 0 0 0-.48-.861L54 2H35.164L32 6.747L28.836 2H10l9.822 14.961a1.04 1.04 0 0 0-.48.861v8.697C14.861 30.188 12 35.759 12 42.001C12 53.046 20.955 62 32 62c.682 0 1.354-.035 2.018-.102C44.115 60.888 52 52.366 52 42.001c0-6.242-2.863-11.813-7.344-15.48M40.826 3h6.328l-8.826 13.24l-3.164-4.746L40.826 3m.666 17.987l.973-1.459c.053.125.082.26.082.404v4.219a.984.984 0 0 1-.297.699C39.25 23.053 35.752 22 32 22a19.861 19.861 0 0 0-10.252 2.852a1.002 1.002 0 0 1-.297-.701v-4.219c0-.145.031-.281.082-.404l.973 1.459h18.986M16.846 3h6.328l11.324 16.987H28.17L16.846 3M32 59.001c-9.389 0-17-7.611-17-17s7.611-17 17-17c9.387 0 17 7.611 17 17s-7.613 17-17 17"></path><path d="M32.236 26.548c-8.666 0-15.691 7.037-15.691 15.717c0 2.59.637 5.025 1.744 7.18a17.461 17.461 0 0 1-.871-5.434c0-9.203 7.109-16.725 16.127-17.396a15.667 15.667 0 0 0-1.309-.067"></path><path d="M38.533 55.14a17.623 17.623 0 0 1-4.988 2.316a15.855 15.855 0 0 0 6.918-2.578c7.203-4.842 9.158-14.5 4.369-21.576a16.633 16.633 0 0 0-.777-1.031c4.425 7.736 2.113 17.736-5.522 22.869"></path><path d="M38.875 46.169c0-1.305-.355-2.416-1.065-3.337c-.711-.921-1.659-1.514-2.845-1.778c1.985-1.127 2.979-2.636 2.979-4.526c0-1.333-.485-2.526-1.454-3.585c-1.176-1.295-2.739-1.94-4.687-1.94c-1.139 0-2.167.223-3.084.669c-.919.445-1.634 1.058-2.146 1.837c-.513.778-.896 1.819-1.15 3.123l3.655.646c.104-.941.396-1.655.876-2.146a2.34 2.34 0 0 1 1.736-.734c.687 0 1.238.216 1.652.647c.414.43.621 1.008.621 1.733c0 .853-.283 1.536-.848 2.05c-.564.515-1.384.758-2.457.729l-.438 3.365c.706-.206 1.313-.309 1.822-.309c.771 0 1.425.303 1.962.911c.537.606.806 1.43.806 2.468c0 1.099-.28 1.97-.841 2.617c-.561.646-1.25.97-2.068.97c-.763 0-1.412-.271-1.948-.809s-.865-1.318-.988-2.338l-3.84.486c.198 1.812.913 3.278 2.146 4.401c1.233 1.121 2.786 1.683 4.659 1.683c1.976 0 3.627-.667 4.955-1.999c1.327-1.332 1.99-2.943 1.99-4.834"></path></svg>`;
    const medals = [svg1st, svg2nd, svg3rd];

    const container = $('cardsWrapper');
    container.innerHTML = "";

    const board = document.createElement('div');
    board.className = 'scoreboard';

    const title = document.createElement('div');
    title.className = 'scoreboard-title';
    title.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21l8 0" /><path d="M12 17l0 4" /><path d="M7 4l10 0" /><path d="M17 4v8a5 5 0 0 1 -10 0v-8" /><path d="M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /></svg> Final Scores`;
    board.appendChild(title);

    sorted.forEach((name, rank) => {
        const pts   = room.scores[name] || 0;
        const isMe  = name === net.myName;
        const isLate = room.lateJoiners.includes(name);

        const row = document.createElement('div');
        row.className = 'scoreboard-row' + (isMe ? ' scoreboard-row--me' : '');

        const left = document.createElement('div');
        left.className = 'scoreboard-left';

        const medal = document.createElement('span');
        medal.className = 'scoreboard-medal';
        medal.innerHTML = medals[rank] || `${rank + 1}.`;

        const nameEl = document.createElement('span');
        nameEl.className = 'scoreboard-name';
        nameEl.innerText = name + (isMe ? ' (you)' : '');

        if (isLate) {
            const badge = document.createElement('span');
            badge.className = 'late-badge';
            badge.innerText = 'late';
            nameEl.appendChild(badge);
        }

        left.appendChild(medal);
        left.appendChild(nameEl);

        const right = document.createElement('div');
        right.className = 'scoreboard-points';
        right.innerText = `${pts} pt${pts !== 1 ? 's' : ''}`;

        row.appendChild(left);
        row.appendChild(right);
        board.appendChild(row);
    });

    container.appendChild(board);

    if (net.role === 'host') {
        $('nextRoundBtn').style.display = "block";
        $('nextRoundBtn').innerText = "Return to Lobby";
        $('nextRoundBtn').onclick = () => {
            if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
            room.playedQuestions = [];
            room.roundCount      = 0;
            room.scores          = {};
            room.lateJoiners     = [];
            broadcastToAll({
                type: 'SYNC_LOBBY',
                players: room.players,
                category: room.currentCategory,
                playedQuestions: [],
                maxRounds: room.maxRounds,
                roundCount: 0,
                scores: {},
                lateJoiners: []
            });
            showScreen('scrLobby');
        };
    } else {
        $('nextRoundBtn').style.display = "none";
    }

    showScreen('scrRevealStage');
}

function setupFidgets() {
    const board = document.querySelector('#scrSubjectLounge .fidget-board');
    if (board) board.style.display = 'grid';

    if (typeof Fidget === 'undefined') {
        setTimeout(setupFidgets, 100);
        return;
    }

    Fidget.setup({ clickerId: 'toyClicker', toggleId: 'toyToggle', bubbleGridId: 'toyBubbleGrid' });
}