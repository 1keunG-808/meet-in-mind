/* global io */
const socket = io();

const $ = (sel) => document.querySelector(sel);

let currentState = null;
let lastPhase = null;
let myId = localStorage.getItem('mm_playerId') || null;
let myCode = localStorage.getItem('mm_code') || null;
let timerInterval = null;
let draftDebounce = null;

/* ============ 主题 ============ */
const root = document.documentElement;
let theme = localStorage.getItem('mm_theme') || 'light';
root.dataset.theme = theme;

// 初始化图标状态（light 显示月亮，dark 显示太阳）
const iconSwap = document.querySelector('.t-icon-swap');
if (iconSwap) {
  iconSwap.dataset.state = theme === 'light' ? 'a' : 'b';
}

$('#themeToggle').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = theme;
  localStorage.setItem('mm_theme', theme);
  
  // 切换图标动画
  if (iconSwap) {
    iconSwap.dataset.state = theme === 'light' ? 'a' : 'b';
  }
});

// ====== 全局头像逻辑 ======
function initGlobalAvatar() {
  const el = $('#globalAvatarBtn');
  const saved = localStorage.getItem('mm_avatar');
  if (saved) {
    el.innerHTML = `<img src="${saved}" alt="avatar">`;
  } else {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;color:var(--muted);margin:auto;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  }
}
initGlobalAvatar();

// 点击全局头像触发文件选择
$('#globalAvatarBtn').addEventListener('click', () => {
  $('#avatarFileInput').click();
});

/* ============ 工具 ============ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (name !== 'input' && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function clearSession() {
  currentState = null;
  lastPhase = null;
  myId = null;
  myCode = null;
  localStorage.removeItem('mm_playerId');
  localStorage.removeItem('mm_code');
}

function showHomeError(msg) {
  $('#homeError').textContent = msg || '';
}

/* ============ 连接 ============ */
socket.on('connect', () => {
  document.body.classList.remove('disconnected');
  if (!currentState && myId && myCode) {
    socket.emit('joinRoom', { code: myCode, playerId: myId }, (res) => {
      if (res && res.ok) {
        applyState(res.state);
      } else {
        clearSession();
        showScreen('home');
      }
    });
  }
});

socket.on('disconnect', () => {
  document.body.classList.add('disconnected');
});

socket.on('state', applyState);

function applyState(state) {
  currentState = state;
  myId = state.myId;
  myCode = state.code;
  localStorage.setItem('mm_playerId', myId);
  localStorage.setItem('mm_code', myCode);
  render();
}

/* ============ 渲染入口 ============ */
function render() {
  const s = currentState;
  if (!s) {
    showScreen('home');
    return;
  }

  if (s.phase !== lastPhase) {
    lastPhase = s.phase;
    showScreen(s.phase);
    if (s.phase === 'input') initInputScreen(s);
  }

  if (s.phase === 'lobby') renderLobby(s);
  else if (s.phase === 'input') renderInput(s);
  else if (s.phase === 'vote') renderVote(s);
  else if (s.phase === 'ended') renderEnded(s);
}

/* ============ 首页 ============ */
let selectedPlayers = 2;
let selectedDuration = 30;

// 计算并更新滑块位置
function updateTabPill(container, animate = true) {
  if (!container) return;
  const pill = container.querySelector('.sliding-tabs-pill');
  const activeTab = container.querySelector('.sliding-tabs button.active');
  if (pill && activeTab) {
    if (!animate) {
      pill.style.transition = 'none'; // 禁用动画以便瞬间吸附
    }
    pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
    pill.style.width = `${activeTab.offsetWidth}px`;
    if (!animate) {
      void pill.offsetWidth; // 强制重排 (Reflow)
      pill.style.transition = 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1), width 250ms cubic-bezier(0.22, 1, 0.36, 1)';
    }
  }
}

$('#playerCount').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  selectedPlayers = Number(btn.dataset.value);
  $('#playerCount').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  updateTabPill($('#playerCount'));
});

