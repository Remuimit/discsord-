# Dicsord —— 局域网聊天软件

一个 Discord 风格的局域网聊天室：一台设备启动服务，同一局域网内的其他设备（手机 / 电脑 / 平板）用浏览器打开网址，**输入昵称进入房间即可聊天**，无需安装任何客户端。

## 功能

- 🏠 **多房间**：可创建 / 切换房间，侧栏实时显示各房间在线人数
- 👥 **在线成员列表**：头像颜色由昵称自动生成，加入 / 离开实时提醒
- ⌨️ **正在输入提示**：对方打字时底部实时显示
- 🖼️ **图片发送**：点 📎 选择图片，或直接在输入框 **粘贴 / 截图**（最大 3MB）
- 😀 **表情面板** + 轻量 Markdown（`**加粗**`、`*斜体*`、`~~删除线~~`、`` `代码` ``、链接自动识别）
- 📜 **消息历史**：每个房间保留最近 200 条，重启服务后仍在
- 🔴 **未读红点**：其他房间有新消息时侧栏显示未读数
- 📱 **手机适配**：响应式布局，手机上侧栏 / 成员栏变为抽屉
- 🔌 **断线自动重连**：网络波动后自动恢复并重新加入房间

## 快速开始

需要 [Node.js](https://nodejs.org) 16+（只在启动服务的那台设备上需要）。

```bash
npm install
npm start          # 默认端口 3000，也可指定：npm start -- 8080
```

启动后终端会打印访问地址，例如：

```
本机访问：    http://localhost:3000
局域网访问：  http://192.168.1.5:3000
```

- **本机**：浏览器打开 `http://localhost:3000`
- **其他设备**：连上同一个 Wi-Fi / 局域网，浏览器打开「局域网访问」的地址（启动时还会打印二维码，手机扫码即可）

## 便携版：目标电脑没装 Node 也能用

只有「启动服务的那台电脑」需要 Node，聊天的人用浏览器就行。如果开服务的那台电脑也没有 Node，用便携版：

```bash
node make-portable.js      # 生成 Dicsord-Portable 文件夹 + Dicsord-Portable.zip
```

`Dicsord-Portable` 里内置了 `node.exe`，**拷到任何 64 位 Windows 电脑，双击「启动.bat」即可**，无需安装任何东西。也可以直接把 `Dicsord-Portable.zip`（约 34MB）发给对方解压使用。

```
Dicsord-Portable/
├── 启动.bat          # 双击它启动服务
├── 使用说明.txt      # 给使用者的说明
├── node.exe          # 内置运行时
├── server.js
├── public/
└── node_modules/
```

> 注：便携版内置的是 64 位 Windows 版 node.exe。Mac / Linux 电脑想开服务，安装 Node.js 16+ 后执行 `node server.js` 即可（其他设备仍只需浏览器）。


## 使用方法

1. 打开页面后输入**昵称**和**房间名**（默认「大厅」），点「进入聊天」
2. 其他人同样打开网址，输入**不同昵称**、进入**同一房间**即可聊天
3. 点侧栏的 **＋** 可加入 / 创建新房间，点房间名可随时切换

## 常见问题

**其他设备打不开？**
- 确认设备和服务器连的是**同一个局域网 / Wi-Fi**
- Windows 首次启动会弹出防火墙提示，勾选允许「专用网络」；或手动放行端口（管理员命令行）：

  ```
  netsh advfirewall firewall add rule name="Dicsord" dir=in action=allow protocol=TCP localport=3000
  ```

**昵称冲突？** 同一房间内昵称不能重复，换一个即可。

**换端口？** `npm start -- 8080` 或 `set PORT=8080 && node server.js`

## 技术说明

- 服务端：Node.js 单文件（`server.js`）—— HTTP 静态页面 + WebSocket（`ws` 库）房间广播
- 前端：原生 HTML / CSS / JS（`public/`），无构建步骤
- 消息历史持久化到 `data/history.json`（含图片会以 base64 存储，文件会变大属正常现象，可随时删除该文件清空历史）
- 可选依赖 `qrcode`：启动时在终端打印二维码，没装也不影响使用

## 项目结构

```
├── server.js           # 服务器（静态页面 + WebSocket 聊天）
├── make-portable.js    # 生成免安装便携版（内置 node.exe）
├── public/
│   ├── index.html      # 页面结构
│   ├── style.css       # Discord 风格深色主题
│   └── app.js          # 前端逻辑
├── test/
│   └── protocol-test.js # 协议集成测试（23 项）
├── data/               # 运行时生成的消息历史
└── package.json
```

## 测试

```bash
npm start          # 先启动服务
npm test           # 另开一个终端运行 23 项协议集成测试
```

## 许可证

[MIT](LICENSE) © Dicsord contributors
