#!/usr/bin/env node
/**
 * Dicsord —— 局域网聊天（Discord 风格）
 * 单文件 Node.js 服务器：静态页面 + WebSocket 房间聊天
 *
 * 启动：node server.js [端口]    （默认 3000，也可用环境变量 PORT 指定）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 3000) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const HISTORY_LIMIT = 200;                // 每个房间最多保留的消息数
const TEXT_LIMIT = 2000;                  // 单条文字消息长度上限
const IMAGE_BYTE_LIMIT = 3 * 1024 * 1024; // 单张图片上限 3MB
const BASE64_LIMIT = Math.ceil(IMAGE_BYTE_LIMIT * 4 / 3) + 64;
const WS_PAYLOAD_LIMIT = 5 * 1024 * 1024; // 单个 WebSocket 帧上限

/* ---------------- 工具 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function cleanText(value, maxLen) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function colorFor(nick) {
  let hue = 0;
  for (const ch of nick) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${hue}, 65%, 60%)`;
}

/* ---------------- 房间数据与历史持久化 ---------------- */

/** @type {Map<string, {name: string, users: Map<object, {nick: string, color: string}>, history: object[]}>} */
const rooms = new Map();

function loadHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    for (const [name, history] of Object.entries(data)) {
      if (typeof name === 'string' && Array.isArray(history)) {
        rooms.set(name, { name, users: new Map(), history });
      }
    }
    if (rooms.size) console.log(`已加载 ${rooms.size} 个房间的历史记录`);
  } catch {
    /* 首次启动没有历史文件，忽略 */
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveHistory, 500);
}
function saveHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {};
    for (const room of rooms.values()) {
      if (room.history.length) out[room.name] = room.history;
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(out));
  } catch (err) {
    console.error('保存历史记录失败：', err.message);
  }
}

function pushHistory(room, entry) {
  room.history.push(entry);
  if (room.history.length > HISTORY_LIMIT) {
    room.history.splice(0, room.history.length - HISTORY_LIMIT);
  }
  scheduleSave();
}

function usersOf(room) {
  return [...room.users.values()].map(u => ({ nick: u.nick, color: u.color }));
}

