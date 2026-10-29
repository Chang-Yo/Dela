// 真实应用、独立用户目录：验证 Pi packages 的完整链路（本地夹具包，不联网、不下载 Node）。
// 用法：pnpm build && electron scripts/packages-smoke.cjs [项目根或 app.asar]
// 覆盖：经窗口 IPC 安装 → 默认关闭 → 启用 → 包的 Skill 出现在 Skills 分区、命令出现在包清单 → 会话加载扩展
// （session_start 通知、/ 候选）→ 扩展命令的对话框在渲染端往返 → 可见消息进会话 → 卸载后新会话不再加载、
// Skills 分区不再列出；会话命令 /name、/reload（扩展重新加载）、/compact（对话太短的说明）走真实 IPC；
// 打包产物里同时验证 jiti 从 asar 解析宿主模块。
const { app } = require('electron');
const { createServer } = require('node:http');
const { cpSync, mkdtempSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

const root = resolve(process.argv[2] || '.');
app.setAppPath(root);
if (root.endsWith('.asar')) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  process.resourcesPath = dirname(root);
}
const profile = mkdtempSync(join(tmpdir(), 'dela-packages-smoke-'));
app.setPath('userData', profile);
app.setPath('documents', profile);
process.argv.push('--terminal-smoke-test');

// 夹具从仓库源码目录复制到临时目录：不把测试目录登记进用户数据。
const fixture = join(profile, 'fixture-package');
cpSync(join(__dirname, '..', 'src', 'main', 'agent', 'test', 'fixtures', 'pi-package'), fixture, {
  recursive: true,
});

/** 最小 OpenAI 兼容服务：每次只回一句话，冒烟不关心模型内容。 */
function mockModel() {
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`);
      frame({ choices: [{ index: 0, delta: { content: 'ok' } }] });
      frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      response.end('data: [DONE]\n\n');
    });
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', () => {
    void run(window)
      .then(() => {
        console.log('Packages smoke passed:', profile);
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
  const server = await mockModel();
  const js = (source) => window.webContents.executeJavaScript(`(async () => ${source})()`);
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await js(
    `window.dela.llm.save(${JSON.stringify({ name: 'smoke', baseUrl, apiKey: 'smoke', models: ['m'] })})`,
  );

  // 渲染端记录扩展事件，并自动回答对话框（选第二项、确认）。
  await js(`(() => {
    window.__events = [];
    window.dela.packages.onUiEvent((event) => window.__events.push(event));
    window.dela.packages.onUiRequest((request) => {
      window.__events.push({ type: 'request', kind: request.kind, title: request.title });
      void window.dela.packages.reply(request.id, request.kind === 'select' ? request.options[1] : true);
    });
  })()`);

  // 本地来源不需要 npm：开关在这里只是写设置（本机有 npm 就用，没有也不影响本地包）。
  const settings = await js(`window.dela.packages.enable().catch((e) => ({ error: String(e) }))`);
  if (settings.error) console.warn('npm 运行时不可用，只验证本地来源：', settings.error);

  const installed = await js(`window.dela.packages.install(${JSON.stringify(fixture)})`);
  assert.equal(installed.length, 1);
  assert.equal(installed[0].enabled, false, '新装的包默认关闭');
  assert.deepEqual(installed[0].counts, { extensions: 1, skills: 1, prompts: 1, themes: 1 });
  const enabled = await js(
    `window.dela.packages.setEnabled(${JSON.stringify(installed[0].id)}, true)`,
  );
  assert.deepEqual(
    enabled[0].provides.commands.map((command) => command.name).sort(),
    ['fixture-ask', 'fixture-fail'],
    '启用后包清单列出扩展命令',
  );
  const skills = await js(`window.dela.capability.listSkills()`);
  const packageSkill = skills.find((skill) => skill.name === 'fixture-skill');
  assert.equal(packageSkill?.origin, 'package', '包的 Skill 出现在 Skills 分区');
  assert.equal(packageSkill?.group?.label, 'dela-fixture-package');

  const chat = await js(`window.dela.session.create(null, 'chat')`);
  const commands = await js(
    `window.dela.chat.listSessionCommands(${JSON.stringify(chat.sessionId)})`,
  );
  const names = commands.map((command) => command.name);
  assert.ok(names.includes('fixture-ask'), `扩展命令应在 / 候选里：${names}`);
  assert.ok(names.includes('fixture-review'), `prompt 模板应在 / 候选里：${names}`);

  const after = await js(
    `window.dela.session.ask(${JSON.stringify(chat.sessionId)}, { text: '/fixture-ask smoke', attachments: [], context: [] })`,
  );
  const events = await js('window.__events');
  assert.ok(
    events.some((event) => event.type === 'notify' && event.message === 'fixture started in rpc'),
    `session_start 通知应到达渲染端：${JSON.stringify(events)}`,
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'request').map((event) => event.kind),
    ['select', 'confirm'],
  );
  const visible = after.messages.filter((message) => message.extension);
  assert.equal(visible.at(-1)?.content, 'picked blue true');
  assert.ok(
    !events.some((event) => event.type === 'error'),
    `扩展不应报错：${JSON.stringify(events.filter((event) => event.type === 'error'))}`,
  );
  const state = await js(`window.dela.packages.sessionState(${JSON.stringify(chat.sessionId)})`);
  assert.deepEqual(state.statuses, [{ key: 'fixture', text: 'color: blue' }]);

  // 会话命令：/name 改标题（会话要有过消息才进列表），/reload 重建实例、扩展的 session_start 再跑一遍，
  // /compact 在对话太短时给出说明。
  const id = JSON.stringify(chat.sessionId);
  await js(`window.dela.session.ask(${id}, { text: 'hello', attachments: [], context: [] })`);
  await js(`window.dela.session.runCommand(${id}, 'name', '冒烟改名')`);
  const listed = await js(`window.dela.session.list(null, '')`);
  assert.equal(listed.find((item) => item.id === chat.sessionId)?.title, '冒烟改名');
  const started = () =>
    js(`window.__events.filter((event) => event.message === 'fixture started in rpc').length`);
  const before = await started();
  await js(`window.dela.session.runCommand(${id}, 'reload', '')`);
  assert.equal(await started(), before + 1, '/reload 后扩展重新加载');
  const compacted = await js(
    `window.dela.session.runCommand(${id}, 'compact', '').then(() => 'ok', (e) => String(e))`,
  );
  assert.match(compacted, /对话还太短/);

  await js(`window.dela.packages.remove(${JSON.stringify(installed[0].id)})`);
  const next = await js(`window.dela.session.create(null, 'chat')`);
  const left = await js(`window.dela.chat.listSessionCommands(${JSON.stringify(next.sessionId)})`);
  assert.ok(!left.some((command) => command.name === 'fixture-ask'), '卸载后新会话不再加载扩展');
  const remaining = await js(`window.dela.capability.listSkills()`);
  assert.ok(
    !remaining.some((skill) => skill.origin === 'package'),
    '卸载后 Skills 分区不再列出包的 Skill',
  );
  server.close();
}
