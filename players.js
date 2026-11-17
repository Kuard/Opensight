// ── PLAYERS ────────────────────────────────────────────────────────────────────
// Player-roster management for Insight (Classic Mode + Coin Mode share this).
//
// This file owns WHO the players are: creating a local player's display name,
// rendering the lobby roster, and adding/removing players from that roster.
//
// It does NOT own what players are doing in the game (subject selection,
// scoring, round progression, card state) - that remains in game.js, which
// still owns `room` (including `room.players`) as shared state, since the
// player list is stored alongside tightly-related round/game state
// (room.scores, room.subjectCounts, room.activeWriters, etc.) that a full
// split would risk destabilizing. See the "could not safely be separated"
// notes for why room.players itself stays put.
//
// This file depends on globals provided elsewhere, unchanged from before:
//   - `room`, `net`, `$`, `Sound`, `Vibrate`   (game.js / vibrations.js / networking.js)
//   - `broadcastToAll`, `disconnectPlayerConnection`   (networking.js)
// It must load after vibrations.js and networking.js, and before game.js
// (game.js's handleData() and lobby-sync branches call these functions).
// The game.js globals are read only when these function bodies run, after every
// script has loaded; they do not need to exist while this file is being parsed.

const LOBBY_MODE_DESCRIPTIONS = {
    classic: 'Answer prompts, reveal responses, and pick a favorite.',
    coin: 'Choose a target and a secret side, then flip the coin on your phone.',
    casino: 'Spin the phone slot machine or play a hand of Blackjack.',
    openbox: 'Write convincing answers or a True/False question, then make private predictions.'
};

const LOBBY_CATEGORY_DESCRIPTIONS = {
    classic: {
        classic: 'Light, quick party prompts made for funny answers.',
        trouble: 'Mischievous prompts; keep it playful and respect the room.',
        spicy: 'More daring prompts. Skip anything that makes you uncomfortable.',
        deep: 'Reflective prompts. Share only what you are comfortable sharing.',
        flirt: 'Playful flirting prompts; keep it consensual and comfortable.',
        trash: 'Silly, chaotic prompts that are intentionally low-stakes.',
        nsfw: 'Adult-only prompts. Make sure everyone is comfortable.',
        misc: 'A mix of prompt styles.'
    },
    coin: {
        Party: 'Light scenarios to answer before the coin flip.',
        Spicy: 'Daring scenarios; skip anything uncomfortable.',
        Deep: 'Reflective scenarios; share only what you choose.'
    },
    casino: {
        slots: 'Take a solo spin in the phone slot-machine app.',
        blackjack: 'Join the table and try to get closer to 21 than the others.'
    },
    openbox: {
        classic: 'Light bluffing prompts for the whole room.',
        spicy: 'Playful, bolder prompts; skip anything uncomfortable.',
        deep: 'Reflective prompts; share only what you choose.',
        nsfw: 'Adults-only prompts. Make sure everyone is comfortable.'
    }
};

function getLobbyDescriptions(mode, category) {
    const resolvedMode = LOBBY_MODE_DESCRIPTIONS[mode] ? mode : 'classic';
    return {
        mode: LOBBY_MODE_DESCRIPTIONS[resolvedMode],
        category: (LOBBY_CATEGORY_DESCRIPTIONS[resolvedMode] || {})[category] || ''
    };
}

// ── LOCAL PLAYER IDENTITY ────────────────────────────────────────────────────
function getCleanName() {
    let n = $('menuNameInput').value.trim();
    return n || "Player_" + Math.floor(Math.random() * 900);
}

