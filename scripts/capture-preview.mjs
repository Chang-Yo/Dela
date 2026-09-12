// 临时视觉验收脚本：通过 CDP 对运行中的 Dela 窗口截图（不提交）。
import { writeFileSync } from 'node:fs';

const view = process.argv[2] ?? 'mail';
const out = process.argv[3] ?? `dela-${view}.png`;

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find((t) => t.type === 'page');
if (!target) {
  console.error('No page target found');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    console.error('Evaluate failed:', JSON.stringify(res.result.exceptionDetails));
  }
  return res.result?.result?.value;
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 960,
  deviceScaleFactor: 1,
  mobile: false,
});
await new Promise((r) => setTimeout(r, 400));

if (view !== 'home') {
  const clicked = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((b) => b.textContent.trim() === '${view}');
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`);
  console.log('Navigate:', clicked);
}
// 强制刷新帧：被遮挡的窗口 rAF 被节流，framer-motion 过渡需要真实帧驱动。
for (let i = 0; i < 8; i++) {
  await send('Page.captureScreenshot', { format: 'png' });
  await new Promise((r) => setTimeout(r, 250));
}

const result = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(result.result.data, 'base64'));
console.log('Saved', out);
ws.close();
process.exit(0);
