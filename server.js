const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

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
            players: [{ id: socket.id, name: playerName, isHost: true, isAI: false, nation: null }],
            currentTurnIndex: 0
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (rooms[roomCode]) {
            const player = { id: socket.id, name: playerName, isHost: false, isAI: false, nation: null };
            rooms[roomCode].players.push(player);
            socket.join(roomCode);
            io.to(roomCode).emit('roomUpdated', { players: rooms[roomCode].players });
            socket.emit('theaterShifted', { theater: rooms[roomCode].theater, players: rooms[roomCode].players });
            socket.emit('diplomacyShifted', { diplomacy: rooms[roomCode].diplomacy || 'alliances' });
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

    socket.on('startGame', () => {
        for (const roomCode in rooms) {
            if (rooms[roomCode].hostId === socket.id) {
                rooms[roomCode].currentTurnIndex = 0; 
                io.to(roomCode).emit('gameStarted', { 
                    theater: rooms[roomCode].theater, 
                    players: rooms[roomCode].players,
                    diplomacy: rooms[roomCode].diplomacy || 'alliances',
                    currentTurnId: rooms[roomCode].players[0].id,
                    isAI: rooms[roomCode].players[0].isAI
                });
                break;
            }
        }
    });

    // The war is over — bring the whole party back to their lobby, intact,
    // so no one has to rejoin. Players keep their nation picks.
    socket.on('returnToLobby', () => {
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