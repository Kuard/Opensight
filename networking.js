// ── FIREWALL-PROOF NETWORK CONFIGURATION ───────────────────────────────────────
const PEER_CONFIG = {
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: "stun:stun.relay.metered.ca:80" },
            { 
                urls: "turn:global.relay.metered.ca:80", 
                username: "92040003f6021883d79e3d36", 
                credential: "HakDD0N0nzTZrq+r" 
            },
            { 
                urls: "turn:global.relay.metered.ca:80?transport=tcp", 
                username: "92040003f6021883d79e3d36", 
                credential: "HakDD0N0nzTZrq+r" 
            },
            { 
                urls: "turn:global.relay.metered.ca:443", 
                username: "92040003f6021883d79e3d36", 
                credential: "HakDD0N0nzTZrq+r" 
            },
            { 
                urls: "turns:global.relay.metered.ca:443?transport=tcp", 
                username: "92040003f6021883d79e3d36", 
                credential: "HakDD0N0nzTZrq+r" 
            }
        ]
    }
};

// ── NETWORK STATE ────────────────────────────────────────────────────────────
// Kept as the same global `net` object game.js already reads/writes directly
// (net.role, net.myName, net.conn, net.connections, net.peer) to avoid touching
// every call site across game.js.
//
// net.roster (host only) is the identity registry:
//     insightPlayerId -> { id, label, conn, connected, graceTimer }
//   id     the stable Insight Player ID (identity - never shown to players)
//   label  the string this player is known as inside `room` (room.players,
//          room.scores, card creators, ...). Derived from the display name,
//          made unique by the host, and FROZEN for the life of the player
//          record - reconnecting never changes it.
//   conn   the ONE PeerJS DataConnection currently attached to this player
//          (null while disconnected). Only this connection may change the
//          player's connection state.
let net = { peer: null, conn: null, connections: [], roster: {}, role: 'client', myName: '' };

// Client: the room we're trying to stay connected to, so a drop can auto-reconnect
// without the user re-entering the Room ID.
let _joinTargetId = null;
let _reconnectAttempt = 0;
let _reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 6; // capped backoff, ~30s of waiting before giving up

// Client: bumped every time a connection attempt starts or is abandoned. Every
// PeerJS handler captures the value it was created under and ignores events once
// it no longer matches, so a discarded peer/connection can never act on new state.
let _connGen = 0;

// Client: outstanding liveness probe (see _verifyHostLink).
let _probeTimer = null;
const PING_TIMEOUT_MS = 4000;

// Host: pending retry of the signaling-server connection.
let _hostSignalTimer = null;

// Host: how long a dropped player keeps their seat, score and round state.
// Comfortably longer than the client's own reconnect schedule (~31s of backoff
// waits plus connection time).
const DISCONNECT_GRACE_MS = 45000;

function _log(...args) { console.log('[net]', ...args); }

// ── INSIGHT PLAYER ID ────────────────────────────────────────────────────────
// The application-level identity of a player. Generated once, persisted in
// localStorage, and sent in the JOIN handshake. It is NOT the display name and
// NOT the PeerJS peer id (which is different on every reconnect).
const PLAYER_ID_STORAGE_KEY = 'insightPlayerId';
const PLAYER_ID_PATTERN = /^[A-Z0-9]{4,12}$/;
let _playerIdCache = null; // keeps the id stable for this page even if storage is blocked

function _generatePlayerId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

function getLocalPlayerId() {
    let id = null;
    try { id = localStorage.getItem(PLAYER_ID_STORAGE_KEY); } catch (e) {}
    if (!(id && PLAYER_ID_PATTERN.test(id))) {
        id = _playerIdCache || _generatePlayerId();
        try { localStorage.setItem(PLAYER_ID_STORAGE_KEY, id); } catch (e) {}
    }
    _playerIdCache = id;
    return id;
}

