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

// ── LOCAL PLAYER IDENTITY ────────────────────────────────────────────────────
function getCleanName() {
    let n = $('menuNameInput').value.trim();
    return n || "Player_" + Math.floor(Math.random() * 900);
}

// ── LOBBY ROSTER UI ───────────────────────────────────────────────────────────
// Renders the current room.players list into the lobby grid, including the
// host's kick affordance and the "need N more players" / Start Game readiness
// state. Called both locally (after addTestBots/kickPlayer) and from game.js's
// handleData() after a SYNC_LOBBY / JOIN broadcast updates room.players.
function updateLobbyUI() {
    const grid = $('lobbyPlayerGrid');
    grid.innerHTML = "";
    room.players.forEach(p => {
        const pill = document.createElement('div');
        pill.className = "player-pill";
        const nameSpan = document.createElement('span');
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
    const needed = Math.max(0, 3 - count);
    const lbl    = $('lobbyStatusLabel');
    if (lbl) {
        lbl.innerText = needed > 0
            ? `${count} / 3 players - need ${needed} more`
            : `${count} players - ready!`;
        lbl.className = needed > 0 ? 'lobby-status' : 'lobby-status ready';
    }

    const startBtn = $('hostStartBtn');
    if (startBtn) {
        startBtn.disabled = count < 3;
        startBtn.innerText = count < 3 ? `Need ${needed} more player${needed > 1 ? 's' : ''}...` : "Start Game";
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
    broadcastToAll({ type: 'SYNC_LOBBY', players: room.players, category: room.currentCategory, playedQuestions: room.playedQuestions });
    updateLobbyUI();
    Vibrate.click();
}

// addTestBots adds fake players to the roster for local testing. Kept here
// since its sole responsibility is roster mutation (adding names to
// room.players) plus the same broadcast/UI-refresh pattern as kickPlayer.
function addTestBots() {
    if (net.role !== 'host') return;
    ['bot1', 'bot2', 'bot3'].forEach(bot => {
        if (!room.players.includes(bot)) room.players.push(bot);
    });
    broadcastToAll({ type: 'SYNC_LOBBY', players: room.players, category: room.currentCategory, gameMode: room.gameMode, playedQuestions: room.playedQuestions });
    updateLobbyUI();
    Sound.play(500, 'sine', 0.1);
    Vibrate.tap();
}