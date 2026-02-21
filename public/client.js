const socket = io();

let roomState = {
  phase: 'lobby',
  users: [],
  captains: [],
  maps: [],
  teams: { 1: [], 2: [] },
  draftOrder: [],
  currentDraftPickerId: null,
  mapBanOrder: [],
  currentMapBanTurnId: null
};

const loginModal = document.getElementById('loginModal');
const mainContent = document.getElementById('mainContent');
const playerNameInput = document.getElementById('playerNameInput');
const joinButton = document.getElementById('joinButton');
const playButton = document.getElementById('playButton');
const playersList = document.getElementById('playersList');
const captainsInfo = document.getElementById('captainsInfo');
const draftInfo = document.getElementById('draftInfo');
const lobbyMessage = document.getElementById('lobbyMessage');
const draftArea = document.getElementById('draftArea');
const draftStatus = document.getElementById('draftStatus');
const team1List = document.getElementById('team1List');
const team2List = document.getElementById('team2List');
const poolList = document.getElementById('poolList');
const mapBanArea = document.getElementById('mapBanArea');
const statusMessage = document.getElementById('statusMessage');
const mapsContainer = document.getElementById('mapsContainer');
const resetButton = document.getElementById('resetButton');

// «Играю» — показать модалку ввода имени, если ещё не в списке
playButton.addEventListener('click', () => {
  const inList = roomState.users.some(u => u.id === socket.id);
  if (!inList) {
    playerNameInput.value = '';
    loginModal.classList.remove('hidden');
  }
});

joinButton.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (name) {
    socket.emit('addUser', name);
    loginModal.classList.add('hidden');
  }
});

playerNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinButton.click();
});

if (resetButton) resetButton.addEventListener('click', () => socket.emit('reset'));

socket.on('state', (state) => {
  roomState = state;
  updateUI();
});

function updateUI() {
  const phase = roomState.phase;

  lobbyMessage.classList.toggle('hidden', phase !== 'lobby');
  draftArea.classList.toggle('hidden', phase !== 'draft');
  mapBanArea.classList.toggle('hidden', phase !== 'mapBan');

  updatePlayButton();
  updatePlayersList();
  updateCaptainsInfo();

  if (phase === 'lobby') {
    // ничего больше
  } else if (phase === 'draft') {
    updateDraft();
  } else if (phase === 'mapBan') {
    updateMaps();
    updateMapBanStatus();
  }
}

function updatePlayButton() {
  const inList = roomState.users.some(u => u.id === socket.id);
  playButton.textContent = inList ? 'Вы в списке' : 'Играю';
  playButton.disabled = inList;
}

function updatePlayersList() {
  playersList.innerHTML = '';
  const inLobby = roomState.phase === 'lobby';
  roomState.users.forEach(user => {
    const el = document.createElement('div');
    el.className = `player-item ${user.isCaptain ? 'captain' : ''}`;

    const name = document.createElement('span');
    name.className = `player-name ${user.isCaptain ? 'captain' : ''}`;
    name.textContent = user.name;

    const btn = document.createElement('button');
    btn.className = 'btn-captain';
    if (user.isCaptain && inLobby && user.id === socket.id) {
      btn.textContent = 'Перестать быть капитаном';
      btn.classList.add('btn-leave-captain');
      btn.addEventListener('click', () => socket.emit('leaveCaptain'));
    } else {
      btn.textContent = user.isCaptain ? 'Капитан' : 'Стать капитаном';
      btn.disabled = user.isCaptain || roomState.captains.length >= 2;
      if (!user.isCaptain && roomState.captains.length < 2 && user.id === socket.id) {
        btn.addEventListener('click', () => socket.emit('becomeCaptain'));
      } else if (!user.isCaptain && roomState.captains.length < 2 && user.id !== socket.id) {
        btn.disabled = true;
        btn.title = 'Может нажать только сам участник';
      }
    }

    el.appendChild(name);
    el.appendChild(btn);
    playersList.appendChild(el);
  });
}

function updateCaptainsInfo() {
  if (roomState.phase !== 'lobby') {
    captainsInfo.innerHTML = '';
    captainsInfo.classList.add('hidden');
    return;
  }
  captainsInfo.classList.remove('hidden');
  const captains = roomState.users.filter(u => u.isCaptain);
  if (captains.length === 0) {
    captainsInfo.innerHTML = '<h3>Капитаны</h3><p style="color:#888;font-size:14px;">Ожидание капитанов (нужно 2). Участников: ' + roomState.users.length + ' / 10</p>';
  } else {
    captainsInfo.innerHTML = '<h3>Капитаны</h3>' + captains.map(c => `<div class="captain-name">👑 ${c.name}</div>`).join('');
  }
}

function getPool() {
  const t1 = new Set(roomState.teams[1] || []);
  const t2 = new Set(roomState.teams[2] || []);
  return roomState.users.filter(u => !t1.has(u.id) && !t2.has(u.id));
}