// ── DATA CALLBACK REGISTRATION ───────────────────────────────────────────────
// game.js registers its handleData(data, connection) function here. networking.js
// never interprets game message contents/types itself - it just delivers them.
// (Transport-level messages - PING/PONG/LEAVE/JOIN_ACK/REPLACED - are consumed
// here and never reach game.js.)
let _onDataCallback = null;
function onNetworkData(callback) {
    _onDataCallback = callback;
}
function _dispatchData(data, connection) {
    _log('recv', data && data.type);
    if (_onDataCallback) _onDataCallback(data, connection);
}

// ── STATUS CALLBACK REGISTRATION ─────────────────────────────────────────────
// Fired on connection lifecycle changes so game.js can react (toasts, pruning)
// without networking.js touching game state.
//   client: 'connected' {rejoined,isReconnect} | 'disconnected' | 'reconnecting'
//           | 'reconnect-failed' | 'replaced'
//   host:   'player-disconnected' {name,playerId,graceMs}   (grace period started)
//           | 'player-left' {name,playerId}                 (grace expired / left on purpose)
let _onStatusCallback = null;
function onNetworkStatus(callback) {
    _onStatusCallback = callback;
}
function _emitStatus(status, detail) {
    _log('status:', status, detail || '');
    if (_onStatusCallback) _onStatusCallback(status, detail);
}

