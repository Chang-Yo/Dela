// 真实应用、独立用户目录：验证 agent 基座的工作区闭环（需要真实模型服务）。
// 用法：DELA_SMOKE_BASE_URL=… DELA_SMOKE_API_KEY=… DELA_SMOKE_MODEL=… electron scripts/agent-smoke.cjs
// 覆盖：两个项目各自的会话 cwd、项目内读改写、@ 引用文件、跨项目不串、重开会话后续聊（上下文来自 Pi JSONL）。
const { app } = require('electron');
const { join, resolve } = require('node:path');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

const env = process.env;
for (const key of ['DELA_SMOKE_BASE_URL', 'DELA_SMOKE_API_KEY', 'DELA_SMOKE_MODEL'])
  if (!env[key]) throw new Error(`缺少环境变量 ${key}`);
const root = resolve(process.argv[2] || '.');
const profile = mkdtempSync(join(tmpdir(), 'dela-agent-smoke-'));
app.setPath('userData', profile);
app.setPath('documents', profile);
process.argv.push('--terminal-smoke-test');

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void run(window)
      .then(() => {
        console.log('Agent smoke passed:', profile);
        app.quit();
      })
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  });
});
require(join(root, 'out/main/index.cjs'));

async function run(window) {
  const js = (source) => window.webContents.executeJavaScript(source);
  const call = (expression) => js(`(async () => ${expression})()`);
  await call(
    `window.dela.llm.save(${JSON.stringify({
      name: 'smoke',
      baseUrl: env.DELA_SMOKE_BASE_URL,
      apiKey: env.DELA_SMOKE_API_KEY,
      models: [env.DELA_SMOKE_MODEL],
    })})`,
  );
  const alpha = await call(
    `window.dela.workspace.create({ parentId: null, name: 'alpha', kind: 'project' })`,
  );
  const beta = await call(
    `window.dela.workspace.create({ parentId: null, name: 'beta', kind: 'project' })`,
  );
  const state = await call(`window.dela.workspace.getState()`);
  const dirOf = (id) => state.entries.find((entry) => entry.id === id).path;
  const alphaDir = dirOf(alpha.id);
  const betaDir = dirOf(beta.id);
  writeFileSync(join(alphaDir, 'notes.md'), '# 笔记\n\n状态：draft\n');

  const ask = async (sessionId, text, context = []) => {
    const chat = await call(
      `window.dela.session.ask(${JSON.stringify(sessionId)}, ${JSON.stringify({ text, attachments: [], context })})`,
    );
    const reply = chat.messages.at(-1);
    console.log(
      `[${text.slice(0, 24)}…]`,
      reply.toolResults.map((t) => t.name).join(','),
      '→',
      reply.content.slice(0, 80),
    );
    assert.ok(!reply.interrupted, `回复中断：${reply.content}`);
    return chat;
  };

  const a = await call(`window.dela.session.create(${JSON.stringify(alpha.id)}, 'chat')`);
  assert.equal(a.cwd, alphaDir);
  await ask(
    a.sessionId,
    '请用 edit 把引用文件里的 draft 改成 final，然后在项目里新建 todo.md 写一行 ship it。',
    [join(alphaDir, 'notes.md')],
  );
  assert.match(readFileSync(join(alphaDir, 'notes.md'), 'utf8'), /状态：final/);
  assert.ok(existsSync(join(alphaDir, 'todo.md')), 'todo.md 应在 alpha 项目目录内');
  assert.ok(!existsSync(join(betaDir, 'todo.md')), 'todo.md 不应出现在 beta');

  const b = await call(`window.dela.session.create(${JSON.stringify(beta.id)}, 'chat')`);
  assert.equal(b.cwd, betaDir);
  await ask(b.sessionId, '在当前项目新建 hello.txt，内容是 beta。');
  assert.equal(readFileSync(join(betaDir, 'hello.txt'), 'utf8').trim(), 'beta');
  assert.ok(!existsSync(join(alphaDir, 'hello.txt')));

  // 续聊：模型应记得上一轮做过什么（工具调用与结果都在 Pi 会话里）。
  const followUp = await ask(a.sessionId, '刚才你在 todo.md 里写了什么？只回答那一行内容。');
  assert.match(followUp.messages.at(-1).content, /ship it/i);
  const reopened = await call(`window.dela.session.open(${JSON.stringify(a.sessionId)})`);
  assert.equal(reopened.messages.filter((m) => m.role === 'user').length, 2);
  assert.equal(reopened.projectId, alpha.id);
}
