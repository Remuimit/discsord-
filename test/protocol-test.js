/* Dicsord 协议集成测试：对 http://localhost:3000 做端到端验证
 *
 * 采用「收集器」模式：每个客户端从连接建立起就记录全部消息，
 * 断言时先查历史记录再等待新消息，不存在监听器挂载时机的竞态。
 */
'use strict';
const WebSocket = require('ws');
const BASE = 'http://localhost:3000';

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name}${extra ? ' — ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    ws.on('open', () => resolve(makeCollector(ws)));
    ws.on('error', reject);
  });
}

function makeCollector(ws) {
  const log = [];
  ws.on('message', (raw) => {
    try { log.push(JSON.parse(raw.toString())); } catch { /* 忽略坏帧 */ }
  });
  return {
    ws,
    log,
    send: (obj) => ws.send(JSON.stringify(obj)),
    close: () => ws.close(),
    /** 记录当前日志位置，配合 waitFor 的 from 参数只匹配之后的新消息 */
    mark: () => log.length,
    waitFor(pred, { timeout = 3000, from = 0 } = {}) {
      const hit = log.slice(from).find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', on);
          reject(new Error(`等待消息超时；已收到: ${log.map(m => m.t).join(',') || '(无)'}`));
        }, timeout);
        const on = (raw) => {
          let m;
          try { m = JSON.parse(raw.toString()); } catch { return; }
          if (pred(m)) { clearTimeout(timer); ws.off('message', on); resolve(m); }
        };
        ws.on('message', on);
      });
    },
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('— 静态页面与接口 —');
  {
    const html = await fetch(BASE + '/').then(r => r.text());
    ok('首页返回 HTML', html.includes('<!DOCTYPE html>') && html.includes('Dicsord'));
    const css = await fetch(BASE + '/style.css').then(r => r.status);
    const js = await fetch(BASE + '/app.js').then(r => r.status);
    ok('静态资源可访问', css === 200 && js === 200);
    const rooms = await fetch(BASE + '/api/rooms').then(r => r.json());
    ok('房间列表接口', Array.isArray(rooms));
    const nf = await fetch(BASE + '/no-such-file').then(r => r.status);
    ok('404 处理', nf === 404);
  }

  console.log('— 双人聊天 —');
  const alice = await connect();
  const bob = await connect();

  alice.send({ t: 'join', nick: 'Alice', room: '测试房' });
  const aJoined = await alice.waitFor(m => m.t === 'joined');
  ok('Alice 加入成功', aJoined.room === '测试房' && aJoined.nick === 'Alice');
  ok('加入响应包含历史与房间列表', Array.isArray(aJoined.history) && Array.isArray(aJoined.rooms));

  bob.send({ t: 'join', nick: 'Bob', room: '测试房' });
  const bJoined = await bob.waitFor(m => m.t === 'joined');
  const aSys = await alice.waitFor(m => m.t === 'sys' && m.text.includes('Bob') && m.text.includes('加入'));
  const aUsers2 = await alice.waitFor(m => m.t === 'users' && m.users.length === 2);
  ok('Bob 加入成功', bJoined.room === '测试房');
  ok('Alice 收到加入通知', !!aSys);
  ok('双方成员列表均为 2 人', aUsers2.users.length === 2 && bJoined.users.length === 2);

  bob.send({ t: 'chat', text: '你好 Alice！**加粗** `code` https://example.com' });
  const aMsg = await alice.waitFor(m => m.t === 'chat' && m.text.includes('你好'));
  ok('消息广播', aMsg.nick === 'Bob' && typeof aMsg.ts === 'number');

  bob.send({ t: 'typing', on: true });
  const aTyping = await alice.waitFor(m => m.t === 'typing');
  ok('正在输入提示', aTyping.nick === 'Bob' && aTyping.on === true);

  alice.send({ t: 'img', name: 'dot.png', data: 'data:image/png;base64,iVBORw0KGgo=' });
  const bImg = await bob.waitFor(m => m.t === 'img');
  ok('图片消息广播', bImg.name === 'dot.png' && bImg.data.startsWith('data:image/png'));

  console.log('— 边界情况 —');
  {
    const eve = await connect();
    eve.send({ t: 'join', nick: 'Alice', room: '测试房' });
    const err = await eve.waitFor(m => m.t === 'error');
    ok('同房间昵称冲突被拦截', err.msg.includes('Alice'));
    eve.close();

    const empty = await connect();
    empty.send({ t: 'join', nick: '   ', room: '测试房' });
    const err2 = await empty.waitFor(m => m.t === 'error');
    ok('空白昵称被拦截', !!err2.msg);
    empty.close();

    alice.send({ t: 'chat', text: 'x'.repeat(3000) });
    const trunc = await bob.waitFor(m => m.t === 'chat' && m.text.startsWith('xxxx'));
    ok('超长消息截断到 2000 字', trunc.text.length === 2000);

    // 非法图片 data URL 应被丢弃（Bob 不应收到）
    alice.send({ t: 'img', name: 'evil.png', data: 'data:text/html;base64,PHNjcmlwdD4=' });
    try {
      await bob.waitFor(m => m.t === 'img' && m.name === 'evil.png', { timeout: 800 });
      ok('非图片 MIME 被拒绝', false);
    } catch { ok('非图片 MIME 被拒绝', true); }
  }

  console.log('— 房间切换与历史 —');
  {
    alice.send({ t: 'join', nick: 'Alice', room: '新房间' });
    const joined2 = await alice.waitFor(m => m.t === 'joined' && m.room === '新房间');
    const bSys = await bob.waitFor(m => m.t === 'sys' && m.text.includes('Alice') && m.text.includes('离开'));
    const bUsers1 = await bob.waitFor(m => m.t === 'users' && m.users.length === 1);
    ok('切换房间', joined2.users.length === 1);
    ok('旧房间收到离开通知', !!bSys);
    ok('旧房间成员列表更新', bUsers1.users[0].nick === 'Bob');

    const rooms = await fetch(BASE + '/api/rooms').then(r => r.json());
    const names = rooms.map(r => r.name);
    ok('房间列表包含两个房间', names.includes('测试房') && names.includes('新房间'));
    ok('在线人数正确', rooms.find(r => r.name === '新房间').count === 1);

    // 标记日志位置：只匹配本次重进后的 joined，避免命中首次加入的旧消息
    const markRejoin = alice.mark();
    alice.send({ t: 'join', nick: 'Alice', room: '测试房' });
    const rejoin = await alice.waitFor(m => m.t === 'joined' && m.room === '测试房', { from: markRejoin });
    ok('重进房间能拿到历史', rejoin.history.some(h => h.t === 'chat' && h.text.includes('你好')));
  }

  alice.close(); bob.close();
  await sleep(400);
  const roomsAfter = await fetch(BASE + '/api/rooms').then(r => r.json());
  // 只断言测试自建房间：真实浏览器会话可能在线（如断线重连的其他客户端）
  const testRoom = roomsAfter.find(r => r.name === '测试房');
  ok('退出后在线人数归零', !testRoom || testRoom.count === 0,
    { roomsAfter });

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('测试执行出错：', err.message);
  process.exit(1);
});