function updateLobbySummary() {
    const modeLabel = $('lobbyModeSummary');
    const categoryLabel = $('lobbyCategorySummary');
    const metaLabel = $('lobbyMetaLabel');
    const categoryNames = {
        classic: {
            classic: 'Party',
            trouble: 'Trouble',
            spicy: 'Spicy',
            deep: 'Deep',
            flirt: 'Flirt',
            trash: 'Trash',
            nsfw: 'NSFW',
            misc: 'Mixed'
        },
        coin: { Party: 'Party', Spicy: 'Spicy', Deep: 'Deep' },
        casino: { slots: 'Slot Machine', blackjack: 'Blackjack' },
        openbox: { classic: 'Classic', spicy: 'Spicy', deep: 'Deep', nsfw: 'NSFW (18+)' }
    };
    const modeNames = { classic: 'Classic', coin: 'Coin Mode', casino: 'Casino', openbox: 'Openbox' };
    const currentCategory = room.gameMode === 'coin'
        ? room.coinCategory
        : room.gameMode === 'casino' ? room.casinoCategory : room.currentCategory;
    const categories = categoryNames[room.gameMode] || categoryNames.classic;
    const categoryLabelText = categories[currentCategory] || currentCategory || 'Party';
    const descriptions = getLobbyDescriptions(room.gameMode, currentCategory);

    if (modeLabel) modeLabel.innerText = modeNames[room.gameMode] || 'Classic';
    if (categoryLabel) categoryLabel.innerText = categoryLabelText;
    const modeSummaryDescription = $('lobbyModeSummaryDescription');
    const categorySummaryDescription = $('lobbyCategorySummaryDescription');
    if (modeSummaryDescription) modeSummaryDescription.textContent = descriptions.mode;
    if (categorySummaryDescription) categorySummaryDescription.textContent = descriptions.category;
    const modeDescription = $('lobbyModeDescription');
    const categoryDescription = $('lobbyCategoryDescription');
    if (modeDescription) modeDescription.textContent = descriptions.mode;
    if (categoryDescription) categoryDescription.textContent = descriptions.category;
    if (metaLabel) {
        const count = Array.isArray(room.players) ? room.players.length : 0;
        const maxRounds = room.maxRounds;
        const rounds = maxRounds === 'unlimited' ? 'Unlimited' : `${maxRounds || 10}`;
        metaLabel.innerText = `${count} / 10 players${room.gameMode === 'casino' ? ' · Casino' : ` · ${rounds} rounds`}`;
        const minimumPlayers = room.gameMode === 'casino'
            ? room.casinoCategory === 'slots' ? 1 : 2
            : room.gameMode === 'openbox'
                ? 2
            : 3;
        metaLabel.className = count >= minimumPlayers
            ? 'lobby-meta ready'
            : 'lobby-meta';
    }

    refreshLobbySettingsControls();
}

function refreshLobbySettingsControls() {
    const modeSelect = $('lobbyModeSelect');
    const categorySelect = $('lobbyCategorySelect');
    const writeTime = $('classicWriteSeconds');
    const voteTime = $('classicVoteSeconds');
    if (modeSelect) modeSelect.value = room.gameMode || 'classic';
    if (writeTime) writeTime.value = String(room.timeLimit);
    if (voteTime) voteTime.value = String(room.voteTimeLimit);
    if (typeof updateClassicTimerPreview === 'function') updateClassicTimerPreview();
    if (categorySelect) {
        const categorySets = {
            classic: [
                ['classic', 'Party'], ['trouble', 'Trouble'], ['spicy', 'Spicy'],
                ['deep', 'Deep'], ['flirt', 'Flirt'], ['trash', 'Trash'],
                ['nsfw', 'NSFW (adults only)'], ['misc', 'Mixed']
            ],
            coin: [['Party', 'Party'], ['Spicy', 'Spicy'], ['Deep', 'Deep']],
            casino: [['slots', 'Slot Machine'], ['blackjack', 'Blackjack']],
            openbox: [['classic', 'Classic'], ['spicy', 'Spicy'], ['deep', 'Deep'], ['nsfw', 'NSFW (18+)']]
        };
        const selected = room.gameMode === 'coin'
            ? room.coinCategory
            : room.gameMode === 'casino' ? room.casinoCategory : room.currentCategory;
        const options = categorySets[room.gameMode] || categorySets.classic;
        categorySelect.replaceChildren();
        options.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            categorySelect.appendChild(option);
        });
        categorySelect.value = options.some(([value]) => value === selected) ? selected : options[0][0];
    }
    if (typeof Openbox !== 'undefined') Openbox.refreshLobbyControls();
}

