const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  // 短暂断线恢复：客户端切后台/切网络后 2 分钟内回来可自动补发消息
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  // 心跳敏感一点，尽快触发重连
  pingInterval: 20000,
  pingTimeout: 5000,
});

// 只暴露需要的静态文件，避免 server.js 被下载
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));

const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function nextPlayerName(room) {
  const used = new Set(room.players.map((p) => p.name));
  for (let i = 1; i <= 4; i++) {
    const n = '玩家' + i;
    if (!used.has(n)) return n;
  }
  return '玩家' + (room.players.length + 1);
}

function roundSnapshot(room, result) {
  return {
    round: room.round,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      word: p.currentWord || '',
    })),
    result,
  };
}

// 为某个玩家生成个性化状态（输入阶段不泄露别人的词）
function stateFor(room, playerId) {
  const me = room.players.find((p) => p.id === playerId);
  const reveal = room.phase === 'vote' || room.phase === 'ended';
  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    duration: room.duration,
    phase: room.phase,
    round: room.round,
    deadline: room.deadline,
    history: room.history,
    myId: playerId,
    myVote: me ? me.vote : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || '',
      connected: p.connected,
      submitted: p.submitted,
      isHost: p.id === room.hostId,
      word: reveal || p.id === playerId ? p.currentWord : null,
      vote: reveal ? p.vote : null,
    })),
  };
}

function broadcast(room) {
  room.players.forEach((p) => {
    if (!p.socketId) return;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('state', stateFor(room, p.id));
  });
}

function startRound(room) {
  room.phase = 'input';
  room.deadline = Date.now() + room.duration * 1000;
  room.players.forEach((p) => {
    p.submitted = false;
    p.currentWord = '';
    p.vote = null;
  });
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => endInput(room), room.duration * 1000);
  broadcast(room);
}

function endInput(room) {
  if (room.phase !== 'input') return;
  const words = room.players.map((p) => p.currentWord || '');
  const allNonEmpty = words.every((w) => w.trim() !== '');
  const allSame = allNonEmpty && words.every((w) => w === words[0]);

  if (allSame) {
    room.phase = 'ended';
    room.history.push(roundSnapshot(room, 'same-exact'));
    broadcast(room);
  } else {
    room.phase = 'vote';
    room.players.forEach((p) => {
      p.vote = null;
    });
    broadcast(room);
  }
}