// ── HOST: PLAYER REGISTRY ────────────────────────────────────────────────────
// Turns a requested display name into a label that is unique inside the room.
// Two players may type the same name; the second gets "Name (2)" so the
// name-keyed game state (scores, cards, subject, writers) never collides.
function _uniqueLabel(name) {
    const base = name || 'Player';
    if (!room.players.includes(base)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base} (${n})`;
        if (!room.players.includes(candidate)) return candidate;
    }
}

function _bindConnection(connection, rec) {
    connection._playerId = rec.id;
    connection._kickName = rec.label; // legacy field, still read by disconnectPlayerConnection / other modules
    if (!net.connections.includes(connection)) net.connections.push(connection);
}

// A newer connection took over this player. Detach the old one for good: it is
// removed from broadcasts, stops being able to speak for the player, and is told
// (so a second tab/device does not fight for the seat in a reconnect loop).
function _supersedeConnection(old) {
    net.connections = net.connections.filter(c => c !== old);
    old._superseded = true;
    old._playerId = null;
    old._kickName = null;
    try { if (old.open) old.send({ type: 'REPLACED' }); } catch (e) {}
    setTimeout(() => { try { old.close(); } catch (e) {} }, 400);
}

function _forgetPlayer(playerId) {
    const rec = net.roster[playerId];
    if (rec && rec.graceTimer) clearTimeout(rec.graceTimer);
    delete net.roster[playerId];
}

// Called by game.js when a JOIN arrives. Decides - purely from the Insight Player
// ID - whether this is a new player or a known player on a new connection.
//   -> { rejoined: bool, label: string, playerId: string }
function attachPlayerConnection(connection, playerId, requestedName) {
    if (!PLAYER_ID_PATTERN.test(playerId || '')) {
        // No/invalid id (very old client): treat as a brand-new player that can never match a record.
        playerId = '~' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    const known = net.roster[playerId];
    if (known && room.players.includes(known.label)) {
        // REJOIN: same player, new connection. Cancel the pending removal and swap the connection.
        if (known.graceTimer) { clearTimeout(known.graceTimer); known.graceTimer = null; }
        const old = known.conn;
        known.conn = connection;
        known.connected = true;
        if (old && old !== connection) _supersedeConnection(old);
        _bindConnection(connection, known);
        _log('REJOIN', playerId, '->', known.label);
        return { rejoined: true, label: known.label, playerId };
    }

    // NEW player. (A leftover record whose player is no longer in the room - kicked or
    // pruned - is discarded so it can't be mistaken for a live seat.)
    if (known) _forgetPlayer(playerId);
    const label = _uniqueLabel(requestedName);
    const rec = { id: playerId, label, conn: connection, connected: true, graceTimer: null };
    net.roster[playerId] = rec;
    _bindConnection(connection, rec);
    _log('JOIN', playerId, '->', label);
    return { rejoined: false, label, playerId };
}

// Grace period over and nobody came back: now (and only now) the player is pruned.
function _expirePlayer(rec) {
    if (net.roster[rec.id] !== rec || rec.connected) return; // rejoined, kicked or already removed
    rec.graceTimer = null;
    delete net.roster[rec.id];
    _log('grace expired for', rec.label);
    _emitStatus('player-left', { name: rec.label, playerId: rec.id });
}

// A host-side connection closed or errored. This is a CONNECTION event, not a
// roster event: it only starts the grace period, and only if this is still the
// connection attached to the player. Close/error from a superseded, kicked or
// never-joined connection is ignored, and close+error for the same drop is
// handled once (rec.conn is cleared on the first).
function _handleConnectionLost(connection, reason, err) {
    net.connections = net.connections.filter(c => c !== connection);

    const rec = connection._playerId ? net.roster[connection._playerId] : null;
    if (!rec || rec.conn !== connection) return;

    _log('connection lost', rec.label, reason, err || '');
    rec.conn = null;
    rec.connected = false;
    rec.graceTimer = setTimeout(() => _expirePlayer(rec), DISCONNECT_GRACE_MS);
    _emitStatus('player-disconnected', { name: rec.label, playerId: rec.id, graceMs: DISCONNECT_GRACE_MS });
}

// Client said LEAVE (deliberate). No point holding the seat for the grace period.
function _handleVoluntaryLeave(connection) {
    const rec = connection._playerId ? net.roster[connection._playerId] : null;
    if (!rec || rec.conn !== connection) return; // ignore LEAVE from a stale connection
    net.connections = net.connections.filter(c => c !== connection);
    if (rec.graceTimer) clearTimeout(rec.graceTimer);
    delete net.roster[rec.id];
    _emitStatus('player-left', { name: rec.label, playerId: rec.id, voluntary: true });
}

// ── HOST: SIGNALING RECOVERY ─────────────────────────────────────────────────
// If the host loses the signaling server, existing DataConnections keep working,
// but NEW connections (i.e. players rejoining) cannot reach the host until it
// re-registers under the same peer id. Retry until it does.
function _recoverHostSignaling() {
    const peer = net.peer;
    if (net.role !== 'host' || !peer || peer.destroyed || !peer.disconnected) return;
    if (_hostSignalTimer) return;
    _log('host: re-registering with signaling server');
    try { peer.reconnect(); } catch (e) {}
    _hostSignalTimer = setTimeout(() => {
        _hostSignalTimer = null;
        _recoverHostSignaling(); // no-ops once peer.disconnected is false again
    }, 3000);
}

const _RECOVERABLE_PEER_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];

// ── HOST / CLIENT CONNECTION SETUP ───────────────────────────────────────────
function createLiveRoom() {
    Vibrate.click();
    net.myName = getCleanName();
    net.role = 'host';
    room.players = [net.myName];

    room.currentCategory = 'classic';
    room.maxRounds = 10;

    const shortId = Math.random().toString(36).substring(2,6).toUpperCase();
    const peer = new Peer(shortId, PEER_CONFIG);
    net.peer = peer;
    let opened = false;

    peer.on('open', (id) => {
        // PeerJS emits 'open' again every time peer.reconnect() re-registers with the
        // signaling server. That must not re-run lobby setup (it would yank the host
        // back to the lobby screen mid-game).
        if (opened) { _log('host peer re-registered with signaling server'); return; }
        opened = true;
        room.id = id;
        _log('host peer open, room id =', id);
        $('lobbyIdLabel').innerText = id;
        $('hostOnlyControls').style.display = 'block';
        $('hostStartBtn').style.display = 'block';
        $('clientWaitNotice').style.display = 'none';
        $('botAddBtn').style.display = 'flex';
        resetLobbyDefaultsUI();
        updateLobbyUI();
        showScreen('scrLobby');
    });

    peer.on('connection', (connection) => {
        _log('incoming connection', connection.peer);
        // Tracked immediately so it is already in the broadcast list once open. It is
        // not tied to a player until its JOIN is processed (see attachPlayerConnection).
        net.connections.push(connection);

        connection.on('data', (data) => {
            if (connection._superseded) return; // replaced by a newer connection - no longer speaks for anyone
            if (data && data.type === 'PING') {
                try { if (connection.open) connection.send({ type: 'PONG' }); } catch (e) {}
                return;
            }
            if (data && data.type === 'LEAVE') { _handleVoluntaryLeave(connection); return; }
            _dispatchData(data, connection);
        });

        connection.on('open', () => {
            _log('connection open', connection.peer);
            connection.send({
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
        });

        connection.on('close', () => _handleConnectionLost(connection, 'close'));
        connection.on('error', (err) => _handleConnectionLost(connection, 'error', err));
    });

    peer.on('disconnected', () => {
        _log('host peer disconnected from signaling server');
        if (net.peer === peer) _recoverHostSignaling();
    });

    peer.on('error', (err) => {
        console.error('[net] host peer error', err);
        if (net.peer !== peer) return;
        if (opened && _RECOVERABLE_PEER_ERRORS.includes(err.type)) {
            _recoverHostSignaling(); // transient signaling trouble mid-game: retry quietly
            return;
        }
        alert("Host error: " + err.type);
    });
}

function joinLiveRoom() {
    Vibrate.click();
    net.myName = getCleanName();
    net.role = 'client';
    const targetId = $('joinRoomInput').value.trim().toUpperCase();
    if (!targetId) { alert("Please enter a Room ID"); return; }
    _joinTargetId = targetId;
    _reconnectAttempt = 0;
    _connectToHost(targetId, /*isReconnect*/ false);
}

function _connectToHost(targetId, isReconnect) {
    const gen = ++_connGen; // from here on, handlers of every earlier attempt are stale
    const stale = () => gen !== _connGen;
    let handshakeDone = false; // set when the host's JOIN_ACK arrives
    let opened = false;

    try { if (net.peer) net.peer.destroy(); } catch (e) {}
    const peer = new Peer(undefined, PEER_CONFIG);
    net.peer = peer;

    peer.on('open', () => {
        if (stale()) return;
        if (opened) {
            // peer.reconnect() re-registered us with the signaling server and PeerJS
            // re-emitted 'open'. The DataConnection is independent of that: do NOT open a
            // second one (that would look like a brand-new JOIN to the host).
            _log('client peer re-registered with signaling server');
            if (handshakeDone && !(net.conn && net.conn.open)) _handleHostConnectionLost('signaling-reopen');
            return;
        }
        opened = true;
        _log(isReconnect ? 'reconnect: peer open, connecting to host' : 'client peer open, connecting to host');

        const conn = peer.connect(targetId, { reliable: true });
        net.conn = conn;

        conn.on('open', () => {
            if (stale()) return;
            _log('connection to host open');
            // The Player ID is what tells the host "this is the same player". The host
            // decides new-vs-rejoin from it; the name is display-only.
            conn.send({ type: 'JOIN', name: net.myName, playerId: getLocalPlayerId() });

            if (!isReconnect) {
                $('lobbyIdLabel').innerText = targetId;
                $('hostOnlyControls').style.display = 'none';
                $('hostStartBtn').style.display = 'none';
                $('clientWaitNotice').style.display = 'block';
                $('botAddBtn').style.display = 'none';
                showScreen('scrLobby');
            }
        });

        conn.on('data', (data) => {
            if (stale()) return;
            _clearProbe(); // any inbound traffic proves the link is alive
            const type = data && data.type;
            if (type === 'PONG') return;
            if (type === 'JOIN_ACK') {
                handshakeDone = true;
                _reconnectAttempt = 0;
                if (data.label) net.myName = data.label; // the host-assigned label is authoritative
                if (isReconnect) _emitStatus('connected', { rejoined: !!data.rejoined, isReconnect: true });
                return;
            }
            if (type === 'REPLACED') {
                // Another connection (other tab/device) took over our Player ID. Do not
                // reconnect - that would just steal it back and start a tug-of-war.
                _log('replaced by a newer connection with the same Player ID');
                _joinTargetId = null;
                _connGen++;
                _emitStatus('replaced');
                return;
            }
            _dispatchData(data, conn);
        });

        conn.on('close', () => { if (!stale()) _handleHostConnectionLost('close'); });
        conn.on('error', (err) => { if (!stale()) _handleHostConnectionLost('error', err); });
    });

    peer.on('disconnected', () => {
        if (stale()) return;
        _log('client peer disconnected from signaling server');
        // Signaling only. An open DataConnection to the host is unaffected by this, so
        // just re-register (a short delay avoids a tight loop while the network is down).
        setTimeout(() => {
            if (stale() || peer.destroyed || !peer.disconnected) return;
            try { peer.reconnect(); } catch (e) {}
        }, 1500);
    });

    peer.on('error', (err) => {
        if (stale()) return;
        console.error('[net] client peer error', err);
        if (!handshakeDone) {
            if (isReconnect) {
                _scheduleReconnect();
            } else {
                alert("Could not connect. Check the Room ID and try again.");
                _joinTargetId = null;
                _connGen++;
                try { peer.destroy(); } catch (e) {}
            }
            return;
        }
        // After the handshake: a peer error is usually signaling trouble, which the
        // 'disconnected' handler already deals with. Only rebuild if the data link is gone.
        if (!(net.conn && net.conn.open)) _handleHostConnectionLost('peer-error', err);
    });
}

// Client lost its connection to the host. Reconnect with backoff; the host
// recognises us by Player ID and resyncs us (REJOIN_SYNC) - no manual rejoin.
function _handleHostConnectionLost(reason, err) {
    if (net.role !== 'client') return;
    if (!_joinTargetId) return; // already left cleanly (disconnectPeer was called)

    _log('lost connection to host', reason, err || '');
    if (_reconnectAttempt === 0) _emitStatus('disconnected'); // first drop only; later failures are just retries
    _scheduleReconnect();
}

function _scheduleReconnect() {
    if (!_joinTargetId) return;
    if (_reconnectTimer) return; // already scheduled

    if (_reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        _emitStatus('reconnect-failed');
        return;
    }

    _reconnectAttempt++;
    const delay = Math.min(8000, 1000 * Math.pow(2, _reconnectAttempt - 1));
    _emitStatus('reconnecting', { attempt: _reconnectAttempt, delayMs: delay });
    _log(`reconnect attempt ${_reconnectAttempt} in ${delay}ms`);

    _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        if (!_joinTargetId) return; // left in the meantime
        _connectToHost(_joinTargetId, /*isReconnect*/ true); // invalidates + destroys the old peer itself
    }, delay);
}

// ── LIVENESS ─────────────────────────────────────────────────────────────────
// PeerJS only fires 'close' when ICE reports failed/closed; ICE "disconnected" is
// merely logged. After the page was backgrounded or the network flipped, a dead
// channel can therefore still look open. When the page comes back to the
// foreground the client probes the host and reconnects if nothing answers.
function _clearProbe() {
    if (_probeTimer) { clearTimeout(_probeTimer); _probeTimer = null; }
}

function _verifyHostLink() {
    if (net.role !== 'client' || !_joinTargetId) return;

    if (net.conn && net.conn.open && net.peer && !net.peer.destroyed) {
        _clearProbe();
        try { net.conn.send({ type: 'PING' }); } catch (e) {}
        _probeTimer = setTimeout(() => {
            _probeTimer = null;
            _handleHostConnectionLost('ping-timeout');
        }, PING_TIMEOUT_MS);
    } else if (_reconnectTimer || _reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        // Waiting out a backoff delay, or had given up: the player is back, so retry now.
        if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        _reconnectAttempt = 0;
        _connectToHost(_joinTargetId, /*isReconnect*/ true);
    }
    // else: a reconnect attempt is already in flight - leave it alone.
}

function _onForeground() {
    if (document.visibilityState === 'hidden') return;
    if (net.role === 'host') _recoverHostSignaling();
    else _verifyHostLink();
}
document.addEventListener('visibilitychange', _onForeground);
window.addEventListener('online', _onForeground);

// ── SENDING ───────────────────────────────────────────────────────────────────
function broadcastToAll(payload) {
    if (net.role === 'host') {
        _log('broadcast', payload && payload.type, `to ${net.connections.length} conn(s)`);
        net.connections.forEach(c => {
            if (!c.open) return; // skip dead/closing connections safely
            try { c.send(payload); } catch (e) { _log('send failed', c.peer, e); }
        });
        _dispatchData(payload, null);
    }
}

// Sends a host update to connected peers without dispatching it back through
// the host's own message handler. Use this when rebroadcasting a client message.
function broadcastToConnections(payload) {
    if (net.role !== 'host') return;
    _log('broadcast peers only', payload && payload.type, `to ${net.connections.length} conn(s)`);
    net.connections.forEach(c => {
        if (!c.open) return;
        try { c.send(payload); } catch (e) { _log('send failed', c.peer, e); }
    });
}

// ── DISCONNECT ────────────────────────────────────────────────────────────────
// Only the peer-teardown portion of the original leaveRoom() lives here. Resetting
// `room` and DOM/screen state is game logic and stays in game.js's leaveRoom(),
// which calls this first.
function disconnectPeer() {
    const leavingPeer = net.peer;

    // A deliberate leave is announced, so the host frees the seat immediately
    // instead of holding it for the disconnect grace period.
    let announcedLeave = false;
    if (net.role === 'client' && net.conn && net.conn.open) {
        try { net.conn.send({ type: 'LEAVE' }); announcedLeave = true; } catch (e) {}
    }

    _joinTargetId = null; // cancel any pending/future auto-reconnect
    _reconnectAttempt = 0;
    _connGen++;           // every handler of the peer being torn down is now stale
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    _clearProbe();
    if (_hostSignalTimer) { clearTimeout(_hostSignalTimer); _hostSignalTimer = null; }
    Object.values(net.roster || {}).forEach(r => { if (r.graceTimer) clearTimeout(r.graceTimer); });

    if (leavingPeer) {
        // Give the LEAVE message a moment to leave the socket before tearing the peer down.
        setTimeout(() => { try { leavingPeer.destroy(); } catch (e) {} }, announcedLeave ? 250 : 0);
    }
    net = { peer: null, conn: null, connections: [], roster: {}, role: 'client', myName: '' };
}

// ── ROOM MEMBERSHIP TRANSPORT ─────────────────────────────────────────────────
// kickPlayer's actual network action (notify + close the connection) is transport;
// the room.players mutation and re-broadcast of lobby state stay in game.js.
function disconnectPlayerConnection(name) {
    // Drop the identity record first so the kicked connection's later 'close' is
    // ignored and no grace timer can resurrect a 'player-left' for them.
    const rec = Object.values(net.roster).find(r => r.label === name);
    const kickedConn = rec ? rec.conn : net.connections.find(c => c._kickName === name);
    if (rec) _forgetPlayer(rec.id);

    if (kickedConn) {
        kickedConn._playerId = null;
        try { kickedConn.send({ type: 'KICKED' }); } catch(e) {}
        setTimeout(() => { try { kickedConn.close(); } catch(e) {} }, 400);
        net.connections = net.connections.filter(c => c !== kickedConn);
    }
}