// ── LOBBY ROSTER UI ───────────────────────────────────────────────────────────
// Renders the current room.players list into the lobby grid, including the
// host's kick affordance and the "need N more players" / Start Game readiness
// state. Called both locally (after addTestBots/kickPlayer) and from game.js's
// handleData() after a SYNC_LOBBY / JOIN broadcast updates room.players.
function updateLobbyUI() {
    const grid = $('lobbyPlayerGrid');
    grid.innerHTML = "";
    const hostIndex = net.role === 'host' ? room.players.indexOf(net.myName) : 0;
    const resolvedHostIndex = hostIndex >= 0 ? hostIndex : 0;
    let guestNumber = 0;
    room.players.forEach((p, index) => {
        const pill = document.createElement('div');
        const isHost = index === resolvedHostIndex;
        pill.className = isHost ? "player-pill player-host" : "player-pill";
        if (!isHost) {
            const numberSpan = document.createElement('span');
            numberSpan.className = 'player-number';
            numberSpan.innerText = String(++guestNumber);
            pill.appendChild(numberSpan);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.innerText = p;
        pill.appendChild(nameSpan);
        if (net.role === 'host' && p !== net.myName) {
            const kick = document.createElement('span');
            kick.className = "kick-btn";
            kick.innerHTML = "&times;";
            kick.onclick = () => kickPlayer(p);
            pill.appendChild(kick);
        }
        grid.appendChild(pill);
    });

    const count  = room.players.length;
    const minimumPlayers = room.gameMode === 'casino'
        ? room.casinoCategory === 'slots' ? 1 : 2
        : room.gameMode === 'openbox'
            ? 2
        : 3;
    const needed = Math.max(0, minimumPlayers - count);
    const hostControls = $('hostOnlyControls');
    const readOnlySettings = $('lobbyReadOnlySettings');
    if (hostControls) hostControls.style.display = net.role === 'host' ? 'block' : 'none';
    if (readOnlySettings) readOnlySettings.hidden = net.role === 'host';
    updateLobbySummary();

    const startBtn = $('hostStartBtn');
    if (startBtn) {
        startBtn.disabled = count < minimumPlayers;
        startBtn.innerText = count < minimumPlayers
            ? `Need ${needed} more player${needed > 1 ? 's' : ''}...`
            : room.gameMode === 'casino' ? `Open ${room.casinoCategory === 'blackjack' ? 'Blackjack' : 'Slots'}`
                : 'Start Game';
    }
    const botButton = $('botAddBtn');
    const hasBots = room.players.some(player => typeof Bots !== 'undefined' && Bots.isBot(player));
    if (botButton) {
        botButton.style.display = net.role === 'host' ? 'block' : 'none';
        botButton.disabled = hasBots || room.players.length >= 10;
        botButton.textContent = hasBots ? 'Room bots are ready in every mode' : 'Add test players';
    }
    if (typeof Blackjack !== 'undefined') {
        Blackjack.syncRoomBots();
        Blackjack.render();
    }
}

// ── ROSTER MUTATION ───────────────────────────────────────────────────────────
// kickPlayer removes a player from the roster (host only, via the kick button
// above). The actual connection teardown is a networking concern and stays in
// networking.js's disconnectPlayerConnection() - this only updates room.players
// and re-broadcasts/re-renders, matching the original behavior exactly.
function kickPlayer(name) {
    disconnectPlayerConnection(name);
    room.players = room.players.filter(p => p !== name);
    if (typeof Openbox !== 'undefined') Openbox.onPlayerLeft(name);
    if (typeof Blackjack !== 'undefined') Blackjack.onPlayerLeft(name);
    broadcastToAll({ type: 'SYNC_LOBBY', players: room.players, category: room.currentCategory, gameMode: room.gameMode, coinCategory: room.coinCategory, casinoCategory: room.casinoCategory, gamblingEnabled: room.gamblingEnabled, playedQuestions: room.playedQuestions, openboxConfig: room.openboxConfig, timeLimit: room.timeLimit, voteTimeLimit: room.voteTimeLimit });
    updateLobbyUI();
    Vibrate.click();
}

// addTestBots adds fake players to the roster for local testing. Kept here
// since its sole responsibility is roster mutation (adding names to
// room.players) plus the same broadcast/UI-refresh pattern as kickPlayer.
function addTestBots() {
    if (net.role !== 'host') return;
    const availableSeats = Math.max(0, 10 - room.players.length);
    const candidates = ['bot1', 'bot2', 'bot3'].filter(bot => !room.players.includes(bot));
    candidates.slice(0, availableSeats).forEach(bot => room.players.push(bot));
    if (!candidates.length) {
        if (typeof showToast === 'function') showToast('Room bots are already in the lobby.');
        return;
    }
    if (availableSeats === 0) {
        if (typeof showToast === 'function') showToast('The room is full; remove a player before adding bots.');
        return;
    }
    broadcastToAll({ type: 'SYNC_LOBBY', players: room.players, category: room.currentCategory, gameMode: room.gameMode, coinCategory: room.coinCategory, casinoCategory: room.casinoCategory, gamblingEnabled: room.gamblingEnabled, playedQuestions: room.playedQuestions, openboxConfig: room.openboxConfig, timeLimit: room.timeLimit, voteTimeLimit: room.voteTimeLimit });
    updateLobbyUI();
    Sound.play(500, 'sine', 0.1);
    Vibrate.tap();
}