$('#durationPreset').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  const isCustom = btn.dataset.value === 'custom';
  const wrapper = $('#customTimeWrapper');

  if (isCustom) {
    wrapper.classList.remove('collapsed');
    $('#customDuration').focus(); // 展开后自动聚焦输入框
  } else {
    wrapper.classList.add('collapsed');
    selectedDuration = Number(btn.dataset.value);
    $('#customDuration').value = selectedDuration; // 点回 30/60 时同步输入框
  }

  $('#durationPreset').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  updateTabPill($('#durationPreset'));
});

// 窗口缩放时重新计算，不带动画
window.addEventListener('resize', () => {
  updateTabPill($('#playerCount'), false);
  updateTabPill($('#durationPreset'), false);
});

// 页面初次加载完成时，初始化滑块位置
setTimeout(() => {
  updateTabPill($('#playerCount'), false);
  updateTabPill($('#durationPreset'), false);
}, 50);

// 终极修复：监听容器尺寸变化，自动重新对齐滑块 (解决滚动条挤压导致的错位)
if (window.ResizeObserver) {
  const resizeObserver = new ResizeObserver(() => {
    updateTabPill($('#playerCount'), false);
    updateTabPill($('#durationPreset'), false);
  });
  const pCount = $('#playerCount');
  const dPreset = $('#durationPreset');
  if (pCount) resizeObserver.observe(pCount);
  if (dPreset) resizeObserver.observe(dPreset);
}

$('#customDuration').addEventListener('input', (e) => {
  let v = parseInt(e.target.value, 10);
  if (Number.isNaN(v)) return;

  // 超过 100 时，立刻强行截断为 100
  if (v > 100) {
    v = 100;
    e.target.value = 100;
  }
  selectedDuration = v;
});

// 失去焦点时，如果没填或者小于 15，自动退回 15
$('#customDuration').addEventListener('blur', (e) => {
  let v = parseInt(e.target.value, 10);
  if (Number.isNaN(v) || v < 15) {
    e.target.value = 15;
    selectedDuration = 15;
  }
});

$('#createBtn').addEventListener('click', () => {
  showHomeError('');
  
  // 判断当前选中是否是“自定义”
  let duration = selectedDuration;
  const activeBtn = $('#durationPreset').querySelector('button.active');
  if (activeBtn && activeBtn.dataset.value === 'custom') {
    const v = parseInt($('#customDuration').value, 10);
    if (!Number.isNaN(v)) {
      duration = Math.min(100, Math.max(15, v));
    }
  }

  const myAvatar = localStorage.getItem('mm_avatar') || '';
  socket.emit('createRoom', { maxPlayers: selectedPlayers, duration, avatar: myAvatar }, (res) => {
    if (!res || !res.ok) {
      showHomeError((res && res.error) || '创建失败');
      return;
    }
    applyState(res.state);
  });
});

$('#joinBtn').addEventListener('click', () => {
  showHomeError('');
  const code = $('#joinCode').value.trim().toUpperCase();
  if (!code) {
    showHomeError('请输入邀请码');
    return;
  }
  const storedId =
    localStorage.getItem('mm_code') === code
      ? localStorage.getItem('mm_playerId')
      : null;

  const myAvatar = localStorage.getItem('mm_avatar') || '';
  socket.emit('joinRoom', { code, playerId: storedId, avatar: myAvatar }, (res) => {
    if (!res || !res.ok) {
      showHomeError((res && res.error) || '加入失败');
      return;
    }
    applyState(res.state);
  });
});

/* ============ 大厅 ============ */
function renderLobby(s) {
  $('#lobbyCode').textContent = s.code;
  const online = s.players.filter((p) => p.connected).length;
  $('#lobbyCount').textContent = `${s.players.length}/${s.maxPlayers}`;

  const ul = $('#lobbyPlayers');
  ul.innerHTML = '';
  s.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player-item' + (p.connected ? '' : ' offline');
    const isMe = p.id === s.myId;
    const avatarHtml = p.avatar 
      ? `<img src="${p.avatar}" alt="avatar">`
      : escapeHtml(p.name.replace('玩家', ''));
    li.innerHTML = `
      <span class="avatar ${isMe ? 'clickable' : ''}" data-upload="${isMe}">${avatarHtml}</span>
      <span class="pname">${escapeHtml(p.name)}${
        p.isHost ? ' <span class="badge">房主</span>' : ''
      }</span>
      ${p.connected ? '' : '<span class="offline-tag">离线</span>'}
    `;
    ul.appendChild(li);
  });

  const isHost = s.hostId === s.myId;
  const startBtn = $('#startBtn');
  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = online < 2;

  $('#lobbyHint').textContent = isHost
    ? online < 2
      ? '至少需要 2 名在线玩家'
      : `在线 ${online}/${s.maxPlayers}，可以开始`
    : '等待房主开始…';
}

