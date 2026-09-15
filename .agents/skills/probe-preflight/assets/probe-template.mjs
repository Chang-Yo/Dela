// CDP 视觉验收驱动模板（从仓库已验证探针蒸馏；复制后按 TODO(probe) 修改）。
// 门禁：node --check 通过、G2–G6 逐项打勾后才有资格运行本文件。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronBinary = require('electron'); // 仓库依赖内的 Electron 二进制，ABI 安全
const outDir = 'TODO(probe): 截图输出目录';
const profile = mkdtempSync(path.join(tmpdir(), 'dela-probe-')); // G6：临时档案，结束即删

const child = spawn(
  electronBinary,
  ['TODO(probe): entry.cjs 绝对路径', '--remote-debugging-port=9222'],
  { env: { ...process.env, DELA_PROBE_PROFILE: profile }, stdio: ['ignore', 'ignore', 'pipe'] },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP endpoint never became ready');
}

const ws = new WebSocket((await waitDebugger()).webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let messageId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
// G2/G3：表达式一律纯字符串 + JSON.stringify 插值；禁止嵌套模板字符串与 .replace 拼串。
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    return { error: JSON.stringify(res.result.exceptionDetails).slice(0, 300) };
  }
  return res.result?.result?.value;
}
// 被遮挡窗口 rAF 节流：截图前泵帧，否则动画停在中间帧。
async function pumpFrames(times = 6) {
  for (let i = 0; i < times; i++) {
    await send('Page.captureScreenshot', { format: 'png' });
    await sleep(220);
  }
}
async function shot(name) {
  await pumpFrames();
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(outDir, name), Buffer.from(res.result.data, 'base64'));
  console.log('shot', name);
}
// G5：点击必留痕，禁止无返回值的"顺手一点"。
async function clickButton(text) {
  const result = await evaluate(`(() => {
    const target = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`);
  console.log('click', text, '->', result);
  return result;
}
// 鼠标事件坐标必须来自 getBoundingClientRect，不许目测。
async function elementCenter(text) {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('article, button')].find((a) => a.textContent.includes(${JSON.stringify(text)}));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 60)) };
  })()`);
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
await sleep(1800);
// TODO(probe): 断言清单驱动——G4 先确认每个目标元素的渲染门（configured/connected/semesterStart…），
// 不满足的门在此处用 IPC 或 sqlite 种子满足；reload 后重新点导航并 sleep 再查询。

child.kill();
ws.close();
await sleep(800);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
} catch (error) {
  console.error('profile cleanup deferred:', error.message);
}
process.exit(0);