// 一致性检查：所有在线玩家都选了且选择相同 → 推进
// 离线玩家视为弃权，避免一人掉线卡死整局
function checkVotes(room) {
  if (room.phase !== 'vote') return;
  const online = room.players.filter((p) => p.connected);
  if (online.length === 0) return;
  if (!online.every((p) => p.vote)) return;
  const first = online[0].vote;
  if (!online.every((p) => p.vote === first)) return;

  if (first === 'same') {
    room.phase = 'ended';
    room.history.push(roundSnapshot(room, 'same-manual'));
    broadcast(room);
  } else {
    // 【修复】：在进入下一轮前，把本轮的数据存入历史记录
    room.history.push(roundSnapshot(room, 'next'));
    room.round++;
    startRound(room);
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ maxPlayers, duration, avatar }, cb) => {
    maxPlayers = Math.min(4, Math.max(2, parseInt(maxPlayers, 10) || 2));
    duration = Math.min(100, Math.max(15, parseInt(duration, 10) || 30));

    const code = genCode();
    const playerId = genId();
    const room = {
      code,
      hostId: playerId,
      maxPlayers,
      duration,
      phase: 'lobby',
      round: 1,
      deadline: null,
      history: [],
      timer: null,
      players: [
        {
          id: playerId,
          name: '玩家1',
          avatar: avatar || '',
          connected: true,
          submitted: false,
          currentWord: '',
          vote: null,
          socketId: socket.id,
        },
      ],
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data = { code, playerId };
    if (cb) cb({ ok: true, playerId, state: stateFor(room, playerId) });
  });

  socket.on('joinRoom', ({ code, playerId, avatar }, cb) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: '房间不存在' });

    // 重连：playerId 存在且匹配
    if (playerId) {
      const p = room.players.find((x) => x.id === playerId);
      if (p) {
        p.connected = true;
        p.socketId = socket.id;
        socket.join(code);
        socket.data = { code, playerId };
        broadcast(room);
        checkVotes(room);
        return cb && cb({ ok: true, playerId, state: stateFor(room, playerId) });
      }
    }

    if (room.players.length >= room.maxPlayers) {
      return cb && cb({ ok: false, error: '房间已满' });
    }
    if (room.phase !== 'lobby') {
      return cb && cb({ ok: false, error: '游戏已开始，无法加入' });
    }

    const id = genId();
    room.players.push({
      id,
      name: nextPlayerName(room),
      avatar: avatar || '',
      connected: true,
      submitted: false,
      currentWord: '',
      vote: null,
      socketId: socket.id,
    });
    socket.join(code);
    socket.data = { code, playerId: id };
    broadcast(room);
    cb && cb({ ok: true, playerId: id, state: stateFor(room, id) });
  });

  socket.on('uploadAvatar', ({ avatar }) => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room || room.phase !== 'lobby') return; // 只能在大厅上传
    const p = room.players.find((x) => x.id === playerId);
    if (p) {
      p.avatar = String(avatar).slice(0, 20000); // 防刷限制
      broadcast(room);
    }
  });

  socket.on('updateDraft', ({ word }) => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room || room.phase !== 'input') return;
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    p.currentWord = String(word || '').slice(0, 10);
  });

  socket.on('submitWord', ({ word }) => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room || room.phase !== 'input') return;
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    
    p.currentWord = String(word || '').slice(0, 10);
    p.submitted = true;
    broadcast(room);

    // 检查是否所有人（在线）都提交了，如果是，直接结束输入阶段
    const allSubmitted = room.players.every((player) => player.submitted || !player.connected);
    if (allSubmitted) {
      if (room.timer) clearTimeout(room.timer);
      endInput(room);
    }
  });

  socket.on('vote', ({ choice }) => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room || room.phase !== 'vote') return;
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    if (choice !== 'same' && choice !== 'next') return;
    p.vote = choice;
    broadcast(room);
    checkVotes(room);
  });

  socket.on('startGame', () => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room || room.hostId !== playerId) return;
    if (room.players.filter((p) => p.connected).length < 2) return;
    room.round = 1;
    room.history = [];
    startRound(room);
  });

  socket.on('playAgain', () => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room || room.hostId !== playerId) return;
    room.round = 1;
    room.history = [];
    room.phase = 'lobby';
    room.deadline = null;
    if (room.timer) clearTimeout(room.timer);
    room.players.forEach((p) => {
      p.submitted = false;
      p.currentWord = '';
      p.vote = null;
    });
    broadcast(room);
  });

  socket.on('leaveRoom', () => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx >= 0) {
      room.players.splice(idx, 1);
      if (room.hostId === playerId && room.players.length) {
        room.hostId = room.players[0].id;
      }
      if (room.players.length === 0) {
        if (room.timer) clearTimeout(room.timer);
        rooms.delete(code);
      } else {
        broadcast(room);
      }
    }
    socket.leave(code);
    socket.data = {};
  });

  socket.on('disconnect', () => {
    const { code, playerId } = socket.data || {};
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.find((x) => x.id === playerId);
    // 只有当前绑定的 socket 断开才标记离线（避免旧 socket 覆盖重连后的新连接）
    if (p && p.socketId === socket.id) {
      p.connected = false;
      broadcast(room);
      checkVotes(room);
      if (room.players.every((x) => !x.connected)) {
        setTimeout(() => {
          const r = rooms.get(code);
          if (r && r.players.every((x) => !x.connected)) {
            if (r.timer) clearTimeout(r.timer);
            rooms.delete(code);
          }
        }, 10 * 60 * 1000);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`meet in mind server running on http://localhost:${PORT}`);
});