$('#startBtn').addEventListener('click', () => {
  socket.emit('startGame');
});

$('#leaveBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  clearSession();
  showScreen('home');
});

/* ============ 输入回合 ============ */
function initInputScreen(s) {
  const me = s.players.find((p) => p.id === s.myId);
  const input = $('#wordInput');
  input.value = me && me.word ? me.word : '';
  updateWordLen();

  const btn = $('#submitWordBtn');
  btn.classList.toggle('done', !!(me && me.submitted));
  btn.textContent = me && me.submitted ? '已提交' : '提交';

  startTimer();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentState && currentState.phase === 'input') {
      updateTimerDisplay(currentState.deadline);
    } else {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }, 250);
}

function updateTimerDisplay(deadline) {
  const el = $('#inputTimer');
  if (!el) return;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  el.textContent = left;
  el.classList.toggle('urgent', left <= 10);
}

function updateWordLen() {
  const v = $('#wordInput').value;
  $('#wordLen').textContent = [...v].length;
}

$('#wordInput').addEventListener('input', () => {
  // 如果已经提交，直接拦截，不允许修改
  const me = currentState && currentState.players.find((p) => p.id === currentState.myId);
  if (me && me.submitted) return;

  // 按字符截断到 10 字（中文/emoji 友好）
  const chars = [...$('#wordInput').value];
  if (chars.length > 10) {
    $('#wordInput').value = chars.slice(0, 10).join('');
  }
  updateWordLen();

  clearTimeout(draftDebounce);
  draftDebounce = setTimeout(() => {
    socket.emit('updateDraft', { word: $('#wordInput').value });
  }, 250);
});

$('#submitWordBtn').addEventListener('click', () => {
  if (!currentState || currentState.phase !== 'input') return;
  socket.emit('submitWord', { word: $('#wordInput').value });
});

function renderInput(s) {
  $('#inputRound').textContent = `第 ${s.round} 回合`;

  const me = s.players.find((p) => p.id === s.myId);
  const btn = $('#submitWordBtn');
  const input = $('#wordInput');
  
  if (me && me.submitted) {
    btn.classList.add('done');
    btn.textContent = '已提交';
    btn.disabled = true; // 禁用按钮
    input.disabled = true; // 禁用输入框
  } else {
    btn.classList.remove('done');
    btn.textContent = '提交';
    btn.disabled = false;
    input.disabled = false;
  }

  const row = $('#inputPlayers');
  row.innerHTML = '';
  s.players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'avatar-item' + (p.connected ? '' : ' offline');
    const avatarHtml = p.avatar 
      ? `<img src="${p.avatar}" alt="avatar">`
      : escapeHtml(p.name.replace('玩家', ''));
    div.innerHTML = `
      <div class="avatar-wrap">
        <span class="avatar">${avatarHtml}</span>
        ${p.submitted ? '<span class="dot"></span>' : ''}
      </div>
      <span class="avatar-name">${escapeHtml(p.name)}</span>
    `;
    row.appendChild(div);
  });

  updateTimerDisplay(s.deadline);
  renderHistory('inputHistory', s.history);
}

