import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { analyzeNoticePage, extractNoticeEntries } from '../../parser';
import { subscriptionStateSchema, updateSubscription } from '../../state';

async function main() {
  const root = resolve(process.argv[2] ?? '.');
  const directory = resolve(root, 'experiments/notice-subscriptions/validation/framework/evidence');
  await mkdir(directory, { recursive: true });
  const demonstration = '本地合成框架演示；不是 Dela 产品界面，也不代表真实站点消息';
  const url = 'https://framework-demo.example/notice';
  const html = (ids: number[]) =>
    `<html lang="zh-CN"><head><meta charset="utf-8"><title>本地合成框架演示</title></head><body><main><h2>通知公告</h2><ul>${ids.map((id) => `<li><a href="/notice/${id}">合成通知 ${id}：框架订阅演示</a><time>2026-11-${String(id === 3 ? 12 : id).padStart(2, '0')}</time></li>`).join('')}</ul></main></body></html>`;
  const before = html([1, 2]);
  const after = html([3, 2, 1]);
  await writeFile(resolve(directory, 'input-before.html'), before);
  await writeFile(resolve(directory, 'input-after.html'), after);
  const preview = analyzeNoticePage(before, url);
  assert.equal(preview.candidates.length, 1);
  const selected = preview.candidates[0]!;
  const confirmed = updateSubscription(selected.rule, extractNoticeEntries(before, selected.rule));
  assert.equal(confirmed.baseline, true);
  assert.deepEqual(confirmed.newEntries, []);
  const baseline = { ...confirmed.state, acquisition: 'http' as const };
  await writeFile(resolve(directory, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
  const restored = subscriptionStateSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'baseline.json'), 'utf8')),
  );
  const first = updateSubscription(
    restored.rule,
    extractNoticeEntries(after, restored.rule),
    restored,
  );
  assert.deepEqual(
    first.newEntries.map((entry) => entry.id),
    ['https://framework-demo.example/notice/3'],
  );
  const second = updateSubscription(
    first.state.rule,
    extractNoticeEntries(after, first.state.rule),
    first.state,
  );
  assert.deepEqual(second.newEntries, []);
  for (const [name, result] of [
    ['preview', preview],
    ['confirmation', confirmed],
    ['refresh-first', first],
    ['refresh-again', second],
  ] as const)
    await writeFile(resolve(directory, name + '.json'), JSON.stringify(result, null, 2) + '\n');
  const previewLog = {
    demonstration,
    operation: 'analyzeNoticePage → 显式选择候选 1 → extractNoticeEntries → updateSubscription',
    beforeConfirmation: {
      status: preview.status,
      candidateCount: preview.candidates.length,
      candidates: preview.candidates.map((candidate, index) => ({
        index: index + 1,
        label: candidate.label,
        entries: candidate.entries,
      })),
    },
    afterConfirmation: {
      selectedCandidate: 1,
      baseline: confirmed.baseline,
      newEntries: confirmed.newEntries,
      seenIds: confirmed.state.seenIds,
    },
  };
  const refreshLog = {
    demonstration,
    operation: '读取 JSON 基线 → 重放同一规则 → updateSubscription → 再次重放并更新',
    firstRefresh: {
      inputOrder: [3, 2, 1],
      baseline: first.baseline,
      newEntries: first.newEntries,
      seenIds: first.state.seenIds,
    },
    secondRefresh: {
      sameInput: true,
      baseline: second.baseline,
      newEntries: second.newEntries,
      seenIds: second.state.seenIds,
    },
  };
  const window = new BrowserWindow({
    width: 1320,
    height: 1400,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    for (const [name, title, log] of [
      ['preview', '实际运行记录：候选预览与显式确认', previewLog],
      ['refresh', '实际运行记录：新 URL 仅报告一次', refreshLog],
    ] as const) {
      const text = JSON.stringify(log, null, 2);
      const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><style>body{margin:28px;background:white;color:#111;font:16px/1.45 Consolas,"Microsoft YaHei",monospace}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}</style><h1>${title}</h1><p>本地合成框架演示 · 只读日志摘要 · 完整输入与 JSON 输出保存在同目录</p><pre>${escaped}</pre></html>`;
      await writeFile(resolve(directory, name + '-log.json'), text + '\n');
      await writeFile(resolve(directory, name + '-log.html'), page);
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
      const height = await window.webContents.executeJavaScript(
        'Math.ceil(document.documentElement.scrollHeight)',
      );
      window.setContentSize(1320, height);
      await window.webContents.executeJavaScript(
        'new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))',
      );
      await writeFile(
        resolve(directory, name + '.png'),
        (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG(),
      );
    }
  } finally {
    window.destroy();
  }
  const paths = [
    'experiments/notice-subscriptions/parser.ts',
    'experiments/notice-subscriptions/state.ts',
    'experiments/notice-subscriptions/validation/framework/capture-example.ts',
    'experiments/notice-subscriptions/validation/framework/evidence/run-capture.ts',
    'experiments/notice-subscriptions/validation/framework/evidence/capture-example.cjs',
    ...[
      'input-before.html',
      'input-after.html',
      'preview.json',
      'confirmation.json',
      'baseline.json',
      'refresh-first.json',
      'refresh-again.json',
      'preview-log.json',
      'refresh-log.json',
      'preview.png',
      'refresh.png',
    ].map((name) => 'experiments/notice-subscriptions/validation/framework/evidence/' + name),
  ];
  const sha256 = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(resolve(root, path)))
          .digest('hex'),
      ]),
    ),
  );
  const results = {
    demonstration,
    capturedAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    core: [
      'analyzeNoticePage',
      'extractNoticeEntries',
      'updateSubscription',
      'subscriptionStateSchema',
    ],
    source: '本地构造 HTML；保留原始输入；无网络请求；与 CLI import 同一 parser/state 模块',
    result: {
      candidates: preview.candidates.length,
      baselineNewEntries: confirmed.newEntries.length,
      firstRefreshNewEntries: first.newEntries.length,
      secondRefreshNewEntries: second.newEntries.length,
    },
    sha256,
  };
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}

app.on('window-all-closed', () => {});
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  })
  .finally(() => app.quit());
