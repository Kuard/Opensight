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
let net = { peer: null, conn: null, connections: [], role: 'client', myName: '' };

// Remembers the room we're trying to stay connected to, so a client can
// auto-reconnect after a drop without the user re-entering the Room ID.
let _joinTargetId = null;
let _reconnectAttempt = 0;
let _reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 6; // capped backoff, ~30s total before giving up

function _log(...args) { console.log('[net]', ...args); }

// ── DATA CALLBACK REGISTRATION ───────────────────────────────────────────────
// game.js registers its handleData(data, connection) function here. networking.js
// never interprets message contents/types itself - it just delivers them.
let _onDataCallback = null;
function onNetworkData(callback) {
    _onDataCallback = callback;
}
function _dispatchData(data, connection) {
    _log('recv', data && data.type);
    if (_onDataCallback) _onDataCallback(data, connection);
}

// ── STATUS CALLBACK REGISTRATION ─────────────────────────────────────────────
// Fired on connection lifecycle changes so game.js/players.js can react
// (toast messages, disabling input, etc) without networking.js touching game UI
// beyond the lobby-screen wiring that already lived here.
// status: 'connected' | 'disconnected' | 'reconnecting' | 'reconnect-failed' | 'player-left'
let _onStatusCallback = null;
function onNetworkStatus(callback) {
    _onStatusCallback = callback;
}
function _emitStatus(status, detail) {
    _log('status:', status, detail || '');
    if (_onStatusCallback) _onStatusCallback(status, detail);
}

// ── HOST / CLIENT CONNECTION SETUP ───────────────────────────────────────────
function createLiveRoom() {
    Vibrate.click();
    net.myName = getCleanName();
    net.role = 'host';
    room.players = [net.myName];

    room.currentCategory = 'classic';
    room.maxRounds = 10;

    const shortId = Math.random().toString(36).substring(2,6).toUpperCase();
    net.peer = new Peer(shortId, PEER_CONFIG);

    net.peer.on('open', (id) => {
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

    net.peer.on('connection', (connection) => {
        _log('incoming connection', connection.peer);
        // Track the connection immediately so a dead/never-joined peer is still
        // cleanable, and so broadcastToAll can already see it once open.
        net.connections.push(connection);

        connection.on('data', (data) => _dispatchData(data, connection));

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

    net.peer.on('disconnected', () => {
        _log('host peer disconnected from signaling server, attempting reconnect');
        try { net.peer.reconnect(); } catch (e) {}
    });

    net.peer.on('error', (err) => {
        console.error('[net] host peer error', err);
        alert("Host error: " + err.type);
    });
}

// A connection (host-side) closed or errored. Remove it from net.connections
// and tell game.js which player left, so the roster stays accurate and one
// broken connection never blocks broadcasts to everyone else.
function _handleConnectionLost(connection, reason, err) {
    const wasTracked = net.connections.includes(connection);
    net.connections = net.connections.filter(c => c !== connection);
    if (!wasTracked) return; // already cleaned up (e.g. kick, or duplicate event)

    _log('connection lost', connection.peer, reason, err || '');
    const name = connection._kickName || null;
    if (name) {
        _emitStatus('player-left', { name });
    }
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
    net.peer = new Peer(undefined, PEER_CONFIG);

    net.peer.on('open', () => {
        _log(isReconnect ? 'reconnect: peer open, connecting to host' : 'client peer open, connecting to host');
        net.conn = net.peer.connect(targetId, { reliable: true });

        net.conn.on('open', () => {
            _log('connection to host open');
            _reconnectAttempt = 0;
            net.conn.send({ type: 'JOIN', name: net.myName });

            if (!isReconnect) {
                $('lobbyIdLabel').innerText = targetId;
                $('hostOnlyControls').style.display = 'none';
                $('hostStartBtn').style.display = 'none';
                $('clientWaitNotice').style.display = 'block';
                $('botAddBtn').style.display = 'none';
                showScreen('scrLobby');
            } else {
                _emitStatus('connected');
            }
        });
        net.conn.on('data', (data) => _dispatchData(data, null));
        net.conn.on('close', () => _handleHostConnectionLost('close'));
        net.conn.on('error', (err) => _handleHostConnectionLost('error', err));
    });

    net.peer.on('disconnected', () => {
        _log('client peer disconnected from signaling server');
        try { net.peer.reconnect(); } catch (e) {}
    });

    net.peer.on('error', (err) => {
        console.error('[net] client peer error', err);
        if (!isReconnect) {
            alert("Could not connect. Check the Room ID and try again.");
        } else {
            _scheduleReconnect();
        }
    });
}

// Client lost its connection to the host. Try to reconnect with backoff and
// resync (host resends CATCH_UP / SYNC_LOBBY once we re-JOIN) rather than
// forcing the player to manually rejoin.
function _handleHostConnectionLost(reason, err) {
    if (net.role !== 'client') return;
    if (!_joinTargetId) return; // already left cleanly (disconnectPeer was called)

    _log('lost connection to host', reason, err || '');
    _emitStatus('disconnected');
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
        try { if (net.peer) net.peer.destroy(); } catch (e) {}
        _connectToHost(_joinTargetId, /*isReconnect*/ true);
    }, delay);
}

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
    _joinTargetId = null; // cancel any pending/future auto-reconnect
    _reconnectAttempt = 0;
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (net.peer) {
        try { net.peer.destroy(); } catch(e) {}
    }
    net = { peer: null, conn: null, connections: [], role: 'client', myName: '' };
}

// ── ROOM MEMBERSHIP TRANSPORT ─────────────────────────────────────────────────
// kickPlayer's actual network action (notify + close the connection) is transport;
// the room.players mutation and re-broadcast of lobby state stay in game.js.
function disconnectPlayerConnection(name) {
    const kickedConn = net.connections.find(c => c._kickName === name);
    if (kickedConn) {
        try { kickedConn.send({ type: 'KICKED' }); } catch(e) {}
        setTimeout(() => { try { kickedConn.close(); } catch(e) {} }, 400);
        net.connections = net.connections.filter(c => c !== kickedConn);
    }
}