/* ============ 揭晓 / 投票 ============ */
function renderVote(s) {
  $('#voteRound').textContent = `第 ${s.round} 回合`;

  const grid = $('#voteWords');
  grid.innerHTML = '';
  s.players.forEach((p) => {
    const w = p.word && p.word.trim() ? p.word : '（未提交）';
    const div = document.createElement('div');
    div.className = 'word-card';
    div.innerHTML = `
      <div class="word-card-name">${escapeHtml(p.name)}</div>
      <div class="word-card-word">${escapeHtml(w)}</div>
    `;
    grid.appendChild(div);
  });

  const myVote = s.myVote;
  $('#voteSameBtn').classList.toggle('selected', myVote === 'same');
  $('#voteNextBtn').classList.toggle('selected', myVote === 'next');

  const status = $('#voteStatus');
  status.innerHTML = '';
  s.players.forEach((p) => {
    const label =
      p.vote === 'same' ? '词义相同' : p.vote === 'next' ? '下一轮' : '未选择';
    const div = document.createElement('div');
    div.className = 'vote-status-item';
    const avatarHtml = p.avatar 
      ? `<img src="${p.avatar}" alt="avatar">`
      : escapeHtml(p.name.replace('玩家', ''));
    div.innerHTML = `
      <span class="avatar small">${avatarHtml}</span>
      <span class="vote-choice ${p.vote || ''}">${label}</span>
    `;
    status.appendChild(div);
  });

  renderHistory('voteHistory', s.history);
}

// 渲染历史记录
function renderHistory(containerId, history) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!history || history.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  let html = '<h3 class="history-title">往期回顾</h3><div class="history-list">';
  
  // 倒序显示，让最新的一回合在上面
  [...history].reverse().forEach((h) => {
    const isMatch = h.result === 'same-exact' || h.result === 'same-manual';
    html += `<div class="history-round">
      <div class="history-round-header">
        <span>第 ${h.round} 回合</span>
        ${isMatch ? '<span class="history-match-tag">词义匹配</span>' : ''}
      </div>
      <div class="history-round-words">
        ${h.players.map(p => 
          `<span class="history-word-item"><span>${escapeHtml(p.name)}:</span>${escapeHtml(p.word || '（未提交）')}</span>`
        ).join('')}
      </div>
    </div>`;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

$('#voteSameBtn').addEventListener('click', () => {
  if (!currentState || currentState.phase !== 'vote') return;
  socket.emit('vote', { choice: 'same' });
});

$('#voteNextBtn').addEventListener('click', () => {
  if (!currentState || currentState.phase !== 'vote') return;
  socket.emit('vote', { choice: 'next' });
});

/* ============ 结束 ============ */
function renderEnded(s) {
  $('#endRounds').textContent = s.history.length;

  const table = $('#historyTable');
  const names = s.history.length
    ? s.history[0].players.map((p) => p.name)
    : s.players.map((p) => p.name);

  let html =
    '<thead><tr><th>回合</th>' +
    names.map((n) => `<th>${escapeHtml(n)}</th>`).join('') +
    '</tr></thead><tbody>';

  s.history.forEach((h) => {
    html +=
      `<tr><td>${h.round}</td>` +
      h.players
        .map((p) => `<td>${escapeHtml(p.word || '（未提交）')}</td>`)
        .join('') +
      '</tr>';
  });

  html += '</tbody>';
  table.innerHTML = html;
}

$('#againBtn').addEventListener('click', () => {
  socket.emit('playAgain');
});

/* ============ 导出竖长图 ============ */
function fitFont(ctx, text, maxWidth, base, min) {
  let size = base;
  ctx.font = `${size}px sans-serif`;
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 1;
    ctx.font = `${size}px sans-serif`;
  }
  return size;
}

function exportImage() {
  const s = currentState;
  if (!s || !s.history.length) return;

  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue('--bg').trim() || '#ffffff';
  const fg = style.getPropertyValue('--fg').trim() || '#111111';
  const border = style.getPropertyValue('--border').trim() || '#111111';
  const muted = style.getPropertyValue('--muted').trim() || '#888888';

  const players = s.history[0].players;
  const cols = players.length;
  const rows = s.history.length;

  const dpr = 2;
  const pad = 24;
  const titleH = 80;
  const headerH = 48;
  const rowH = 56;
  const colW = 150;
  const rowLabelW = 90;

  const w = pad * 2 + rowLabelW + cols * colW;
  const h = pad * 2 + titleH + headerH + rows * rowH;

  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 标题
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = fg;
  ctx.font = '700 28px sans-serif';
  ctx.fillText('Meet in mind', pad, pad + 24);
  ctx.fillStyle = muted;
  ctx.font = '14px sans-serif';
  ctx.fillText(`共 ${rows} 回合`, pad, pad + 56);

  const tableTop = pad + titleH;
  const x0 = pad;
  const x1 = pad + rowLabelW;
  const totalW = rowLabelW + cols * colW;
  const totalH = headerH + rows * rowH;

  // 表头
  ctx.textAlign = 'center';
  ctx.fillStyle = fg;
  ctx.font = '600 15px sans-serif';
  ctx.fillText('回合', x0 + rowLabelW / 2, tableTop + headerH / 2);
  players.forEach((p, i) => {
    const cx = x1 + i * colW + colW / 2;
    fitFont(ctx, p.name, colW - 20, 15, 11);
    ctx.fillText(p.name, cx, tableTop + headerH / 2, colW - 20);
  });

  // 数据
  s.history.forEach((hrow, r) => {
    const cy = tableTop + headerH + r * rowH + rowH / 2;
    // 回合号
    ctx.fillStyle = fg;
    ctx.font = '600 15px sans-serif';
    ctx.fillText(String(hrow.round), x0 + rowLabelW / 2, cy);

    hrow.players.forEach((p, i) => {
      const cx = x1 + i * colW + colW / 2;
      const text = p.word || '（未提交）';
      ctx.fillStyle = p.word ? fg : muted;
      fitFont(ctx, text, colW - 20, 15, 10);
      ctx.fillText(text, cx, cy, colW - 20);
    });
  });

  // 网格
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.8;
  ctx.beginPath();

  for (let i = 0; i <= cols; i++) {
    const x = x1 + i * colW;
    ctx.moveTo(x, tableTop);
    ctx.lineTo(x, tableTop + totalH);
  }
  ctx.moveTo(x0, tableTop);
  ctx.lineTo(x0, tableTop + totalH);

  ctx.moveTo(x0, tableTop);
  ctx.lineTo(x0 + totalW, tableTop);
  for (let r = 0; r <= rows; r++) {
    const y = tableTop + headerH + r * rowH;
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + totalW, y);
  }
  ctx.stroke();

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meet-in-mind-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, 'image/png');
}