function getUser(id) {
  return roomState.users.find(u => u.id === id);
}

function updateDraft() {
  const pool = getPool();
  const currentPicker = roomState.currentDraftPickerId ? getUser(roomState.currentDraftPickerId) : null;
  const isMyTurn = roomState.currentDraftPickerId === socket.id;

  draftStatus.textContent = currentPicker
    ? (isMyTurn ? 'Ваш ход — выберите игрока в команду' : `Выбирает: ${currentPicker.name}`)
    : 'Драфт завершён';
  draftStatus.className = 'status-message' + (isMyTurn ? ' my-turn' : '');

  const t1 = roomState.teams[1] || [];
  const t2 = roomState.teams[2] || [];
  const cap1 = t1[0];
  const cap2 = t2[0];

  team1List.innerHTML = t1.map(id => {
    const u = getUser(id);
    const isCap = id === cap1;
    return `<div class="team-player ${isCap ? 'captain' : ''}">${u ? u.name : id}${isCap ? ' 👑' : ''}</div>`;
  }).join('');

  team2List.innerHTML = t2.map(id => {
    const u = getUser(id);
    const isCap = id === cap2;
    return `<div class="team-player ${isCap ? 'captain' : ''}">${u ? u.name : id}${isCap ? ' 👑' : ''}</div>`;
  }).join('');

  poolList.innerHTML = '';
  pool.forEach(user => {
    const el = document.createElement('div');
    el.className = 'pool-player' + (isMyTurn ? '' : ' disabled');
    el.textContent = user.name;
    if (isMyTurn) {
      el.addEventListener('click', () => socket.emit('pickPlayer', user.id));
    }
    poolList.appendChild(el);
  });
}

function updateMapBanStatus() {
  const active = roomState.maps.filter(m => !m.banned);
  if (active.length === 1) {
    statusMessage.className = 'status-message winner';
    statusMessage.textContent = `🏆 Карта: ${active[0].name.toUpperCase()}`;
    return;
  }
  const turnId = roomState.currentMapBanTurnId;
  const turnUser = turnId ? getUser(turnId) : null;
  const isMyTurn = turnId === socket.id;
  statusMessage.className = 'status-message' + (isMyTurn ? ' my-turn' : '');
  statusMessage.textContent = turnUser
    ? (isMyTurn ? 'Ваш ход — забанить одну карту' : `Ход капитана: ${turnUser.name}`)
    : `Осталось карт: ${active.length}`;
}

// Фоновые изображения карт (Valorant Wiki)
const MAP_IMAGES = {
  abyss: 'https://static.wikia.nocookie.net/valorant/images/4/4b/Loading_Screen_Abyss.png',
  ascent: 'https://static.wikia.nocookie.net/valorant/images/2/2b/Loading_Screen_Ascent.png',
  bind: 'https://static.wikia.nocookie.net/valorant/images/9/9c/Loading_Screen_Bind.png',
  breeze: 'https://static.wikia.nocookie.net/valorant/images/d/d4/Loading_Screen_Breeze.png',
  corrode: 'https://static.wikia.nocookie.net/valorant/images/4/4b/Loading_Screen_Abyss.png',
  fracture: 'https://static.wikia.nocookie.net/valorant/images/2/2f/Loading_Screen_Fracture.png',
  haven: 'https://static.wikia.nocookie.net/valorant/images/7/7d/Loading_Screen_Haven.png',
  icebox: 'https://static.wikia.nocookie.net/valorant/images/1/1b/Loading_Screen_Icebox.png',
  lotus: 'https://static.wikia.nocookie.net/valorant/images/5/5d/Loading_Screen_Lotus.png',
  pearl: 'https://static.wikia.nocookie.net/valorant/images/2/2a/Loading_Screen_Pearl.png',
  split: 'https://static.wikia.nocookie.net/valorant/images/2/23/Loading_Screen_Split.png',
  sunset: 'https://static.wikia.nocookie.net/valorant/images/9/9e/Loading_Screen_Sunset.png'
};

function updateMaps() {
  mapsContainer.innerHTML = '';
  const isMyTurn = roomState.currentMapBanTurnId === socket.id;

  roomState.maps.forEach(map => {
    const card = document.createElement('div');
    card.className = 'map-card' + (map.banned ? ' banned' : '') + (!map.banned && !isMyTurn ? ' disabled' : '');
    const imgUrl = MAP_IMAGES[map.name];
    if (imgUrl) {
      card.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url(${imgUrl})`;
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'map-name';
    nameEl.textContent = map.name;
    card.appendChild(nameEl);
    if (!map.banned && isMyTurn) {
      card.addEventListener('click', () => socket.emit('banMap', map.name));
    }
    mapsContainer.appendChild(card);
  });
}
