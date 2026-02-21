const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// База никнеймов (сохраняется в data/nicknames.json)
const NICKNAMES_PATH = path.join(__dirname, 'data', 'nicknames.json');
const MIGRATION_PATH = path.join(__dirname, 'data', 'migration-nicknames.json');

function loadNicknames() {
  try {
    const data = fs.readFileSync(NICKNAMES_PATH, 'utf8');
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveNicknames(nicknames) {
  try {
    const dir = path.dirname(NICKNAMES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(NICKNAMES_PATH, JSON.stringify(nicknames, null, 2), 'utf8');
  } catch (err) {
    console.error('Ошибка сохранения никнеймов:', err.message);
  }
}

let registeredNicknames = loadNicknames();

// При старте: загрузить никнеймы из миграции (записаны предыдущим процессом при остановке)
try {
  if (fs.existsSync(MIGRATION_PATH)) {
    const data = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const arr = JSON.parse(data);
    if (Array.isArray(arr) && arr.length > 0) {
      arr.forEach(n => {
        const name = (n || '').trim();
        if (name) {
          const lower = name.toLowerCase();
          if (!registeredNicknames.some(x => x.toLowerCase() === lower)) {
            registeredNicknames.push(name);
          }
        }
      });
      saveNicknames(registeredNicknames);
      fs.unlinkSync(MIGRATION_PATH);
      console.log('📋 Миграция: добавлено', arr.length, 'никнеймов из предыдущей сессии');
    }
  }
} catch (e) {
  console.error('Ошибка миграции никнеймов:', e.message);
}

function registerNickname(name) {
  const n = (name || '').trim();
  if (!n) return;
  const lower = n.toLowerCase();
  if (!registeredNicknames.some(x => x.toLowerCase() === lower)) {
    registeredNicknames.push(n);
    saveNicknames(registeredNicknames);
  }
}

function unregisterNickname(name) {
  const n = (name || '').trim();
  if (!n) return;
  const lower = n.toLowerCase();
  const idx = registeredNicknames.findIndex(x => x.toLowerCase() === lower);
  if (idx >= 0) {
    registeredNicknames.splice(idx, 1);
    saveNicknames(registeredNicknames);
  }
}

const MAP_NAMES = [
  'abyss', 'ascent', 'bind', 'breeze', 'corrode', 'fracture',
  'haven', 'icebox', 'lotus', 'pearl', 'split', 'sunset'
];

function createInitialMaps() {
  return MAP_NAMES.map(name => ({ name, banned: false }));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let roomState = {
  phase: 'lobby', // 'lobby' | 'draft' | 'mapBan'
  users: [],
  captains: [],
  maps: createInitialMaps(),
  // draft
  teams: { 1: [], 2: [] },
  draftOrder: [],       // [firstPickerId, secondPickerId]
  currentDraftPickerId: null,
  extraPicksRemaining: 0, // после выбора asura — другой капитан берёт 2 подряд
  // mapBan
  mapBanOrder: [],      // [firstBanId, secondBanId] — первым банит тот, кто выбирал вторым в драфте
  currentMapBanTurnId: null
};

function tryStartDraft() {
  if (roomState.phase !== 'lobby') return;
  if (roomState.captains.length !== 2 || roomState.users.length < 10) return;

  const [c1, c2] = roomState.captains;
  roomState.phase = 'draft';
  roomState.teams = { 1: [c1], 2: [c2] };
  roomState.draftOrder = shuffle([c1, c2]);
  roomState.currentDraftPickerId = roomState.draftOrder[0];
}

function getPool() {
  const inTeam1 = new Set(roomState.teams[1]);
  const inTeam2 = new Set(roomState.teams[2]);
  return roomState.users.filter(u => !inTeam1.has(u.id) && !inTeam2.has(u.id));
}

function tryStartMapBan() {
  if (roomState.teams[1].length !== 5 || roomState.teams[2].length !== 5) return;

  roomState.phase = 'mapBan';
  // Первым банит карты тот, кто выбирал игроков вторым
  const [firstPicker, secondPicker] = roomState.draftOrder;
  roomState.mapBanOrder = [secondPicker, firstPicker];
  roomState.currentMapBanTurnId = roomState.mapBanOrder[0];
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.emit('state', roomState);

  socket.on('addUser', (userName) => {
    const name = (userName || '').trim();
    if (!name) return;

    const n = name.toLowerCase();
    const existingByName = roomState.users.find(u => (u.name || '').toLowerCase() === n);
    if (existingByName) {
      // Имя уже есть — текущий сокет «становится» этим участником
      const oldId = existingByName.id;
      existingByName.id = socket.id;
      if (roomState.captains.includes(oldId)) {
        roomState.captains = roomState.captains.map(id => id === oldId ? socket.id : id);
      }
      roomState.teams[1] = roomState.teams[1].map(id => id === oldId ? socket.id : id);
      roomState.teams[2] = roomState.teams[2].map(id => id === oldId ? socket.id : id);
      roomState.draftOrder = roomState.draftOrder.map(id => id === oldId ? socket.id : id);
      if (roomState.currentDraftPickerId === oldId) roomState.currentDraftPickerId = socket.id;
      roomState.mapBanOrder = roomState.mapBanOrder.map(id => id === oldId ? socket.id : id);
      if (roomState.currentMapBanTurnId === oldId) roomState.currentMapBanTurnId = socket.id;
    } else {
      const existingBySocket = roomState.users.findIndex(u => u.id === socket.id);
      if (existingBySocket !== -1) {
        roomState.users[existingBySocket].name = name;
      } else {
        roomState.users.push({
          id: socket.id,
          name,
          isCaptain: false
        });
      }
    }
    registerNickname(name);
    tryStartDraft();
    io.emit('state', roomState);
  });

  socket.on('removeUser', () => {
    if (roomState.phase !== 'lobby') return;
    roomState.users = roomState.users.filter(u => u.id !== socket.id);
    roomState.captains = roomState.captains.filter(id => id !== socket.id);
    io.emit('state', roomState);
  });

  // Добавить участника за другого человека (оффлайн / от имени другого)
  socket.on('addUserOnBehalf', (userName) => {
    const name = (userName || '').trim();
    if (!name) return;
    const syntheticId = 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    roomState.users.push({
      id: syntheticId,
      name,
      isCaptain: false
    });
    registerNickname(name);
    tryStartDraft();
    io.emit('state', roomState);
  });

  socket.on('getRegisteredNicknames', () => {
    const inRoom = new Set(roomState.users.map(u => (u.name || '').toLowerCase()));
    const available = registeredNicknames.filter(n => !inRoom.has((n || '').toLowerCase()));
    socket.emit('registeredNicknames', available);
  });

  socket.on('updateNickname', (newName) => {
    const name = (newName || '').trim();
    if (!name) return;
    const user = roomState.users.find(u => u.id === socket.id);
    if (!user) return;
    const oldName = user.name;
    user.name = name;
    unregisterNickname(oldName);
    registerNickname(name);
    io.emit('state', roomState);
  });

  socket.on('becomeCaptain', () => {
    if (roomState.phase !== 'lobby') return;
    const user = roomState.users.find(u => u.id === socket.id);
    if (!user || roomState.captains.length >= 2 || user.isCaptain) return;

    user.isCaptain = true;
    roomState.captains.push(user.id);
    roomState.captains = roomState.captains.slice(0, 2);
    tryStartDraft();
    io.emit('state', roomState);
  });

  socket.on('leaveCaptain', () => {
    if (roomState.phase !== 'lobby') return;
    const user = roomState.users.find(u => u.id === socket.id);
    if (!user || !user.isCaptain) return;

    user.isCaptain = false;
    roomState.captains = roomState.captains.filter(id => id !== socket.id);
    io.emit('state', roomState);
  });

  socket.on('pickPlayer', (pickedUserId) => {
    if (roomState.phase !== 'draft') return;
    if (roomState.currentDraftPickerId !== socket.id) return;

    const pool = getPool();
    const pickedUser = pool.find(u => u.id === pickedUserId);
    if (!pickedUser) return;

    const captainTeam = roomState.teams[1].includes(socket.id) ? 1 : 2;
    roomState.teams[captainTeam].push(pickedUserId);

    // Правило для asura: тот, кто взял asura, отдаёт ход другому капитану на 2 выбора подряд
    const isAsura = (pickedUser.name || '').toLowerCase().trim() === 'asura';
    const otherCaptainId = roomState.draftOrder[0] === socket.id ? roomState.draftOrder[1] : roomState.draftOrder[0];
    if (isAsura) {
      roomState.currentDraftPickerId = otherCaptainId;
      roomState.extraPicksRemaining = 2;
    } else {
      tryStartMapBan();
      if (roomState.phase === 'draft') {
        if (roomState.extraPicksRemaining > 0) {
          roomState.extraPicksRemaining--;
          if (roomState.extraPicksRemaining === 0) {
            roomState.currentDraftPickerId = roomState.draftOrder[0] === socket.id ? roomState.draftOrder[1] : roomState.draftOrder[0];
          }
        } else {
          roomState.currentDraftPickerId = roomState.draftOrder[0] === socket.id ? roomState.draftOrder[1] : roomState.draftOrder[0];
        }
      }
    }
    io.emit('state', roomState);
  });

  socket.on('banMap', (mapName) => {
    if (roomState.phase !== 'mapBan') return;
    if (roomState.currentMapBanTurnId !== socket.id) return;

    const map = roomState.maps.find(m => m.name === mapName);
    if (!map || map.banned) return;

    map.banned = true;
    const activeMaps = roomState.maps.filter(m => !m.banned);
    if (activeMaps.length > 1) {
      const idx = roomState.mapBanOrder.indexOf(socket.id);
      roomState.currentMapBanTurnId = roomState.mapBanOrder[(idx + 1) % 2];
    } else {
      roomState.currentMapBanTurnId = null;
    }
    io.emit('state', roomState);
  });

  socket.on('reset', () => {
    roomState.phase = 'lobby';
    roomState.users = [];
    roomState.captains = [];
    roomState.maps = createInitialMaps();
    roomState.teams = { 1: [], 2: [] };
    roomState.draftOrder = [];
    roomState.currentDraftPickerId = null;
    roomState.extraPicksRemaining = 0;
    roomState.mapBanOrder = [];
    roomState.currentMapBanTurnId = null;
    io.emit('state', roomState);
  });

  socket.on('disconnect', () => {
    // Участника не удаляем из списка при закрытии вкладки — он остаётся в лобби
    roomState.captains = roomState.captains.filter(id => id !== socket.id);
    if (roomState.phase === 'draft' || roomState.phase === 'mapBan') {
      roomState.teams[1] = roomState.teams[1].filter(id => id !== socket.id);
      roomState.teams[2] = roomState.teams[2].filter(id => id !== socket.id);
      const stillHaveTwoCaptains = roomState.captains.length === 2;
      if (!stillHaveTwoCaptains || roomState.users.length < 10) {
        roomState.phase = 'lobby';
        roomState.teams = { 1: [], 2: [] };
        roomState.draftOrder = [];
        roomState.currentDraftPickerId = null;
        roomState.extraPicksRemaining = 0;
        roomState.mapBanOrder = [];
        roomState.currentMapBanTurnId = null;
        roomState.maps = createInitialMaps();
      }
    }
    io.emit('state', roomState);
    console.log('User disconnected:', socket.id);
  });
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
const localIP = getLocalIP();

// Сохранить никнеймы текущих участников для миграции при следующем рестарте
function saveCurrentUsersForMigration() {
  try {
    const nicknames = roomState.users.map(u => (u.name || '').trim()).filter(Boolean);
    if (nicknames.length === 0) return;
    const dir = path.dirname(MIGRATION_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MIGRATION_PATH, JSON.stringify(nicknames, null, 2), 'utf8');
  } catch (e) {
    console.error('Ошибка сохранения миграции:', e.message);
  }
}

// Периодически сохранять текущих участников (каждую минуту)
setInterval(saveCurrentUsersForMigration, 60000);

process.on('SIGTERM', () => { saveCurrentUsersForMigration(); process.exit(0); });
process.on('SIGINT', () => { saveCurrentUsersForMigration(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('🚀 Valorant Map Ban Server запущен!');
  console.log('========================================');
  console.log(`📍 Локальный доступ:  http://localhost:${PORT}`);
  console.log(`🌐 Сетевой доступ:    http://${localIP}:${PORT}`);
  console.log('========================================\n');

  if (process.argv.includes('--tunnel') || process.env.USE_TUNNEL === 'true') {
    console.log('🌍 Запуск Cloudflare Tunnel...\n');
    const { spawn } = require('child_process');
    const tunnel = spawn('npx', ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`], {
      shell: true,
      stdio: 'inherit'
    });
    tunnel.on('error', (err) => console.error('❌ Туннель:', err.message));
    tunnel.on('exit', (code) => { if (code !== 0 && code != null) console.log('💡 Туннель закрыт.'); });
  } else {
    console.log('💡 Для доступа из интернета: node server.js --tunnel\n');
  }
});
