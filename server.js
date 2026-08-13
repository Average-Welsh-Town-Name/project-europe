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

const app = express();
app.use(cors());
app.use(express.static(__dirname)); 

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

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            theater: "Europe",
            diplomacy: "alliances",
            hordeEnabled: false,
            players: [{ id: socket.id, name: playerName, isHost: true, isAI: false, nation: null, ready: false }],
            currentTurnIndex: 0
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (rooms[roomCode]) {
            const player = { id: socket.id, name: playerName, isHost: false, isAI: false, nation: null, ready: false };
            rooms[roomCode].players.push(player);
            socket.join(roomCode);
            io.to(roomCode).emit('roomUpdated', { players: rooms[roomCode].players });
            socket.emit('theaterShifted', { theater: rooms[roomCode].theater, players: rooms[roomCode].players });
            socket.emit('diplomacyShifted', { diplomacy: rooms[roomCode].diplomacy || 'alliances' });
            socket.emit('hordeShifted', { enabled: !!rooms[roomCode].hordeEnabled });
        } else {
            socket.emit('errorMsg', 'Room not found.');
        }
    });

    socket.on('addAI', ({ nation }) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.hostId === socket.id) {
                const aiPlayer = {
                    id: 'ai_' + Math.random().toString(36).substr(2, 9),
                    name: '🤖 ' + nation.name,
                    isHost: false,
                    isAI: true,
                    nation: nation
                };
                room.players.push(aiPlayer);
                io.to(roomCode).emit('roomUpdated', { players: room.players });
                break;
            }
        }
    });

    // The host dismisses an AI sovereign from the lobby
    socket.on('removeAI', ({ id }) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.hostId === socket.id) {
                const before = room.players.length;
                room.players = room.players.filter(p => !(p.isAI && p.id === id));
                if (room.players.length !== before) {
                    if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
                    io.to(roomCode).emit('roomUpdated', { players: room.players });
                }
                break;
            }
        }
    });

    socket.on('selectNation', ({ nationName, color, flag, capital }) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                // A null nationName clears the pick — the player becomes a spectator
                player.nation = nationName ? { name: nationName, color: color, flag: flag, capital: capital } : null;
                player.ready = false; // a changed pick must be re-confirmed
                io.to(roomCode).emit('roomUpdated', { players: room.players });
                break;
            }
        }
    });

    socket.on('updateTheater', (newTheater) => {
        for (const roomCode in rooms) {
            if (rooms[roomCode].hostId === socket.id) {
                rooms[roomCode].theater = newTheater;
                rooms[roomCode].players = rooms[roomCode].players.filter(p => !p.isAI);
                rooms[roomCode].players.forEach(p => p.nation = null); 
                io.to(roomCode).emit('theaterShifted', { theater: newTheater, players: rooms[roomCode].players });
                break;
            }
        }
    });

    // The host arms (or disarms) the Mongol Horde for the whole room
    socket.on('updateHorde', (enabled) => {
        for (const roomCode in rooms) {
            if (rooms[roomCode].hostId === socket.id) {
                rooms[roomCode].hordeEnabled = !!enabled;
                io.to(roomCode).emit('hordeShifted', { enabled: !!enabled });
                break;
            }
        }
    });

    socket.on('updateDiplomacy', (mode) => {
        for (const roomCode in rooms) {
            if (rooms[roomCode].hostId === socket.id) {
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
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                const equipped = !!(player.nation && player.nation.capital && player.nation.capital !== 'None');
                player.ready = !!ready && equipped;
                io.to(roomCode).emit('roomUpdated', { players: room.players });
                break;
            }
        }
    });

    socket.on('getLeaderboard', () => socket.emit('leaderboard', leaderboard));

    // 🏆 The host reports the game's result ONCE — wins and losses go to the ledger
    socket.on('gameResult', (data) => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.hostId !== socket.id) continue;
            if (room.resultRecorded) break;
            room.resultRecorded = true;
            (data && data.humanNames || []).forEach(n => {
                if (!n) return;
                leaderboard[n] = leaderboard[n] || { wins: 0, losses: 0 };
                if (n === data.winnerName) leaderboard[n].wins++; else leaderboard[n].losses++;
            });
            saveLeaderboard();
            io.to(roomCode).emit('leaderboard', leaderboard);
            break;
        }
    });

    socket.on('startGame', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.hostId === socket.id && !room.starting) {
                // 🚦 No campaign begins until every commander with a crown is ready
                const humans = room.players.filter(p => !p.isAI);
                const blockers = humans.filter(p => p.nation && !p.ready);
                if (blockers.length) {
                    socket.emit('errorMsg', 'Not everyone is ready: ' + blockers.map(p => p.name).join(', '));
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
                    room.currentTurnIndex = 0;
                    io.to(roomCode).emit('gameStarted', {
                        theater: room.theater,
                        players: room.players,
                        diplomacy: room.diplomacy || 'alliances',
                        currentTurnId: room.players[0].id,
                        isAI: room.players[0].isAI,
                        seed: Math.floor(Math.random() * 1000000000) // shared per-game seed for resource layout
                    });
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
            if (r.players.some(p => p.id === socket.id)) {
                r.starting = false;
                if (r.startTimer) { clearTimeout(r.startTimer); r.startTimer = null; }
                r.players.forEach(p => { if (!p.isAI) p.ready = false; });
                break;
            }
        }
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.players.some(p => p.id === socket.id)) {
                room.currentTurnIndex = 0;
                io.to(roomCode).emit('returnedToLobby', { players: room.players });
                break;
            }
        }
    });

    socket.on('endTurn', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const currentPlayer = room.players[room.currentTurnIndex];
            
            if (currentPlayer && (currentPlayer.id === socket.id || (currentPlayer.isAI && room.hostId === socket.id))) {
                room.currentTurnIndex++;
                if (room.currentTurnIndex >= room.players.length) {
                    room.currentTurnIndex = 0;
                }
                const nextPlayer = room.players[room.currentTurnIndex];
                io.to(roomCode).emit('turnUpdated', { 
                    currentTurnId: nextPlayer.id,
                    currentTurnName: nextPlayer.name,
                    currentTurnNation: nextPlayer.nation,
                    isAI: nextPlayer.isAI
                });
                break;
            }
        }
    });

    socket.on('claimProvince', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) {
                playerRoom = roomCode;
                break;
            }
        }
        if (playerRoom) {
            socket.to(playerRoom).emit('provinceClaimed', data);
        }
    });

    // Lobby-wide chat: relay dispatches to EVERYONE in the room (including the
    // sender, so all clients render messages through the same single path).
    socket.on('chatMessage', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) {
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
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('coalitionJoin', data);
    });

    socket.on('allianceSever', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('allianceSever', data);
    });

    // Relay national events (event cards, secessions) to the rest of the room
    socket.on('nationalEvent', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('nationalEvent', data);
    });

    // Relay war proposals and intervention choices (Interventions mode)
    socket.on('warProposed', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('warProposed', data);
    });

    socket.on('interventionChoice', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('interventionChoice', data);
    });

    // Relay alliance offers and outcomes to the rest of the room
    socket.on('allianceRequest', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('allianceRequest', data);
    });

    socket.on('allianceResult', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('allianceResult', data);
    });

    // Relay fortifications and founded cities to the rest of the room
    socket.on('mapDevelopment', (data) => {
        let playerRoom = null;
        for (const roomCode in rooms) {
            if (rooms[roomCode].players.some(p => p.id === socket.id)) {
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
            if (rooms[roomCode].players.some(p => p.id === socket.id)) {
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
            if (rooms[roomCode].players.some(p => p.id === socket.id)) { playerRoom = roomCode; break; }
        }
        if (playerRoom) socket.to(playerRoom).emit('mercHire', data);
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const disconnectedPlayer = room.players.splice(playerIndex, 1)[0];
                
                if (room.players.filter(p => !p.isAI).length === 0) {
                    delete rooms[roomCode];
                } else {
                    if (disconnectedPlayer.isHost) {
                        const nextHuman = room.players.find(p => !p.isAI);
                        if (nextHuman) {
                            nextHuman.isHost = true;
                            room.hostId = nextHuman.id;
                        }
                    }
                    if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
                    
                    io.to(roomCode).emit('roomUpdated', { players: room.players });
                    const nextPlayer = room.players[room.currentTurnIndex];
                    io.to(roomCode).emit('turnUpdated', { 
                        currentTurnId: nextPlayer.id,
                        currentTurnName: nextPlayer.name,
                        currentTurnNation: nextPlayer.nation,
                        isAI: nextPlayer.isAI
                    });
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Grand Strategy Server running on http://localhost:${PORT}`);
});