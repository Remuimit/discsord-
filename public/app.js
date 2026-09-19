/* Dicsord 前端逻辑 */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    gate: $('gate'), gateForm: $('gate-form'), gateNick: $('gate-nick'), gateRoom: $('gate-room'),
    gateRooms: $('gate-rooms'), gateChips: $('gate-chips'), gateError: $('gate-error'),
    app: $('app'), backdrop: $('backdrop'), sidebar: $('sidebar'), roomList: $('room-list'),
    meAvatar: $('me-avatar'), meNick: $('me-nick'), meStatus: $('me-status'),
    btnMenu: $('btn-menu'), btnMembers: $('btn-members'), btnAddRoom: $('btn-add-room'),
    chatRoomName: $('chat-room-name'), onlineCount: $('online-count'),
    messages: $('messages'), typing: $('typing'), newMsg: $('new-msg'),
    input: $('input'), btnSend: $('btn-send'), btnEmoji: $('btn-emoji'), btnImg: $('btn-img'),
    emojiPicker: $('emoji-picker'), fileInput: $('file-input'),
    members: $('members'), memberList: $('member-list'), memberCount: $('member-count'),
    joinDialog: $('join-dialog'), joinForm: $('join-form'), joinInput: $('join-input'),
    joinList: $('join-list'), joinClose: $('join-close'),
    lightbox: $('lightbox'), lightboxImg: $('lightbox-img'),
    connBanner: $('conn-banner'), toast: $('toast'),
  };

  const EMOJIS = [
    '😀', '😄', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😢', '😭',
    '😤', '😡', '🥺', '😱', '🥳', '😴', '🤡', '👻', '💀', '🤖', '👋', '👍',
    '👎', '👌', '🙏', '💪', '👀', '🧠', '❤️', '💔', '💯', '🔥', '✨', '🎉',
    '🎈', '⚡', '💥', '🌟', '☕', '🍺', '🍗', '🍜', '🍕', '🍉', '🐶', '🐱',
    '🦊', '🐼', '🎮', '⚽', '🏀', '🎵', '💡', '🛡️', '⚔️', '💤', '🚀', '🤝',
  ];

  const state = {
    ws: null,
    connected: false,
    nick: '',
    room: null,
    color: '',
    users: [],
    rooms: [],
    unread: new Map(),   // 房间名 -> 未读数
    typing: new Map(),   // 昵称 -> 超时句柄
    backoff: 1000,
    reconnectTimer: null,
  };

  let lastGroup = null;      // 上一条消息 {nick, ts}，用于消息分组
  let lastDay = '';          // 上一条消息的日期 key，用于日期分割线
  let titleCount = 0;        // 后台时的未读数（显示在标题栏）
  let typingSent = false;
  let typingOffTimer = null;
  let toastTimer = null;

  /* ---------------- 通用工具 ---------------- */

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function initial(nick) {
    return [...String(nick).trim()][0] || '?';
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function fullDate(ts) {
    return new Date(ts).toLocaleString('zh-CN');
  }

  /* 轻量 Markdown：转义后再做格式替换，避免 XSS */
  function renderContent(text) {
    let s = esc(text);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    s = s.replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    return s; // 换行交给 CSS 的 pre-wrap 处理
  }

  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2500);
  }

  function updateTitle() {
    document.title = (titleCount ? `(${titleCount}) ` : '') + `#${state.room || ''} · Dicsord`;
  }

  /* ---------------- WebSocket ---------------- */

  function wsSend(obj) {
    if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
  }

  function sendJoin(room) {
    state.room = room;
    wsSend({ t: 'join', nick: state.nick, room });
  }

  function connect() {
    if (state.ws && (state.ws.readyState === 0 || state.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    state.ws = ws;

    ws.onopen = () => {
      state.connected = true;
      state.backoff = 1000;
      els.connBanner.classList.add('hidden');
      els.meStatus.textContent = '在线';
      els.meStatus.classList.add('online');
      els.meStatus.classList.remove('connecting');
      if (state.nick && state.room) sendJoin(state.room);
    };

    ws.onclose = () => {
      const wasConnected = state.connected;
      state.connected = false;
      if (state.nick) { // 只有进入过聊天才提示重连
        els.connBanner.classList.remove('hidden');
        els.meStatus.textContent = '连接中…';
        els.meStatus.classList.remove('online');
        els.meStatus.classList.add('connecting');
        scheduleReconnect();
      }
      if (!wasConnected && els.gateError && !els.gate.classList.contains('hidden')) {
        els.gateError.textContent = '无法连接到服务器，请确认服务是否在运行';
        els.gateError.classList.remove('hidden');
      }
    };

    ws.onerror = () => { /* 交给 onclose 处理 */ };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handle(msg);
    };
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      state.backoff = Math.min(state.backoff * 2, 15000);
      connect();
    }, state.backoff);
  }

  /* ---------------- 服务器消息处理 ---------------- */

  function handle(m) {
    switch (m.t) {
      case 'joined': onJoined(m); break;
      case 'chat': case 'img': onChatMessage(m); break;
      case 'notify': onNotify(m); break;
      case 'sys': onSys(m); break;
      case 'users': onUsers(m); break;
      case 'rooms': onRooms(m); break;
      case 'typing': onTyping(m); break;
      case 'error': onError(m); break;
    }
  }

  function onJoined(m) {
    state.room = m.room;
    state.color = m.color;
    state.users = m.users || [];
    state.rooms = m.rooms || [];
    state.unread.delete(m.room);

    els.gate.classList.add('hidden');
    els.app.classList.remove('hidden');
    els.joinDialog.classList.add('hidden');
    els.connBanner.classList.add('hidden');

    els.meNick.textContent = state.nick;
    els.meAvatar.textContent = initial(state.nick);
    els.meAvatar.style.background = m.color;
    els.chatRoomName.textContent = '# ' + m.room;
    els.input.placeholder = `发送消息至 #${m.room}`;

    lastGroup = null;
    lastDay = '';
    els.messages.innerHTML = '';
    for (const h of m.history || []) {
      addDayDividerIfNeeded(h.ts);
      if (h.t === 'img') addImageMessage(h);
      else addChatMessage(h);
    }
    renderMembers();
    renderRooms();
    scrollBottom(false);
    updateTitle();
    els.input.focus();
  }

  function onChatMessage(m) {
    // 其他房间的消息：只计未读
    if (m.room !== state.room) {
      state.unread.set(m.room, (state.unread.get(m.room) || 0) + 1);
      renderRooms();
      return;
    }
    addDayDividerIfNeeded(m.ts);
    if (m.t === 'img') addImageMessage(m);
    else addChatMessage(m);
    onNewMessage(m.nick === state.nick);
    // 页面在后台时，别人的新消息计入标题栏未读数
    if (document.hidden && m.nick !== state.nick) { titleCount++; updateTitle(); }
  }

  /* 其他房间的轻量通知：点亮侧栏未读红点 */
  function onNotify(m) {
    if (m.room === state.room) return;
    state.unread.set(m.room, (state.unread.get(m.room) || 0) + 1);
    renderRooms();
    if (document.hidden) { titleCount++; updateTitle(); }
  }

  function onSys(m) {
    if (m.room !== state.room) return;
    lastGroup = null; // 系统消息打断分组
    addDayDividerIfNeeded(m.ts);
    const div = document.createElement('div');
    div.className = 'sys';
    div.textContent = m.text;
    els.messages.appendChild(div);
    onNewMessage(false);
  }

  function onUsers(m) {
    if (m.room !== state.room) return;
    state.users = m.users || [];
    renderMembers();
  }

  function onRooms(m) {
    state.rooms = m.rooms || [];
    renderRooms();
    renderJoinList();
  }

  function onTyping(m) {
    if (m.room !== state.room) return;
    const prev = state.typing.get(m.nick);
    if (prev) clearTimeout(prev);
    if (m.on) {
      state.typing.set(m.nick, setTimeout(() => {
        state.typing.delete(m.nick);
        renderTyping();
      }, 4000));
    } else {
      state.typing.delete(m.nick);
    }
    renderTyping();
  }

  function onError(m) {
    if (!els.gate.classList.contains('hidden')) {
      els.gateError.textContent = m.msg || '出错了';
      els.gateError.classList.remove('hidden');
      state.room = null;
    } else {
      toast(m.msg || '出错了');
    }
  }

  /* ---------------- 消息渲染 ---------------- */

  function addDayDividerIfNeeded(ts) {
    const key = dayKey(ts);
    if (key === lastDay) return;
    lastDay = key;
    const div = document.createElement('div');
    div.className = 'day-divider';
    div.textContent = fmtDate(ts);
    els.messages.appendChild(div);
    lastGroup = null;
  }

  function addChatMessage(m) {
    const grouped = lastGroup && lastGroup.nick === m.nick && (m.ts - lastGroup.ts) < 5 * 60 * 1000;
    const row = document.createElement('div');

    if (grouped) {
      row.className = 'msg grouped';
      row.innerHTML =
        `<span class="hover-time">${fmtTime(m.ts)}</span>` +
        `<div class="msg-body"><div class="msg-content">${renderContent(m.text)}</div></div>`;
    } else {
      row.className = 'msg';
      row.title = fullDate(m.ts);
      row.innerHTML =
        `<div class="avatar" style="background:${m.color}">${esc(initial(m.nick))}</div>` +
        `<div class="msg-body">` +
          `<div class="msg-head">` +
            `<span class="msg-nick" style="color:${m.color}">${esc(m.nick)}</span>` +
            `<span class="msg-time">${fmtTime(m.ts)}</span>` +
          `</div>` +
          `<div class="msg-content">${renderContent(m.text)}</div>` +
        `</div>`;
    }
    els.messages.appendChild(row);
    lastGroup = { nick: m.nick, ts: m.ts };
  }

  function addImageMessage(m) {
    const grouped = lastGroup && lastGroup.nick === m.nick && (m.ts - lastGroup.ts) < 5 * 60 * 1000;
    const row = document.createElement('div');
    const content =
      `<img class="msg-img" src="${m.data}" alt="${esc(m.name)}" loading="lazy" title="点击查看大图">` +
      `<div class="img-name">${esc(m.name)}</div>`;

    if (grouped) {
      row.className = 'msg grouped';
      row.innerHTML = `<span class="hover-time">${fmtTime(m.ts)}</span><div class="msg-body">${content}</div>`;
    } else {
      row.className = 'msg';
      row.title = fullDate(m.ts);
      row.innerHTML =
        `<div class="avatar" style="background:${m.color}">${esc(initial(m.nick))}</div>` +
        `<div class="msg-body">` +
          `<div class="msg-head">` +
            `<span class="msg-nick" style="color:${m.color}">${esc(m.nick)}</span>` +
            `<span class="msg-time">${fmtTime(m.ts)}</span>` +
          `</div>` +
          `<div class="msg-content">${content}</div>` +
        `</div>`;
    }
    els.messages.appendChild(row);
    lastGroup = { nick: m.nick, ts: m.ts };
  }

  /* ---------------- 列表渲染 ---------------- */

  function renderRooms() {
    const rooms = [...state.rooms];
    if (state.room && !rooms.some(r => r.name === state.room)) {
      rooms.push({ name: state.room, count: 0 });
    }
    rooms.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    els.roomList.innerHTML = '';
    for (const r of rooms) {
      const btn = document.createElement('button');
      btn.className = 'room-item' + (r.name === state.room ? ' active' : '');
      const unread = state.unread.get(r.name) || 0;
      btn.innerHTML =
        `<span class="room-hash">#</span>` +
        `<span class="room-name">${esc(r.name)}</span>` +
        (unread
          ? `<span class="room-unread">${unread > 99 ? '99+' : unread}</span>`
          : (r.count ? `<span class="room-count">${r.count} 人</span>` : ''));
      btn.onclick = () => {
        if (r.name !== state.room) joinRoom(r.name);
        closeMobilePanels();
      };
      els.roomList.appendChild(btn);
    }
  }

  function renderMembers() {
    const users = [...state.users].sort((a, b) => a.nick.localeCompare(b.nick, 'zh'));
    els.memberCount.textContent = users.length;
    els.onlineCount.textContent = users.length > 0 ? `${users.length} 人在线` : '';
    els.memberList.innerHTML = '';
    for (const u of users) {
      const div = document.createElement('div');
      div.className = 'member';
      div.innerHTML =
        `<div class="avatar-wrap">` +
          `<div class="avatar sm" style="background:${u.color}">${esc(initial(u.nick))}</div>` +
          `<span class="status-dot"></span>` +
        `</div>` +
        `<span class="member-nick" style="color:${u.color}">${esc(u.nick)}</span>` +
        (u.nick === state.nick ? '<span class="member-you">（你）</span>' : '');
      els.memberList.appendChild(div);
    }
  }

  function renderTyping() {
    const names = [...state.typing.keys()].filter(n => n !== state.nick);
    if (!names.length) { els.typing.textContent = ''; return; }
    if (names.length === 1) els.typing.textContent = `${names[0]} 正在输入…`;
    else if (names.length === 2) els.typing.textContent = `${names[0]} 和 ${names[1]} 正在输入…`;
    else els.typing.textContent = `${names.length} 个人正在输入…`;
  }

  function renderJoinList() {
    if (els.joinDialog.classList.contains('hidden')) return;
    els.joinList.innerHTML = '';
    const rooms = [...state.rooms].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    if (!rooms.length) {
      els.joinList.innerHTML = '<div class="sys" style="margin:8px 0">还没有其他房间</div>';
      return;
    }
    for (const r of rooms) {
      const btn = document.createElement('button');
      btn.className = 'dialog-room';
      btn.innerHTML =
        `<span class="room-hash">#</span>` +
        `<span class="room-name">${esc(r.name)}</span>` +
        (r.name === state.room ? '<span class="room-count">当前</span>'
          : (r.count ? `<span class="room-count">${r.count} 人</span>` : ''));
      btn.onclick = () => {
        if (r.name !== state.room) joinRoom(r.name);
        els.joinDialog.classList.add('hidden');
      };
      els.joinList.appendChild(btn);
    }
  }

  /* ---------------- 滚动 / 未读 ---------------- */

  function nearBottom() {
    return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
  }

  function scrollBottom(smooth) {
    els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function onNewMessage(own) {
    if (own || nearBottom()) {
      scrollBottom(true);
    } else {
      els.newMsg.classList.remove('hidden');
    }
  }

  /* ---------------- 房间操作 ---------------- */

  function joinRoom(room) {
    if (!state.connected) { toast('尚未连接到服务器'); return; }
    state.typing.clear();
    renderTyping();
    sendJoin(room);
    localStorage.setItem('dicsord-room', room);
  }

  /* ---------------- 发送 ---------------- */

  function sendChat() {
    const text = els.input.value.trim();
    if (!text) return;
    if (!state.connected) { toast('尚未连接到服务器'); return; }
    wsSend({ t: 'chat', text });
    els.input.value = '';
    autoResize();
    setTyping(false);
    els.input.focus();
  }

  function sendImageFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) { toast('只能发送图片文件'); return; }
    if (file.size > 3 * 1024 * 1024) { toast('图片不能超过 3MB'); return; }
    if (!state.connected) { toast('尚未连接到服务器'); return; }
    const reader = new FileReader();
    reader.onload = () => wsSend({ t: 'img', name: file.name || '图片', data: reader.result });
    reader.onerror = () => toast('读取图片失败');
    reader.readAsDataURL(file);
  }

  /* 正在输入 */

  function setTyping(on) {
    typingSent = false;
    clearTimeout(typingOffTimer);
    if (state.connected) wsSend({ t: 'typing', on });
  }

  /* ---------------- 输入框行为 ---------------- */

  function autoResize() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
  }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const pos = start + text.length;
    textarea.setSelectionRange(pos, pos);
    textarea.focus();
    autoResize();
  }

  /* ---------------- 移动端面板 ---------------- */

  function closeMobilePanels() {
    els.sidebar.classList.remove('open');
    els.members.classList.remove('open');
    els.backdrop.classList.add('hidden');
  }

  /* ---------------- 入口界面 ---------------- */

  async function refreshGateRooms() {
    try {
      const res = await fetch('/api/rooms');
      const rooms = await res.json();
      els.gateRooms.innerHTML = rooms
        .map(r => `<option value="${esc(r.name)}"></option>`).join('');
      const active = rooms.filter(r => r.count > 0).slice(0, 8);
      els.gateChips.innerHTML = active.length
        ? '<div class="dialog-rooms-label" style="margin:12px 0 0;text-align:left">热门房间</div>' +
          active.map(r =>
            `<button type="button" class="chip" data-room="${esc(r.name)}"># ${esc(r.name)} <span>${r.count} 人</span></button>`
          ).join('')
        : '';
    } catch { /* 忽略 */ }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    // 入口表单
    els.gateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nick = els.gateNick.value.trim();
      const room = els.gateRoom.value.trim() || '大厅';
      if (!nick) {
        els.gateError.textContent = '请先输入昵称';
        els.gateError.classList.remove('hidden');
        els.gateNick.focus();
        return;
      }
      els.gateError.classList.add('hidden');
      state.nick = nick;
      state.room = room;
      localStorage.setItem('dicsord-nick', nick);
      localStorage.setItem('dicsord-room', room);
      connect();
      // 若连接已建立（onopen 已触发但未加入），直接发 join
      if (state.ws && state.ws.readyState === 1) sendJoin(room);
    });

    // 热门房间标签
    els.gateChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) els.gateRoom.value = chip.dataset.room || '';
    });

    // 房间侧栏（新增房间）
    els.btnAddRoom.addEventListener('click', () => {
      els.joinInput.value = '';
      els.joinDialog.classList.remove('hidden');
      renderJoinList(); // 必须在移除 hidden 之后调用，否则函数内的可见性守卫会跳过渲染
      els.joinInput.focus();
    });

    // 加入房间对话框
    els.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const room = els.joinInput.value.trim();
      if (room) {
        joinRoom(room);
        els.joinDialog.classList.add('hidden');
      }
    });
    els.joinClose.addEventListener('click', () => els.joinDialog.classList.add('hidden'));
    els.joinDialog.addEventListener('click', (e) => {
      if (e.target === els.joinDialog) els.joinDialog.classList.add('hidden');
    });

    // 移动端面板开关
    els.btnMenu.addEventListener('click', () => {
      const open = els.sidebar.classList.toggle('open');
      els.members.classList.remove('open');
      els.backdrop.classList.toggle('hidden', !open);
    });
    els.btnMembers.addEventListener('click', () => {
      const open = els.members.classList.toggle('open');
      els.sidebar.classList.remove('open');
      els.backdrop.classList.toggle('hidden', !open);
    });
    els.backdrop.addEventListener('click', closeMobilePanels);

    // 输入框
    els.input.addEventListener('keydown', (e) => {
      // isComposing：中文输入法选词的回车不发送
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChat();
      }
    });
    els.input.addEventListener('input', () => {
      autoResize();
      if (!state.connected) return;
      if (els.input.value && !typingSent) {
        typingSent = true;
        wsSend({ t: 'typing', on: true });
      }
      clearTimeout(typingOffTimer);
      typingOffTimer = setTimeout(() => setTyping(false), 2500);
    });
    els.input.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          sendImageFile(it.getAsFile());
          return;
        }
      }
    });

    // 发送按钮 / 图片
    els.btnSend.addEventListener('click', sendChat);
    els.btnImg.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      sendImageFile(els.fileInput.files && els.fileInput.files[0]);
      els.fileInput.value = '';
    });

    // 表情面板
    els.btnEmoji.addEventListener('click', (e) => {
      e.stopPropagation();
      els.emojiPicker.classList.toggle('hidden');
    });
    els.emojiPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button');
      if (btn) insertAtCursor(els.input, btn.dataset.emoji);
    });
    document.addEventListener('click', () => els.emojiPicker.classList.add('hidden'));

    // 消息区：点击图片放大
    els.messages.addEventListener('click', (e) => {
      const img = e.target.closest('.msg-img');
      if (img) {
        els.lightboxImg.src = img.src;
        els.lightbox.classList.remove('hidden');
      }
    });
    els.lightbox.addEventListener('click', () => {
      els.lightbox.classList.add('hidden');
      els.lightboxImg.src = '';
    });

    // 新消息跳转
    els.newMsg.addEventListener('click', () => {
      scrollBottom(true);
      els.newMsg.classList.add('hidden');
    });
    els.messages.addEventListener('scroll', () => {
      if (nearBottom()) els.newMsg.classList.add('hidden');
    });

    // Esc 关闭浮层
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        els.lightbox.classList.add('hidden');
        els.joinDialog.classList.add('hidden');
        els.emojiPicker.classList.add('hidden');
        closeMobilePanels();
      }
    });

    // 标题栏未读数
    window.addEventListener('focus', () => {
      titleCount = 0;
      updateTitle();
    });
  }

  function buildEmojiPicker() {
    els.emojiPicker.innerHTML = '';
    for (const emoji of EMOJIS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.emoji = emoji;
      btn.textContent = emoji;
      els.emojiPicker.appendChild(btn);
    }
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    buildEmojiPicker();
    bindEvents();
    els.gateNick.value = localStorage.getItem('dicsord-nick') || '';
    els.gateRoom.value = localStorage.getItem('dicsord-room') || '大厅';
    refreshGateRooms();
    if (els.gateNick.value) els.gateNick.select();
    else els.gateNick.focus();
  }

  init();
})();
