const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 🏆 The all-time ledger: wins and losses by commander name, across every game
const LEADERBOARD_PATH = path.join(__dirname, 'leaderboard.json');
let leaderboard = {};
try { leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_PATH, 'utf8')) || {}; } catch (e) { leaderboard = {}; }
function saveLeaderboard() {
    try { fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(leaderboard, null, 1)); } catch (e) { console.error('leaderboard save failed', e.message); }
}

// ---- 🌍 THE ETERNAL LEDGER (optional): one leaderboard across ALL servers,
// ALL time. Every server — Render, a laptop, anywhere — writes each result to
// the same shared store, keyed only by commander name (no accounts). Backed by
// a free Upstash Redis database over its REST API.
// Configure EITHER with env vars (Render dashboard → Environment):
//     UPSTASH_REDIS_REST_URL   = https://xxxx.upstash.io
//     UPSTASH_REDIS_REST_TOKEN = AX....
// OR with a global_leaderboard.json next to server.js (keep it out of git):
//     { "url": "https://xxxx.upstash.io", "token": "AX...." }
// With neither present, everything falls back to the local file above.
let GLOBAL_LB = { url: process.env.UPSTASH_REDIS_REST_URL || '', token: process.env.UPSTASH_REDIS_REST_TOKEN || '' };
try {
    if (!GLOBAL_LB.url || !GLOBAL_LB.token) {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'global_leaderboard.json'), 'utf8'));
        if (cfg && cfg.url && cfg.token) GLOBAL_LB = { url: String(cfg.url).replace(/\/+$/, ''), token: cfg.token };
    }
} catch (e) {}
const globalLbEnabled = () => !!(GLOBAL_LB.url && GLOBAL_LB.token && typeof fetch === 'function');
if (globalLbEnabled()) console.log('🌍 Eternal ledger connected:', GLOBAL_LB.url);
async function redisCmd(parts) {
    const res = await fetch(GLOBAL_LB.url + '/' + parts.map(encodeURIComponent).join('/'), {
        headers: { Authorization: 'Bearer ' + GLOBAL_LB.token }
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j.result;
}
// 🏳️ A commander who walks out of a live campaign takes the defeat with them.
// Recorded the moment their seat is finally given up, so it lands on the ledger
// even though they will not be present when the game is decided.
function recordForfeit(name) {
    if (!name) return;
    leaderboard[name] = leaderboard[name] || { wins: 0, losses: 0 };
    leaderboard[name].losses++;
    saveLeaderboard();
    if (globalLbEnabled()) {
        redisCmd(['HINCRBY', 'hegemony:losses', name, '1'])
            .catch(e => console.error('forfeit write failed:', e.message));
    }
    console.log(`Forfeit recorded for ${name}`);
}

function recordGlobalResult(winnerName, names) {
    if (!globalLbEnabled()) return;
    names.forEach(n => {
        if (!n) return;
        redisCmd(['HINCRBY', n === winnerName ? 'hegemony:wins' : 'hegemony:losses', n, '1'])
            .catch(e => console.error('eternal ledger write failed:', e.message));
    });
}
// ⚖️ THE BALANCE LEDGER: which NATIONS win — humans and AI alike — for
// balancing the game. Same shape as the commander ledger: a local file
// fallback, and the shared Upstash store across all servers when configured.
const NATION_STATS_PATH = path.join(__dirname, 'nation_stats.json');
let nationStats = {};
try { nationStats = JSON.parse(fs.readFileSync(NATION_STATS_PATH, 'utf8')) || {}; } catch (e) { nationStats = {}; }
function saveNationStats() {
    try { fs.writeFileSync(NATION_STATS_PATH, JSON.stringify(nationStats, null, 1)); } catch (e) { console.error('nation stats save failed', e.message); }
}
function recordNationResult(winnerNation, winnerAI, nations) {
    nations.forEach(n => {
        const s = nationStats[n.name] = nationStats[n.name] || { games: 0, wins: 0, aiWins: 0 };
        s.games++;
        if (winnerNation && n.name === winnerNation) { s.wins++; if (winnerAI) s.aiWins++; }
    });
    saveNationStats();
    if (!globalLbEnabled()) return;
    nations.forEach(n => {
        redisCmd(['HINCRBY', 'hegemony:nation:games', n.name, '1']).catch(e => console.error('balance ledger write failed:', e.message));
        if (winnerNation && n.name === winnerNation) {
            redisCmd(['HINCRBY', 'hegemony:nation:wins', n.name, '1']).catch(() => {});
            if (winnerAI) redisCmd(['HINCRBY', 'hegemony:nation:aiwins', n.name, '1']).catch(() => {});
        }
    });
}
let globalNationCache = { at: 0, data: null };
async function fetchGlobalNations() {
    if (!globalLbEnabled()) return null;
    if (globalNationCache.data && Date.now() - globalNationCache.at < 15000) return globalNationCache.data;
    try {
        const games = await redisCmd(['HGETALL', 'hegemony:nation:games']) || [];
        const wins = await redisCmd(['HGETALL', 'hegemony:nation:wins']) || [];
        const aiw = await redisCmd(['HGETALL', 'hegemony:nation:aiwins']) || [];
        const out = {};
        for (let i = 0; i < games.length; i += 2) { (out[games[i]] = out[games[i]] || { games: 0, wins: 0, aiWins: 0 }).games = parseInt(games[i + 1], 10) || 0; }
        for (let i = 0; i < wins.length; i += 2) { (out[wins[i]] = out[wins[i]] || { games: 0, wins: 0, aiWins: 0 }).wins = parseInt(wins[i + 1], 10) || 0; }
        for (let i = 0; i < aiw.length; i += 2) { (out[aiw[i]] = out[aiw[i]] || { games: 0, wins: 0, aiWins: 0 }).aiWins = parseInt(aiw[i + 1], 10) || 0; }
        globalNationCache = { at: Date.now(), data: out };
        return out;
    } catch (e) {
        console.error('balance ledger read failed:', e.message);
        return null;
    }
}

let globalBoardCache = { at: 0, data: null };
async function fetchGlobalBoard() {
    if (!globalLbEnabled()) return null;
    if (globalBoardCache.data && Date.now() - globalBoardCache.at < 15000) return globalBoardCache.data;
    try {
        const wins = await redisCmd(['HGETALL', 'hegemony:wins']) || [];
        const losses = await redisCmd(['HGETALL', 'hegemony:losses']) || [];
        const out = {};
        for (let i = 0; i < wins.length; i += 2) { (out[wins[i]] = out[wins[i]] || { wins: 0, losses: 0 }).wins = parseInt(wins[i + 1], 10) || 0; }
        for (let i = 0; i < losses.length; i += 2) { (out[losses[i]] = out[losses[i]] || { wins: 0, losses: 0 }).losses = parseInt(losses[i + 1], 10) || 0; }
        globalBoardCache = { at: Date.now(), data: out };
        return out;
    } catch (e) {
        console.error('eternal ledger read failed:', e.message);
        return null;
    }
}

// ============================================================================
// 📊 THE FIELD REPORT — anonymous, aggregate telemetry
// ============================================================================
// Not analytics on people: counters on the GAME. How many campaigns opened,
// how many actually began, how far they got before everyone wandered off.
// No names, no addresses, no room codes — only tallies. Written to the same
// Upstash store as the ledgers when configured, and to telemetry.json locally
// so it works with nothing configured at all.
const TELEMETRY_PATH = path.join(__dirname, 'telemetry.json');
let telemetry = {};
try { telemetry = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf8')) || {}; } catch (e) { telemetry = {}; }
let telemetryDirty = false;
// Batched to disk rather than written on every tick — a counter is not worth
// a file write, and this runs on a free instance.
const telemetryFlush = setInterval(() => {
    if (!telemetryDirty) return;
    telemetryDirty = false;
    try { fs.writeFileSync(TELEMETRY_PATH, JSON.stringify(telemetry, null, 1)); } catch (e) {}
}, 10000);
if (telemetryFlush.unref) telemetryFlush.unref();

// The ONLY keys that may ever be written. A client hands us a step name; if it
// is not on this list nothing happens. Never let a socket choose a store key.
const TEL_CLIENT_STEPS = new Set([
    'visit',          // the page loaded
    'smallscreen',    // …on something too small to play on
    'artfail',        // a painting failed to load
    'pageerror',      // an uncaught script error
    'rejoin_ok',      // a dropped commander got their seat back
    'rejoin_fail',    // …or did not
    'desync'          // a relayed battle disagreed with the shared dice
]);
const TEL_SERVER_STEPS = new Set([
    'room_created', 'room_joined', 'nation_picked', 'ready',
    'game_started', 'turn_5', 'turn_10', 'turn_20', 'turn_40',
    'game_finished', 'left_early', 'dropped', 'seat_lost',
    'quit_before_start', 'quit_turn_1_4', 'quit_turn_5_9',
    'quit_turn_10_19', 'quit_turn_20_plus'
]);
function tally(step, n) {
    if (!step) return;
    const inc = n || 1;
    telemetry[step] = (telemetry[step] || 0) + inc;
    telemetryDirty = true;
    if (globalLbEnabled()) {
        redisCmd(['HINCRBY', 'hegemony:telemetry', step, String(inc)]).catch(() => {});
    }
}
// Which turn were they on when they walked away? This is the whole point of
// the exercise — "where do people quit" is a question with a real answer.
function quitBucket(turnSeq, inGame) {
    if (!inGame) return 'quit_before_start';
    const t = turnSeq || 0;
    if (t < 5) return 'quit_turn_1_4';
    if (t < 10) return 'quit_turn_5_9';
    if (t < 20) return 'quit_turn_10_19';
    return 'quit_turn_20_plus';
}
// turnSeq counts SEATS played, not rounds — a five-power game burns five of them
// per lap. Milestones are in rounds, which is what a player would call "turn 5".
function roundsPlayed(room) {
    const seats = Math.max(1, (room.players || []).length);
    return Math.floor((room.turnSeq || 0) / seats);
}
function markTurnMilestone(room) {
    const t = roundsPlayed(room);
    room.milestones = room.milestones || new Set();
    [5, 10, 20, 40].forEach(m => {
        if (t >= m && !room.milestones.has(m)) { room.milestones.add(m); tally('turn_' + m); }
    });
}
let telemetryCache = { at: 0, data: null };
async function readTelemetry() {
    if (!globalLbEnabled()) return telemetry;
    if (telemetryCache.data && Date.now() - telemetryCache.at < 30000) return telemetryCache.data;
    try {
        const flat = await redisCmd(['HGETALL', 'hegemony:telemetry']) || [];
        const out = {};
        for (let i = 0; i < flat.length; i += 2) out[flat[i]] = parseInt(flat[i + 1], 10) || 0;
        telemetryCache = { at: Date.now(), data: out };
        return out;
    } catch (e) { return telemetry; }
}

const app = express();
app.use(cors());

// ---- the field report, as JSON and as a page you can just open ----
// Open by default (it is nothing but counters). Set TELEMETRY_KEY in the
// environment and it starts demanding ?key=… instead.
function telemetryAllowed(req) {
    const want = process.env.TELEMETRY_KEY || '';
    if (!want) return true;
    return String(req.query.key || '') === want;
}
app.get('/api/telemetry', async (req, res) => {
    if (!telemetryAllowed(req)) return res.status(403).json({ error: 'forbidden' });
    res.json(await readTelemetry());
});
app.get('/telemetry', async (req, res) => {
    if (!telemetryAllowed(req)) return res.status(403).type('txt').send('forbidden');
    const d = await readTelemetry();
    const n = k => d[k] || 0;
    const pct = (a, b) => b ? Math.round((a / b) * 100) + '%' : '—';
    const visits = n('visit');
    const funnel = [
        ['Opened the link', visits, visits],
        ['Opened a chamber', n('room_created'), visits],
        ['Joined one', n('room_joined'), visits],
        ['Chose a nation', n('nation_picked'), visits],
        ['Marked ready', n('ready'), visits],
        ['Campaign began', n('game_started'), visits],
        ['Reached turn 5', n('turn_5'), n('game_started')],
        ['Reached turn 10', n('turn_10'), n('game_started')],
        ['Reached turn 20', n('turn_20'), n('game_started')],
        ['Reached turn 40', n('turn_40'), n('game_started')],
        ['Played to a winner', n('game_finished'), n('game_started')]
    ];
    const quits = [
        ['Before the campaign began', n('quit_before_start')],
        ['Turns 1–4', n('quit_turn_1_4')],
        ['Turns 5–9', n('quit_turn_5_9')],
        ['Turns 10–19', n('quit_turn_10_19')],
        ['Turn 20 and beyond', n('quit_turn_20_plus')]
    ];
    const health = [
        ['Turned up on a phone', n('smallscreen')],
        ['Dropped connections', n('dropped')],
        ['Got their seat back', n('rejoin_ok')],
        ['Failed to get it back', n('rejoin_fail')],
        ['Seats finally lost', n('seat_lost')],
        ['Walked out mid-campaign', n('left_early')],
        ['Paintings that failed to load', n('artfail')],
        ['Script errors', n('pageerror')],
        ['Battles that failed the dice check', n('desync')]
    ];
    const bar = (v, max) => `<div class="bar"><i style="width:${max ? Math.max(1, Math.round((v / max) * 100)) : 0}%"></i></div>`;
    const rows = funnel.map(([label, v, base]) =>
        `<tr><td>${label}</td><td class="n">${v}</td><td class="p">${pct(v, base)}</td><td>${bar(v, visits || 1)}</td></tr>`).join('');
    const qmax = Math.max(1, ...quits.map(q => q[1]));
    const qrows = quits.map(([l, v]) => `<tr><td>${l}</td><td class="n">${v}</td><td>${bar(v, qmax)}</td></tr>`).join('');
    const hrows = health.map(([l, v]) => `<tr><td>${l}</td><td class="n">${v}</td></tr>`).join('');
    res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Hegemony — the field report</title><meta name="robots" content="noindex">
<style>
 body{background:#1a1512;color:#e8dcc8;font-family:Georgia,serif;margin:0;padding:40px 20px}
 .wrap{max-width:760px;margin:0 auto}
 h1{font-size:26px;letter-spacing:1px;margin:0 0 4px} .sub{color:#8a8d90;font-size:13px;margin-bottom:28px}
 h2{font-size:15px;text-transform:uppercase;letter-spacing:2px;color:#c9a227;margin:34px 0 10px;border-bottom:1px solid #3a3229;padding-bottom:6px}
 table{width:100%;border-collapse:collapse;font-size:14px}
 td{padding:7px 8px;border-bottom:1px solid #2a241d;vertical-align:middle}
 td.n{text-align:right;width:70px;font-weight:bold} td.p{text-align:right;width:60px;color:#8a8d90}
 .bar{background:#241f19;height:9px;border-radius:5px;width:180px;overflow:hidden}
 .bar i{display:block;height:100%;background:linear-gradient(90deg,#c9a227,#e8c65a)}
 .foot{margin-top:34px;color:#6a6259;font-size:12px}
</style></head><body><div class="wrap">
<h1>The Field Report</h1>
<div class="sub">Anonymous tallies only — no names, no addresses, no room codes.</div>
<h2>The funnel</h2><table>${rows}</table>
<h2>Where they stopped</h2><table>${qrows}</table>
<h2>Things going wrong</h2><table>${hrows}</table>
<div class="foot">Refreshes on reload. Cached for 30 seconds.</div>
</div></body></html>`);
});

// ---- 🔒 the project folder is NOT a public directory ----
// express.static(__dirname) published server.js, package.json, the test
// harness and every stray file next to them. Only what the game actually
// asks for is served now; everything else is a plain 404.
const PUBLIC_DIRS = ['art', 'maps', 'sound', 'vendor'];
const PUBLIC_FILES = new Set([
    'index.html', 'panzoom.min.js', 'favicon.ico', 'robots.txt',
    'neighbor_list.json', 'neighbor_list_latinamerica.json', 'neighbor_list_southamerica.json'
]);
const SERVABLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg',
    '.gif', '.webp', '.ico', '.txt', '.mp3', '.wav', '.ogg', '.m4a', '.woff', '.woff2', '.ttf']);

function publicPathFor(urlPath) {
    let rel;
    try { rel = decodeURIComponent(String(urlPath || '')); } catch (e) { return null; }
    if (rel.indexOf('\0') !== -1) return null;
    rel = rel.replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const root = path.resolve(__dirname);
    const abs = path.resolve(root, rel);
    // No climbing out of the folder, whatever the encoding tricks
    if (abs !== root && abs.indexOf(root + path.sep) !== 0) return null;
    const norm = path.relative(root, abs).split(path.sep).join('/');
    if (!norm) return null;
    if (!SERVABLE_EXT.has(path.extname(norm).toLowerCase())) return null;
    if (norm.indexOf('/') === -1) return PUBLIC_FILES.has(norm) ? abs : null;
    return PUBLIC_DIRS.indexOf(norm.split('/')[0]) !== -1 ? abs : null;
}

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.indexOf('/socket.io/') === 0) return next();   // the transport handles its own
    const file = publicPathFor(req.path);
    if (!file) return res.status(404).type('txt').send('Not found');
    res.sendFile(file, err => { if (err && !res.headersSent) res.status(404).type('txt').send('Not found'); });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code;
    do {
        code = '';
        for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    } while (rooms[code]);
    return code;
}

// ---- 🪑 SEATS: identity that outlives a socket ------------------------------
// A socket.id dies the instant the wifi blinks. Everything that matters — whose
// turn it is, who owns which nation, who is host — is keyed to a SEAT instead.
// The seat id is simply the socket.id the player first arrived on, and it never
// changes again; a returning player's new socket ADOPTS the old seat, so every
// other client's game state (which is keyed by that id) stays valid.
// A seat is held for GRACE_MS while its player is away, then released.
const GRACE_MS = 10 * 60 * 1000;   // a seat waits ten minutes for its commander
const EMPTY_ROOM_MS = 5 * 60 * 1000; // a room with nobody home survives five

function seatIdFor(room, socketId) {
    return (room.socketToSeat && room.socketToSeat[socketId]) || socketId;
}
function playerOf(room, socketId) {
    const sid = seatIdFor(room, socketId);
    return room.players.find(p => p.id === sid) || null;
}
function roomCodeOf(socketId) {
    for (const rc in rooms) if (playerOf(rooms[rc], socketId)) return rc;
    return null;
}
function isHostSocket(room, socketId) {
    return room.hostId === seatIdFor(room, socketId);
}
// A name is used as a leaderboard key and rendered on every other player's
// screen. Clamp it here so nothing downstream has to wonder how long it is.
function cleanName(n, fallback) {
    const s = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return s || (fallback || 'Commander');
}
function newToken() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
// The name a TURN travels under. AI seats already carry their faction string in
// .name; a human's .name is their own ("Joseph"), so when their nation must be
// played for them we hand over the faction string the map is actually keyed by.
function factionNameOf(p) {
    if (!p) return '';
    if (p.isAI) return p.name;
    if (p.nation && p.nation.name) return (p.nation.flag ? p.nation.flag + ' ' : '') + p.nation.name;
    return p.name;
}
// A seat plays itself only while someone is sitting in it.
function needsAI(p) { return !!(p && (p.isAI || p.away)); }
// Tokens are a seat's private key — they must never ride out to other clients.
function publicRoster(room) {
    return room.players.map(({ token, awayTimer, ...rest }) => rest);
}

// ---- ⏳ TURNS: bound to a player, not to an array slot ----------------------
// The old code stored a positional index and only clamped it on overflow, so a
// player leaving from ANYWHERE ahead of the pointer shifted every seat down one
// and silently stole the current player's turn. Identity can't drift like that.
function turnPlayer(room) {
    return room.players.find(p => p.id === room.currentTurnId) || room.players[0] || null;
}
function advanceTurn(room) {
    if (!room.players.length) return null;
    const idx = room.players.findIndex(p => p.id === room.currentTurnId);
    const prev = idx >= 0 ? room.players[idx] : null;
    const next = room.players[(idx + 1) % room.players.length]; // idx -1 → seat 0
    if (prev) prev.playedByHost = false;   // whatever the host was covering is finished
    room.currentTurnId = next ? next.id : null;
    // Every genuine advance carries a new number. Clients tick their per-turn
    // clocks ONCE per number, so a repeated announcement can never double-charge
    // income, burn a truce early, or run the campaign clock ahead.
    room.turnSeq = (room.turnSeq || 0) + 1;
    if (next) next.playedByHost = needsAI(next);
    if (room.inGame) markTurnMilestone(room);
    return next;
}
function turnPayload(room, p) {
    return {
        currentTurnId: p.id,
        currentTurnName: needsAI(p) ? factionNameOf(p) : p.name,
        currentTurnNation: p.nation,
        isAI: needsAI(p),
        away: !!p.away,
        seq: room.turnSeq || 0
    };
}
// ---- 🐕 THE WATCHDOG --------------------------------------------------------
// The last line of defence. Every freeze this game has ever had looked the same
// from the outside: a turn that never ends, no timeout, no way back. Clients are
// where the complicated logic lives, so clients are where the freezes come from
// — which means the recovery cannot live there too.
//
// The server now times every turn. If nobody ends it, the server does, and the
// campaign carries on. That turns ANY client-side stall — including ones nobody
// has found yet — from "the game is dead" into "somebody lost a turn".
// A human gets far longer than a machine: they might be thinking.
// Overridable so the test harness can watch a stall happen in a second rather
// than six minutes — and so these can be tuned in production without a rebuild.
const TURN_LIMIT_HUMAN = parseInt(process.env.TURN_LIMIT_HUMAN || '', 10) || 6 * 60 * 1000;
const TURN_LIMIT_AI = parseInt(process.env.TURN_LIMIT_AI || '', 10) || 90 * 1000;

function clearTurnWatch(room) {
    if (room && room.turnWatch) { clearTimeout(room.turnWatch); room.turnWatch = null; }
}
function armTurnWatch(roomCode, room) {
    clearTurnWatch(room);
    if (!room.inGame) return;
    const cur = turnPlayer(room);
    if (!cur) return;
    const seq = room.turnSeq;
    const limit = needsAI(cur) ? TURN_LIMIT_AI : TURN_LIMIT_HUMAN;
    room.turnWatch = setTimeout(() => {
        const r = rooms[roomCode];
        if (!r || !r.inGame || r.turnSeq !== seq) return;  // the turn moved on by itself
        const stuck = turnPlayer(r);
        console.log(`Watchdog: ${roomCode} stalled on ${stuck && stuck.name} — forcing the turn along`);
        io.to(roomCode).emit('turnForced', {
            seatId: stuck ? stuck.id : null,
            name: stuck ? factionNameOf(stuck) : '',
            wasAI: needsAI(stuck)
        });
        const next = advanceTurn(r);
        if (next) io.to(roomCode).emit('turnUpdated', turnPayload(r, next));
        armTurnWatch(roomCode, r);
    }, limit);
}

// "Somebody please play this seat." NOT a new turn — no clocks move. Sent when
// the seat holding the turn has nobody driving it: its player dropped, or the
// HOST dropped while a machine was mid-turn and took the only driver with them.
function requestDrive(roomCode, room) {
    const cur = turnPlayer(room);
    if (!cur || !needsAI(cur)) return;
    cur.playedByHost = true;
    io.to(roomCode).emit('turnDrive', turnPayload(room, cur));
    armTurnWatch(roomCode, room);
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        const token = newToken();
        rooms[roomCode] = {
            hostId: socket.id,
            theater: "Europe",
            diplomacy: "alliances",
            hordeEnabled: false,
            players: [{ id: socket.id, name: cleanName(playerName, 'Host'), isHost: true, isAI: false, nation: null, ready: false, token: token, away: false }],
            socketToSeat: { [socket.id]: socket.id },
            inGame: false,
            currentTurnId: socket.id
        };
        socket.join(roomCode);
        // The player's papers: with these they can reclaim this seat after a drop
        socket.emit('session', { roomCode, seatId: socket.id, token });
        socket.emit('roomCreated', { roomCode, players: publicRoster(rooms[roomCode]) });
        tally('room_created');
    });

    // 📊 The client reports only the handful of things the server cannot see for
    // itself. The step name is checked against a fixed list — a socket never
    // picks a store key — and each connection may report a step only once.
    socket.on('telemetry', (data) => {
        const step = data && typeof data.step === 'string' ? data.step : '';
        if (!TEL_CLIENT_STEPS.has(step)) return;
        socket._told = socket._told || new Set();
        if (socket._told.has(step) || socket._told.size >= 12) return;
        socket._told.add(step);
        tally(step);
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (rooms[roomCode]) {
            const room = rooms[roomCode];
            if (room.inGame) {
                // ---- 🔙 COMING BACK TO A CAMPAIGN IN PROGRESS ----------------
                // Refusing outright was wrong: a player who left — closed the tab,
                // swapped machines, lost a laptop to a flat battery — was locked
                // out of their own empire with no way back in. If a seat with this
                // commander's name is being held open, it is theirs to reclaim.
                const wanted = cleanName(playerName).toLowerCase();
                const held = room.players.find(p => !p.isAI && p.away && String(p.name).toLowerCase() === wanted);
                if (held) {
                    room.socketToSeat = room.socketToSeat || {};
                    room.socketToSeat[socket.id] = held.id;
                    held.away = false;
                    if (held.awayTimer) { clearTimeout(held.awayTimer); held.awayTimer = null; }
                    if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
                    socket.join(roomCode);
                    socket.emit('session', { roomCode, seatId: held.id, token: held.token });
                    const cur = turnPlayer(room);
                    socket.emit('sessionResumed', {
                        roomCode, seatId: held.id, inGame: true,
                        players: publicRoster(room),
                        isHost: room.hostId === held.id,
                        currentTurnId: cur ? cur.id : null
                    });
                    io.to(roomCode).emit('playerReturned', { seatId: held.id, name: held.name, players: publicRoster(room) });
                    brokerSnapshot(roomCode, room, held);   // and fetch them a board
                    tally('rejoin_ok');
                    console.log(`Rejoined ${roomCode} by name: ${held.name}`);
                    return;
                }
                tally('rejoin_fail');
                const waiting = room.players.filter(p => !p.isAI && p.away).map(p => p.name);
                socket.emit('errorMsg', waiting.length
                    ? 'That campaign is under way. Seats are being held for: ' + waiting.join(', ') + ' — use that exact name to rejoin.'
                    : 'That campaign is already under way.');
                return;
            }
            // The countdown is already running and was announced before this socket
            // existed. Letting them in here drops them onto the map with no nation.
            if (room.starting) { socket.emit('errorMsg', 'That campaign is starting right now — ask them to return to the chamber.'); return; }
            // A second click must not seat the same person twice. Two entries sharing
            // one id give the table a phantom seat that can never pick a nation.
            if (playerOf(room, socket.id)) {
                socket.join(roomCode);
                socket.emit('roomUpdated', { players: publicRoster(room) });
                return;
            }
            if (room.players.filter(p => !p.isAI).length >= 12) { socket.emit('errorMsg', 'That chamber is full.'); return; }
            const token = newToken();
            const player = { id: socket.id, name: cleanName(playerName), isHost: false, isAI: false, nation: null, ready: false, token: token, away: false };
            room.players.push(player);
            room.socketToSeat = room.socketToSeat || {};
            room.socketToSeat[socket.id] = socket.id;
            socket.join(roomCode);
            socket.emit('session', { roomCode, seatId: socket.id, token });
            io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
            socket.emit('theaterShifted', { theater: room.theater, players: publicRoster(room) });
            socket.emit('diplomacyShifted', { diplomacy: room.diplomacy || 'alliances' });
            socket.emit('hordeShifted', { enabled: !!room.hordeEnabled });
            tally('room_joined');
        } else {
            socket.emit('errorMsg', 'Room not found.');
        }
    });

    // ---- 📦 THE BOARD TRAVELS BETWEEN PLAYERS ---------------------------------
    // The server holds no game state, so when someone rejoins mid-campaign the
    // only place a complete board exists is in another player's browser. We ask
    // one of them for a copy and pass it along. Nothing is stored here.
    function brokerSnapshot(roomCode, room, seat) {
        const donor = room.players.find(p => !p.isAI && !p.away && p.id !== seat.id);
        if (!donor) { io.to(roomCode).emit('snapshotUnavailable', { forSeat: seat.id }); return; }
        room.pendingSnapshots = room.pendingSnapshots || {};
        room.pendingSnapshots[seat.id] = Date.now();
        for (const sid in (room.socketToSeat || {})) {
            if (room.socketToSeat[sid] === donor.id) io.to(sid).emit('snapshotRequest', { forSeat: seat.id });
        }
        // If no peer answers, say so rather than leaving them on a blank map.
        setTimeout(() => {
            const r = rooms[roomCode];
            if (!r || !r.pendingSnapshots || !r.pendingSnapshots[seat.id]) return;
            delete r.pendingSnapshots[seat.id];
            for (const sid in (r.socketToSeat || {})) {
                if (r.socketToSeat[sid] === seat.id) io.to(sid).emit('snapshotUnavailable', {});
            }
        }, 12000);
    }

    socket.on('snapshotOffer', ({ forSeat, state }) => {
        const roomCode = roomCodeOf(socket.id);
        if (!roomCode || !forSeat || !state) return;
        const room = rooms[roomCode];
        if (!room.pendingSnapshots || !room.pendingSnapshots[forSeat]) return;  // nobody asked
        delete room.pendingSnapshots[forSeat];
        const cur = turnPlayer(room);
        for (const sid in (room.socketToSeat || {})) {
            if (room.socketToSeat[sid] === forSeat) {
                io.to(sid).emit('gameSnapshot', {
                    state: state,
                    players: publicRoster(room),
                    currentTurnId: cur ? cur.id : null
                });
            }
        }
    });

    // 🔑 A player returns: same seat, same nation, new socket. Their token proves
    // the claim, so nobody else can walk into a stranger's empire.
    socket.on('resumeSession', ({ roomCode, token, needBoard }) => {
        const room = rooms[roomCode];
        if (!room) { socket.emit('resumeFailed', { reason: 'gone' }); return; }
        const seat = room.players.find(p => !p.isAI && p.token && p.token === token);
        if (!seat) { socket.emit('resumeFailed', { reason: 'seat' }); return; }

        room.socketToSeat = room.socketToSeat || {};
        room.socketToSeat[socket.id] = seat.id;   // the new socket adopts the old seat
        seat.away = false;
        if (seat.awayTimer) { clearTimeout(seat.awayTimer); seat.awayTimer = null; }
        if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
        socket.join(roomCode);

        const cur = turnPlayer(room);
        socket.emit('sessionResumed', {
            roomCode,
            seatId: seat.id,
            inGame: !!room.inGame,
            players: publicRoster(room),
            isHost: room.hostId === seat.id,
            currentTurnId: cur ? cur.id : null
        });
        if (room.inGame) {
            io.to(roomCode).emit('playerReturned', { seatId: seat.id, name: seat.name, players: publicRoster(room) });
            // A reconnecting socket usually still has its board in memory; a page
            // that RELOADED does not, and says so. Only then do we trouble a peer.
            if (needBoard) brokerSnapshot(roomCode, room, seat);
        } else {
            io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
        }
        console.log(`Seat reclaimed in ${roomCode}: ${seat.name}`);
    });

    socket.on('addAI', ({ nation }) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (isHostSocket(room, socket.id)) {
                const aiPlayer = {
                    id: 'ai_' + Math.random().toString(36).substr(2, 9),
                    name: '🤖 ' + nation.name,
                    isHost: false,
                    isAI: true,
                    nation: nation
                };
                room.players.push(aiPlayer);
                io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
                break;
            }
        }
    });

    // The host dismisses an AI sovereign from the lobby
    socket.on('removeAI', ({ id }) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (isHostSocket(room, socket.id)) {
                const before = room.players.length;
                room.players = room.players.filter(p => !(p.isAI && p.id === id));
                if (room.players.length !== before) {
                    if (!room.players.some(p => p.id === room.currentTurnId)) {
                        room.currentTurnId = room.players.length ? room.players[0].id : null;
                    }
                    io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
                }
                break;
            }
        }
    });

    socket.on('selectNation', ({ nationName, color, flag, capital }) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const player = playerOf(room, socket.id);
            if (player) {
                // Two humans holding one crown means every claim and war is filed
                // under the same faction string — the map cannot tell them apart.
                if (nationName) {
                    const taken = room.players.some(p => p !== player && !p.isAI && p.nation && p.nation.name === nationName);
                    if (taken) {
                        socket.emit('errorMsg', nationName + ' has already been claimed by another commander.');
                        socket.emit('roomUpdated', { players: publicRoster(room) });
                        break;
                    }
                }
                // A null nationName clears the pick — the player becomes a spectator
                player.nation = nationName ? { name: cleanName(nationName, 'Nation'), color: color, flag: flag, capital: capital } : null;
                player.ready = false; // a changed pick must be re-confirmed
                if (nationName && !player.everPicked) { player.everPicked = true; tally('nation_picked'); }
                io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
                break;
            }
        }
    });

    socket.on('updateTheater', (newTheater) => {
        for (const roomCode in rooms) {
            if (isHostSocket(rooms[roomCode], socket.id)) {
                rooms[roomCode].theater = newTheater;
                rooms[roomCode].players = rooms[roomCode].players.filter(p => !p.isAI);
                // Their nations are gone, so their readiness is meaningless — leaving
                // it set let the host start a campaign in which NOBODY had a nation.
                rooms[roomCode].players.forEach(p => { p.nation = null; p.ready = false; });
                io.to(roomCode).emit('theaterShifted', { theater: newTheater, players: publicRoster(rooms[roomCode]) });
                break;
            }
        }
    });

    // The host arms (or disarms) the Mongol Horde for the whole room
    socket.on('updateHorde', (enabled) => {
        for (const roomCode in rooms) {
            if (isHostSocket(rooms[roomCode], socket.id)) {
                rooms[roomCode].hordeEnabled = !!enabled;
                io.to(roomCode).emit('hordeShifted', { enabled: !!enabled });
                break;
            }
        }
    });

    socket.on('updateDiplomacy', (mode) => {
        for (const roomCode in rooms) {
            if (isHostSocket(rooms[roomCode], socket.id)) {
                if (['alliances', 'interventions', 'none'].includes(mode)) {
                    rooms[roomCode].diplomacy = mode;
                    io.to(roomCode).emit('diplomacyShifted', { diplomacy: mode });
                }
                break;
            }
        }
    });

    // ✋ A player declares themselves ready — only valid with nation AND capital picked
    socket.on('playerReady', (ready) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const player = playerOf(room, socket.id);
            if (player) {
                const equipped = !!(player.nation && player.nation.capital && player.nation.capital !== 'None');
                player.ready = !!ready && equipped;
                if (player.ready && !player.everReady) { player.everReady = true; tally('ready'); }
                io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
                break;
            }
        }
    });

    // The eternal ledger (all servers, all time) outranks the local file when configured
    socket.on('getLeaderboard', async () => {
        const g = await fetchGlobalBoard();
        socket.emit('leaderboard', g || leaderboard);
        const gn = await fetchGlobalNations();
        socket.emit('nationStats', gn || nationStats);
    });

    // 🏆 The host reports the game's result ONCE — wins and losses go to the ledger
    socket.on('gameResult', (data) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (!isHostSocket(room, socket.id)) continue;
            if (room.resultRecorded) break;
            room.resultRecorded = true;
            tally('game_finished');
            const gone = new Set(room.players.filter(p => p.forfeited).map(p => p.name));
            const names = (data && data.humanNames || []).filter(Boolean).filter(n => !gone.has(n));
            names.forEach(n => {
                leaderboard[n] = leaderboard[n] || { wins: 0, losses: 0 };
                if (n === data.winnerName) leaderboard[n].wins++; else leaderboard[n].losses++;
            });
            saveLeaderboard();
            recordGlobalResult(data && data.winnerName, names); // 🌍 and into the eternal ledger
            // ⚖️ every seated nation gets a game on its record; the winner a win
            const seats = (data && Array.isArray(data.nations) ? data.nations : [])
                .filter(x => x && typeof x.name === 'string' && x.name).slice(0, 60)
                .map(x => ({ name: x.name.slice(0, 60), ai: !!x.ai }));
            if (seats.length) recordNationResult(data && data.winnerNation, !!(data && data.winnerAI), seats);
            io.to(roomCode).emit('leaderboard', leaderboard);
            io.to(roomCode).emit('nationStats', nationStats);
            // once the shared store has digested the result, everyone sees the true all-time boards
            setTimeout(async () => {
                globalBoardCache = { at: 0, data: null };
                globalNationCache = { at: 0, data: null };
                const g = await fetchGlobalBoard();
                if (g) io.to(roomCode).emit('leaderboard', g);
                const gn = await fetchGlobalNations();
                if (gn) io.to(roomCode).emit('nationStats', gn);
            }, 2500);
            break;
        }
    });

    socket.on('startGame', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (isHostSocket(room, socket.id) && !room.starting) {
                // 🚦 No campaign begins until every commander with a crown is ready
                const humans = room.players.filter(p => !p.isAI);
                // The MOST SPECIFIC complaint first. A player without a capital can
                // never mark themselves ready, so leading with "not everyone is
                // ready" told them to do the one thing they had already tried.
                const equipped = humans.filter(p => p.nation && p.nation.capital && p.nation.capital !== 'None');
                const uncrowned = humans.filter(p => p.nation && !(p.nation.capital && p.nation.capital !== 'None'));
                if (uncrowned.length) {
                    socket.emit('errorMsg', 'Still choosing a capital: ' + uncrowned.map(p => p.name).join(', '));
                    break;
                }
                const blockers = humans.filter(p => p.nation && !p.ready);
                if (blockers.length) {
                    socket.emit('errorMsg', 'Not everyone is ready: ' + blockers.map(p => p.name).join(', '));
                    break;
                }
                if (!equipped.length) {
                    socket.emit('errorMsg', 'Nobody has chosen a nation yet.');
                    break;
                }
                if (room.players.length < 2) {
                    socket.emit('errorMsg', 'A campaign needs at least two powers — add an AI rival to begin.');
                    break;
                }
                room.starting = true;
                room.resultRecorded = false;
                // A room with other humans gets the full ceremony; a solo host, a short one
                const others = humans.filter(p => p.id !== room.hostId).length;
                const seconds = others > 0 ? 10 : 3;
                io.to(roomCode).emit('countdownStart', { seconds: seconds, theater: room.theater });
                room.startTimer = setTimeout(() => {
                    room.starting = false;
                    room.inGame = true;
                    room.currentTurnId = room.players[0].id;
                    room.turnSeq = 1;
                    room.players.forEach(p => { p.playedByHost = false; });
                    armTurnWatch(roomCode, room);
                    io.to(roomCode).emit('gameStarted', {
                        theater: room.theater,
                        players: publicRoster(room),
                        diplomacy: room.diplomacy || 'alliances',
                        currentTurnId: room.players[0].id,
                        isAI: needsAI(room.players[0]),
                        seq: room.turnSeq,
                        seed: Math.floor(Math.random() * 1000000000) // shared per-game seed: resource layout AND battle rolls
                    });
                    room.milestones = new Set();
                    tally('game_started');
                }, seconds * 1000);
                break;
            }
        }
    });

    // The war is over — bring the whole party back to their lobby, intact,
    // so no one has to rejoin. Players keep their nation picks.
    socket.on('returnToLobby', () => {
        for (const rc in rooms) {
            const r = rooms[rc];
            if (playerOf(r, socket.id)) {
                // A live campaign belongs to the whole table; one player cannot
                // end it for everyone. (Once it is over, anyone may reset.)
                if (r.inGame && !isHostSocket(r, socket.id)) {
                    socket.emit('errorMsg', 'Only the host can return the table to the chamber.');
                    return;
                }
                r.starting = false;
                if (r.startTimer) { clearTimeout(r.startTimer); r.startTimer = null; }
                r.players.forEach(p => { if (!p.isAI) p.ready = false; });
                break;
            }
        }
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (playerOf(room, socket.id)) {
                room.inGame = false;
                clearTurnWatch(room);
                room.players.filter(p => p.away).forEach(p => {
                    if (p.awayTimer) { clearTimeout(p.awayTimer); p.awayTimer = null; }
                });
                room.players = room.players.filter(p => !p.away);
                if (!room.players.some(p => p.id === room.hostId)) {
                    const h = room.players.find(p => !p.isAI);
                    if (h) { h.isHost = true; room.hostId = h.id; }
                }
                room.currentTurnId = room.players.length ? room.players[0].id : null;
                io.to(roomCode).emit('returnedToLobby', { players: publicRoster(room) });
                break;
            }
        }
    });

    // ---- 👑 A CROWN CHANGES HANDS ------------------------------------------------
    // When a nation is destroyed and a successor state rises in its place (the
    // English Civil War is the case that matters), the fallen player's SEAT is
    // handed to the machine and re-pointed at the new power. Without this the
    // successor holds land but is not a seat, so it never takes a turn — and
    // every table that waits on it (partitions, congresses) waits forever.
    socket.on('seatSuccession', ({ fallen, faction, capital, color }) => {
        const roomCode = roomCodeOf(socket.id);
        if (!roomCode || !faction) return;
        const room = rooms[roomCode];
        if (!isHostSocket(room, socket.id)) return;      // one narrator only
        if (room.players.some(p => p.name === faction)) return;  // already done

        // find the seat whose nation just fell
        const seat = room.players.find(p => factionNameOf(p) === fallen || p.name === fallen);
        if (!seat) return;

        seat.isAI = true;
        seat.token = null;               // no human returns to this chair
        if (seat.awayTimer) { clearTimeout(seat.awayTimer); seat.awayTimer = null; }
        seat.away = false;
        seat.isHost = false;
        seat.name = faction;             // AI seats carry their faction string as a name
        seat.nation = { name: faction, color: color || (seat.nation && seat.nation.color), capital: capital || null, flag: '' };

        if (room.hostId === seat.id) {   // the fallen player was hosting
            const heir = room.players.find(p => !p.isAI && !p.away);
            if (heir) { heir.isHost = true; room.hostId = heir.id; }
        }
        io.to(roomCode).emit('seatSucceeded', {
            seatId: seat.id, fallen: fallen, faction: faction,
            hostId: room.hostId, players: publicRoster(room)
        });
        // if the turn is sitting on that seat right now, it needs a driver
        requestDrive(roomCode, room);
        console.log(`Succession in ${roomCode}: ${fallen} → ${faction}`);
    });

    socket.on('endTurn', () => {
        const roomCode = roomCodeOf(socket.id);
        if (!roomCode) return;
        const room = rooms[roomCode];
        const currentPlayer = turnPlayer(room);
        const seatId = seatIdFor(room, socket.id);

        // You may end a turn if it is yours — or if you are the host and the
        // seat cannot end its own: a machine, or a commander who has dropped.
        const hostIsCovering = (needsAI(currentPlayer) || (currentPlayer && currentPlayer.playedByHost))
            && room.hostId === seatId;
        if (currentPlayer && (currentPlayer.id === seatId || hostIsCovering)) {
            const nextPlayer = advanceTurn(room);
            if (nextPlayer) io.to(roomCode).emit('turnUpdated', turnPayload(room, nextPlayer));
            armTurnWatch(roomCode, room);
        }
    });

    // Ordinary conquest is a private matter between a client and the map — the
    // server just passes it on. But during a Congress or a Partition the table
    // claims land SIMULTANEOUSLY and unarbitrated, and two clients reaching for
    // the same province each ended up seeing it owned by the other, permanently,
    // because each applied its own pick first and then took the peer's message
    // as gospel. When a claim is marked contested, the server decides — first
    // message to arrive wins — and tells EVERYONE, including the sender, so the
    // loser corrects itself instead of drifting.
    socket.on('claimProvince', (data) => {
        const roomCode = roomCodeOf(socket.id);
        if (!roomCode || !data || !data.regionId) return;
        const room = rooms[roomCode];

        if (data.contested) {
            const epoch = String(data.epoch || '');
            if (room.pickEpoch !== epoch) { room.pickEpoch = epoch; room.picks = {}; }
            const held = room.picks[data.regionId];
            if (held && held !== data.owner) {
                // Somebody got there first. Only the loser hears about it.
                socket.emit('pickRefused', { regionId: data.regionId, owner: held });
                return;
            }
            room.picks[data.regionId] = data.owner;
            io.to(roomCode).emit('provinceClaimed', data);   // everyone, sender included
            return;
        }
        socket.to(roomCode).emit('provinceClaimed', data);
    });

    // A whole war's territorial result in one dispatch instead of one per province.
    socket.on('claimProvinces', (data) => {
        const roomCode = roomCodeOf(socket.id);
        if (!roomCode || !data || !Array.isArray(data.claims) || !data.claims.length) return;
        socket.to(roomCode).emit('provincesClaimed', { claims: data.claims.slice(0, 600) });
    });

    // Lobby-wide chat: relay dispatches to EVERYONE in the room (including the
    // sender, so all clients render messages through the same single path).
    socket.on('chatMessage', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) {
                playerRoom = roomCode;
                break;
            }
        }
        if (playerRoom && data && typeof data.text === 'string' && data.text.trim().length > 0) {
            io.to(playerRoom).emit('chatMessage', {
                sender: String(data.sender || 'Unknown').substring(0, 60),
                text: data.text.trim().substring(0, 200)
            });
        }
    });

    // Relay coalition joins and alliance severances
    socket.on('coalitionJoin', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('coalitionJoin', data);
    });

    socket.on('allianceSever', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('allianceSever', data);
    });

    // Relay national events (event cards, secessions) to the rest of the room
    socket.on('nationalEvent', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('nationalEvent', data);
    });

    // Relay war proposals and intervention choices (Interventions mode)
    socket.on('warProposed', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('warProposed', data);
    });

    socket.on('interventionChoice', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('interventionChoice', data);
    });

    // Relay alliance offers and outcomes to the rest of the room
    socket.on('allianceRequest', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('allianceRequest', data);
    });

    socket.on('allianceResult', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('allianceResult', data);
    });

    // Relay fortifications and founded cities to the rest of the room
    socket.on('mapDevelopment', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) {
                playerRoom = roomCode;
                break;
            }
        }
        if (playerRoom) {
            socket.to(playerRoom).emit('mapDevelopment', data);
        }
    });

    // Relay a war declaration to everyone else in the room so the defender
    // (and any spectators) receive the battle event. The attacker's own
    // client plays the event locally, so we exclude the sender.
    socket.on('declareWar', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) {
                playerRoom = roomCode;
                break;
            }
        }
        if (playerRoom) {
            socket.to(playerRoom).emit('warDeclared', data);
        }
    });

    // Relay a mercenary hire so every client deducts the treasury and applies the
    // temporary power identically (the hirer applies it locally first).
    socket.on('mercHire', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (playerOf(rooms[roomCode], socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('mercHire', data);
    });

    // ---- 👋 A SOCKET DIES -----------------------------------------------------
    // In the LOBBY this still means "left" — nothing is at stake yet, so the seat
    // is vacated. MID-GAME it means only "gone quiet": an empire cannot evaporate
    // because a laptop lid closed. The seat is held, its nation is played by the
    // machine, and the commander can walk back into it with their token.
    socket.on('disconnect', () => {
        const roomCode = roomCodeOf(socket.id);
        if (!roomCode) return;
        const room = rooms[roomCode];
        const seat = playerOf(room, socket.id);
        if (!seat) return;
        if (room.socketToSeat) delete room.socketToSeat[socket.id];

        // A stale socket from a player who ALREADY reconnected: their seat is
        // occupied by a newer socket, so this death means nothing.
        const stillLive = Object.values(room.socketToSeat || {}).includes(seat.id);
        if (stillLive) return;

        if (!room.inGame) {
            // --- lobby: the old behaviour, minus the index bug ---
            if (!seat.isAI) tally('quit_before_start');
            room.players = room.players.filter(p => p.id !== seat.id);
            if (room.players.filter(p => !p.isAI).length === 0) {
                if (room.startTimer) clearTimeout(room.startTimer);
                clearTurnWatch(room);
                delete rooms[roomCode];
                return;
            }
            if (seat.isHost) {
                const nextHuman = room.players.find(p => !p.isAI);
                if (nextHuman) { nextHuman.isHost = true; room.hostId = nextHuman.id; }
            }
            if (!room.players.some(p => p.id === room.currentTurnId)) {
                room.currentTurnId = room.players[0].id;
            }
            io.to(roomCode).emit('roomUpdated', { players: publicRoster(room) });
            return;
        }

        // --- mid-game: hold the seat ---
        seat.away = true;
        seat.awaySince = Date.now();
        tally('dropped');
        tally(quitBucket(roundsPlayed(room), true));   // 📊 how far in did they get?

        // The host runs every machine turn, so the crown cannot sit with someone
        // who isn't there — pass it to a commander still at the table.
        let hostMoved = false;
        if (room.hostId === seat.id) {
            const heir = room.players.find(p => !p.isAI && !p.away);
            if (heir) {
                seat.isHost = false;
                heir.isHost = true;
                room.hostId = heir.id;
                hostMoved = true;
            }
        }

        io.to(roomCode).emit('playerAway', {
            seatId: seat.id,
            name: seat.name,
            faction: factionNameOf(seat),
            players: publicRoster(room),
            hostId: room.hostId,
            hostMoved: hostMoved
        });

        // If the seat holding the turn has nobody at the wheel — because its own
        // player just dropped, OR because the HOST dropped and took the only AI
        // driver with them — ask whoever holds the crown now to pick it up.
        requestDrive(roomCode, room);

        // The seat is theirs for a while, then it belongs to the machine for good.
        if (seat.awayTimer) clearTimeout(seat.awayTimer);
        seat.awayTimer = setTimeout(() => {
            if (!rooms[roomCode] || !seat.away) return;
            const deserter = seat.name;
            seat.token = null;                 // the claim expires
            seat.isAI = true;                  // the nation is the machine's now
            seat.name = '🤖 ' + (seat.nation && seat.nation.name ? seat.nation.name : seat.name);
            seat.forfeited = true;
            if (room.inGame) { recordForfeit(deserter); tally('left_early'); }
            tally('seat_lost');
            io.to(roomCode).emit('playerSurrendered', { seatId: seat.id, players: publicRoster(room) });
        }, GRACE_MS);

        // Nobody left at the table at all: keep the board standing a few minutes
        // in case they were all knocked off by the same dropped wifi.
        if (room.players.filter(p => !p.isAI && !p.away).length === 0) {
            if (room.emptyTimer) clearTimeout(room.emptyTimer);
            room.emptyTimer = setTimeout(() => {
                const r = rooms[roomCode];
                if (!r) return;
                if (r.players.filter(p => !p.isAI && !p.away).length === 0) {
                    r.players.forEach(p => { if (p.awayTimer) clearTimeout(p.awayTimer); });
                    if (r.startTimer) clearTimeout(r.startTimer);
                    clearTurnWatch(r);
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} closed — nobody returned`);
                }
            }, EMPTY_ROOM_MS);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Grand Strategy Server running on http://localhost:${PORT}`);
});