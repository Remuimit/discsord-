#!/usr/bin/env node
/**
 * 打包便携版：生成 Dicsord-Portable 文件夹。
 * 内置 node.exe，在没有安装 Node.js 的 Windows 电脑上双击「启动.bat」即可开服务。
 *
 * 用法：node make-portable.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'Dicsord-Portable');

const FILES = ['server.js', 'package.json'];
const DIRS = ['public', 'node_modules'];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// 重新生成，保证产物干净
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const d of DIRS) copyDir(path.join(ROOT, d), path.join(OUT, d));

// 内置 node.exe（仅启动服务的电脑需要它）
const nodeExe = process.execPath;
fs.copyFileSync(nodeExe, path.join(OUT, 'node.exe'));

// 启动脚本：内容全 ASCII 避免编码问题；chcp 65001 让服务器的中文输出正常显示
fs.writeFileSync(path.join(OUT, '启动.bat'), [
  '@echo off',
  'chcp 65001 >nul',
  'title Dicsord LAN Chat',
  'cd /d "%~dp0"',
  '"%~dp0node.exe" server.js',
  'pause',
  '',
].join('\r\n'));

// 使用说明（UTF-8，记事本可正常打开）
const readme = `Dicsord —— 局域网聊天（便携版）
====================================

【这是干什么的】
一个 Discord 风格的局域网聊天室。在一台电脑上启动服务，
同一局域网内的手机 / 电脑 / 平板用浏览器打开网址即可聊天。
聊天的人什么都不用安装，有浏览器就行。

【怎么启动服务】
双击「启动.bat」即可，无需安装任何东西（文件夹自带 node.exe）。
启动后窗口会显示访问地址，例如：

    本机访问：    http://localhost:3000
    局域网访问：  http://192.168.1.5:3000

【别人怎么加入】
1. 连上同一个 Wi-Fi / 局域网
2. 浏览器打开窗口里显示的「局域网访问」地址
3. 输入昵称、进入同一个房间就能聊天

【常见问题】
· 别人打不开网址？
  多数是被防火墙拦截。首次启动时 Windows 弹出的防火墙提示
  请勾选允许「专用网络」；也可以用管理员身份运行一次下面的命令：

  netsh advfirewall firewall add rule name="Dicsord" dir=in action=allow protocol=TCP localport=3000

· 想换端口？
  用记事本打开「启动.bat」，把最后的 server.js 改成 server.js 8080

· 聊天记录在哪？
  data 文件夹里的 history.json，删掉即可清空全部历史

【注意】
本便携版内置 64 位 Windows 的 node.exe，只能在 64 位 Windows 上运行。
Mac / Linux 电脑想开服务的话，安装 Node.js（16 以上）后，
在本文件夹执行 node server.js 即可，效果相同。
`;
fs.writeFileSync(path.join(OUT, '使用说明.txt'), readme);

const sizeOf = (p) => {
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : (entry.isFile() ? fs.statSync(full).size : 0);
  }
  return total;
};

console.log('便携版已生成：' + OUT);
console.log(`总大小：${(sizeOf(OUT) / 1024 / 1024).toFixed(1)} MB（含 node.exe）`);
console.log('把整个 Dicsord-Portable 文件夹（或同名 zip）拷到别的电脑，双击「启动.bat」即可。');