$('#exportBtn').addEventListener('click', exportImage);

// ============ 头像上传逻辑 ============
// 1. 点击大厅自己的头像，触发文件选择
document.addEventListener('click', (e) => {
  const avatarEl = e.target.closest('.avatar[data-upload="true"]');
  if (avatarEl && currentState && currentState.phase === 'lobby') {
    $('#avatarFileInput').click();
  }
});

// 2. 选择文件后，用 Canvas 裁剪压缩成 80x80
$('#avatarFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 80; // 80x80 足够清晰且极小
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // 居中裁剪为正方形
      const minSize = Math.min(img.width, img.height);
      const sx = (img.width - minSize) / 2;
      const sy = (img.height - minSize) / 2;
      ctx.drawImage(img, sx, sy, minSize, minSize, 0, 0, size, size);

      // 转为 Base64 (质量 0.8，文件只有 2-3KB)
      const base64 = canvas.toDataURL('image/jpeg', 0.8);
      
      // 存入本地并更新首页顶栏
      localStorage.setItem('mm_avatar', base64);
      initGlobalAvatar();
      
      // 如果当前在房间内，顺便同步给服务器
      if (currentState) {
        socket.emit('uploadAvatar', { avatar: base64 });
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = ''; // 允许重复选择同一张图
});

// ============ 复制邀请码 ============
$('#copyCodeBtn').addEventListener('click', async () => {
  if (!currentState || !currentState.code) return;
  const code = currentState.code;
  const btn = $('#copyCodeBtn');

  try {
    await navigator.clipboard.writeText(code);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  } catch (err) {
    // 降级处理：如果 navigator.clipboard 不可用（比如 http 环境）
    const textArea = document.createElement('textarea');
    textArea.value = code;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    } catch (e) {
      alert('复制失败，请手动选择复制');
    }
    document.body.removeChild(textArea);
  }
});