function roomList() {
  return [...rooms.values()].map(r => ({ name: r.name, count: r.users.size }));
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function roomSend(room, obj, exclude) {
  const data = JSON.stringify(obj);
  for (const client of room.users.keys()) {
    if (client !== exclude && client.readyState === 1) client.send(data);
  }
}

function broadcastRooms() {
  const data = JSON.stringify({ t: 'rooms', rooms: roomList() });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

/* 给不在该房间的在线客户端发轻量通知（不含消息内容），驱动其他房间的未读红点 */
function notifyOthers(room, nick, ts) {
  const data = JSON.stringify({ t: 'notify', room: room.name, nick, ts });
  for (const client of wss.clients) {
    if (client.readyState === 1 && !room.users.has(client)) client.send(data);
  }
}

/* ---------------- HTTP：静态页面 + 房间列表接口 ---------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(roomList()));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = '/';
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

/* ---------------- WebSocket：聊天逻辑 ---------------- */

const wss = new WebSocketServer({ server, maxPayload: WS_PAYLOAD_LIMIT });

function leaveRoom(ws) {
  const room = ws._room;
  if (!room) return;
  const nick = ws._nick;
  room.users.delete(ws);
  ws._room = null;
  if (room.users.size === 0) {
    if (room.history.length === 0) rooms.delete(room.name);
  } else {
    roomSend(room, { t: 'sys', room: room.name, text: `${nick} 离开了房间`, ts: Date.now() });
    roomSend(room, { t: 'users', room: room.name, users: usersOf(room) });
  }
  broadcastRooms();
}

function handleJoin(ws, msg) {
  const nick = cleanText(msg.nick, 20);
  const roomName = cleanText(msg.room, 30) || '大厅';
  if (!nick) {
    send(ws, { t: 'error', msg: '昵称不能为空（1-20 个字符）' });
    return;
  }

  // 同一房间内昵称不能重复（忽略自己，方便切换房间）
  const existing = rooms.get(roomName);
  if (existing) {
    for (const [client, u] of existing.users) {
      if (client !== ws && u.nick.toLowerCase() === nick.toLowerCase()) {
        send(ws, { t: 'error', msg: `「${nick}」已在这个房间里了，请换一个昵称` });
        return;
      }
    }
  }

  leaveRoom(ws);

  let room = rooms.get(roomName);
  if (!room) {
    room = { name: roomName, users: new Map(), history: [] };
    rooms.set(roomName, room);
  }
  const color = colorFor(nick);
  room.users.set(ws, { nick, color });
  ws._room = room;
  ws._nick = nick;
  ws._color = color;

  send(ws, {
    t: 'joined',
    room: room.name,
    nick,
    color,
    users: usersOf(room),
    rooms: roomList(),
    history: room.history.slice(-HISTORY_LIMIT),
  });
  roomSend(room, { t: 'sys', room: room.name, text: `${nick} 加入了房间`, ts: Date.now() }, ws);
  roomSend(room, { t: 'users', room: room.name, users: usersOf(room) });
  broadcastRooms();
}

function handleChat(ws, msg) {
  const room = ws._room;
  if (!room) return;
  const text = String(msg.text ?? '').slice(0, TEXT_LIMIT).replace(/\s+$/, '');
  if (!text.trim()) return;
  const entry = { t: 'chat', nick: ws._nick, color: ws._color, text, ts: Date.now() };
  pushHistory(room, entry);
  roomSend(room, { ...entry, room: room.name });
  notifyOthers(room, ws._nick, entry.ts);
}

function handleImage(ws, msg) {
  const room = ws._room;
  if (!room) return;
  const name = cleanText(msg.name, 60) || '图片';
  const data = String(msg.data ?? '');
  if (!/^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=]+$/.test(data)) return;
  if (data.length > BASE64_LIMIT) return;
  const entry = { t: 'img', nick: ws._nick, color: ws._color, name, data, ts: Date.now() };
  pushHistory(room, entry);
  roomSend(room, { ...entry, room: room.name });
  notifyOthers(room, ws._nick, entry.ts);
}

function handleTyping(ws, msg) {
  const room = ws._room;
  if (!room) return;
  roomSend(room, { t: 'typing', room: room.name, nick: ws._nick, on: !!msg.on }, ws);
}

wss.on('connection', (ws) => {
  ws.on('error', () => {});
  ws.on('close', () => leaveRoom(ws));
  ws.on('message', (raw) => {
    if (raw.length > WS_PAYLOAD_LIMIT) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      if (msg.t === 'join') handleJoin(ws, msg);
      else if (msg.t === 'chat') handleChat(ws, msg);
      else if (msg.t === 'img') handleImage(ws, msg);
      else if (msg.t === 'typing') handleTyping(ws, msg);
    } catch (err) {
      console.error('处理消息出错：', err);
    }
  });
});

/* ---------------- 启动 ---------------- */

function lanIPs() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) ips.push(it.address);
    }
  }
  // 优先常规局域网网段（192.168.x / 10.x / 172.16-31.x），排除 169.254 链路本地地址
  const isLan = (ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return [...ips.filter(isLan), ...ips.filter(ip => !isLan(ip) && !ip.startsWith('169.254.'))];
}

loadHistory();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换个端口试试：node server.js 3001`);
  } else {
    console.error('服务器启动失败：', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', async () => {
  const ips = lanIPs();
  const line = '─'.repeat(52);
  console.log(`\n${line}`);
  console.log('  Dicsord 已启动 🎉');
  console.log(`\n  本机访问：    http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  局域网访问：  http://${ip}:${PORT}`);
  if (!ips.length) console.log('  （未检测到局域网 IP，请检查网络连接）');
  console.log('\n  其他设备：连上同一个 Wi-Fi / 局域网，');
  console.log('  用浏览器打开上面的「局域网访问」地址，');
  console.log('  输入昵称进入同一房间即可聊天。');
  console.log(`${line}\n`);

  // 可选的二维码（装了 qrcode 包就显示，方便手机扫码加入）
  try {
    const QR = require('qrcode');
    if (ips.length) {
      const code = await QR.toString(`http://${ips[0]}:${PORT}`, { type: 'terminal', small: true });
      console.log('  📱 手机扫码快速加入：');
      console.log(code);
    }
  } catch {
    /* 未安装 qrcode，跳过 */
  }
});

process.on('SIGINT', () => {
  saveHistory();
  process.exit(0);
});
process.on('exit', () => saveHistory());
