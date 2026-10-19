// 远程项目的真实窗口冒烟：真 preload、真 renderer、真主进程 IPC，远端也真连（需要
// DELA_REMOTE_HOST / DELA_REMOTE_KEY，未设置则跳过并退出 0）；这种链路在 jsdom 里只能靠假 window.dela 代替。
import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, getDatabase } from '../src/main/database';
import { invalidateSessions, registerAgentIpc, subscribeChat } from '../src/main/agent';
import { registerCanvasIpc } from '../src/main/canvas/ipc';
import { registerMailIpc } from '../src/main/mail/ipc';
import { registerNotificationsIpc } from '../src/main/notifications';
import { registerRemoteIpc } from '../src/main/remotes/ipc';
import { remoteOperations } from '../src/main/remotes/operations';
import { exec, probeRemote } from '../src/main/remotes/transport';
import { registerSearchIpc } from '../src/main/search';
import { registerSettingsIpc } from '../src/main/settings/ipc';
import { registerShuiyuanIpc } from '../src/main/shuiyuan/ipc';
import { registerTerminalIpc } from '../src/main/terminal';
import { registerTimetableIpc } from '../src/main/timetable/ipc';
import { registerTodoIpc } from '../src/main/todo';
import { registerWorkspaceIpc } from '../src/main/workspace/ipc';
import { registerPreviewProtocol, registerPreviewScheme } from '../src/main/workspace/preview';

const host = process.env.DELA_REMOTE_HOST;
if (!host) {
  console.log(JSON.stringify({ result: 'skipped', reason: '未设置 DELA_REMOTE_HOST' }));
  app.exit(0);
}
const target = { host: host!, keyPath: process.env.DELA_REMOTE_KEY ?? null };
const profile = mkdtempSync(join(tmpdir(), 'dela-remote-gui-'));
app.setPath('userData', profile);
app.setPath('documents', profile);
app.setPath('home', profile);
// 真实启动是 `electron .`，getAppPath() 就是仓库根；这里入口是 .tools/remote-smoke.cjs，
// getAppPath() 会变成 .tools，于是 vendor/ 下的 helper 与随包 ssh 都找不到、静默降级成 ssh。
// 对齐成仓库根，让冒烟真的走到 helper 通道。
app.getAppPath = () => process.cwd();
registerPreviewScheme();

const errors: string[] = [];
let fixtureRoot: string | null = null;

app
  .whenReady()
  .then(async () => {
    closeDatabase();
    getDatabase();

    // 远端夹具：放在主目录下，这样向导从主目录点一层就能到。
    const home = (await probeRemote(target)).home;
    const root = `${home}/dela-gui-smoke`;
    fixtureRoot = root;
    await exec(
      target,
      `rm -rf ${root} && mkdir -p ${root}/sub && printf 'hello\\n' > ${root}/'a b.txt'`,
    );
    await exec(target, `printf 'nested\\n' > ${root}/sub/nested.md`);

    registerRemoteIpc();
    // 与生产一致：会话订阅与失效钩子由装配层注入。
    registerWorkspaceIpc(subscribeChat, invalidateSessions);
    registerSettingsIpc();
    registerCanvasIpc();
    registerAgentIpc();
    registerTerminalIpc();
    registerSearchIpc();
    registerNotificationsIpc();
    registerTodoIpc();
    registerMailIpc();
    registerTimetableIpc();
    registerShuiyuanIpc();
    registerPreviewProtocol();
    ipcMain.handle('window:get-state', () => ({ maximized: false }));
    const win = new BrowserWindow({
      width: 1440,
      height: 960,
      show: false,
      webPreferences: {
        preload: join(process.cwd(), 'out/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') errors.push(event.message);
    });
    const evaluate = (code: string) => win.webContents.executeJavaScript(code, true);
    const wait = async (code: string, label = code) => {
      // 30 秒：向导的「连接」现在会真的上传并启动 helper（第一次要传几 MB），
      // 15 秒在慢链路上不够；条件一旦成立立刻返回，放宽只是让失败晚一点报出来。
      for (let i = 0; i < 300; i++) {
        if (await evaluate(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const roles = await evaluate(
        `[...document.querySelectorAll('[role]')].slice(0, 40).map(e => e.getAttribute('role') + ':' + (e.getAttribute('aria-label') ?? '')).join(' | ')`,
      );
      throw new Error(
        `等待超时：${label}\n角色：${roles}\n${errors.join('\n')}\n${await evaluate('document.body.innerText')}`,
      );
    };
    // 同名按钮可能同时存在于多处，取可见的最后一个（与 pdf 冒烟一致）。
    const click = (text: string) =>
      evaluate(
        `(() => {
          const buttons = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent !== null);
          if (!buttons.length) throw new Error('按钮不存在：' + ${JSON.stringify(text)});
          buttons.at(-1).click();
        })()`,
      );
    const clickLabel = (label: string) =>
      evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
    const type = (label: string, value: string) =>
      evaluate(`(() => {
        const input = document.querySelector('[aria-label=${JSON.stringify(label)}]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

    await win.loadFile(join(process.cwd(), 'out/renderer/index.html'), {
      query: { 'smoke-test': '1' },
    });
    await evaluate(
      `(() => { const style = document.createElement('style'); style.textContent = '* { transition: none !important; animation: none !important; }'; document.head.append(style); })()`,
    );

    await wait(`document.querySelector('[aria-label="新建项目"]') !== null`, '侧栏新建项目按钮');
    await clickLabel('新建项目');
    await wait(`document.body.innerText.includes('连接远程目录')`, '新建项目弹窗');
    await click('连接远程目录');
    // 空档案里没有已保存的连接，先点「新建连接」才到填写表单。
    await wait(
      `document.querySelector('[aria-label="SSH 目的地"]') !== null || [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '新建连接' && b.offsetParent !== null)`,
      '向导第一步',
    );
    if (!(await evaluate(`document.querySelector('[aria-label="SSH 目的地"]') !== null`)))
      await click('新建连接');
    await wait(`document.querySelector('[aria-label="SSH 目的地"]') !== null`, '向导填写表单');

    // 「连接」会真的自检、上传并启动 helper，先记下远端 helper 进程数作旁证。
    await type('SSH 目的地', host!);
    if (target.keyPath) await type('私钥文件', target.keyPath);
    await click('下一步');
    await wait(`document.body.innerText.includes('目的地')`, '向导第二步');
    const helperCount = async () =>
      Number(
        (await exec(target, 'pgrep -f "[d]ela-helper --port" | wc -l')).stdout.toString().trim(),
      );
    const helpersBefore = await helperCount();
    await click('连接');
    // 自检结果与引导进度都落在日志区（role=log）里：自检那行是「主机名 · 系统 架构」。
    await wait(
      `(() => {
        const el = document.querySelector('[role="log"]');
        return !!el && el.innerText.includes('Linux');
      })()`,
      '自检通过的提示（主机名 · 系统 架构）',
    );
    // 自检过了不等于 helper 起好：上传几 MB 产物要几十秒，必须等日志走到「就绪」那一步
    // 再做判断，否则看到的是上传中途的快照。
    await wait(
      `(() => {
        const el = document.querySelector('[role="log"]');
        return !!el && el.innerText.includes('就绪');
      })()`,
      '引导日志走到就绪',
    );
    // 先看向导自己的结论：降级（helper 不可用）与就绪在日志里是不同的两行。
    const ready = await evaluate(
      `document.querySelector('[role="log"]').innerText.includes('helper 通道已就绪')`,
    );
    assert.ok(ready, '「连接」没有把 helper 引导起来：日志里应出现「helper 通道已就绪」');
    // 再数一次远端进程作为旁证：留到现在的实例可能刚好到期，所以只要求不减少且至少有一个。
    const helpersAfterConnect = await helperCount();
    assert.ok(
      helpersAfterConnect >= 1 && helpersAfterConnect >= helpersBefore,
      '「连接」没有在服务器上留下 helper 进程：这一步就该上传并启动它',
    );

    await click('下一步：选择目录');
    await wait(
      `[...document.querySelectorAll('li button')].some(b => b.textContent.trim() === 'dela-gui-smoke')`,
      '向导里的远端目录清单',
    );
    await evaluate(
      `[...document.querySelectorAll('li button')].find(b => b.textContent.trim() === 'dela-gui-smoke').click()`,
    );
    await wait(
      `[...document.querySelectorAll('span[title]')].some(s => s.getAttribute('title') === ${JSON.stringify(root)})`,
      '向导当前路径',
    );

    // 列一层不应重建 helper 通道，否则又付一次上传与启动。
    await click('添加为项目');
    await wait(
      `document.querySelector('[role="treeitem"][aria-label="a b.txt"]') !== null`,
      '远端目录树里的文件行',
    );
    const entry = await evaluate(`(async () => {
      const state = await window.dela.workspace.getState();
      const item = state.entries.find(e => e.name === 'dela-gui-smoke');
      return item ? { id: item.id, remoteId: item.remoteId ?? null, path: item.path ?? null } : null;
    })()`);
    assert.ok(entry, '工作区状态里没有刚添加的远程项目');
    assert.ok(entry.remoteId, `远程项目的 remoteId 没有传到渲染端：${JSON.stringify(entry)}`);
    assert.equal(entry.path, root);

    const title = await evaluate(
      `document.querySelector('[role="treeitem"][aria-label="a b.txt"]').querySelector('[title]').getAttribute('title')`,
    );
    assert.equal(title, `${host}:${root}/a b.txt`);
    await evaluate(`document.querySelector('[role="treeitem"][aria-label="sub"]').click()`);
    await wait(
      `document.querySelector('[role="treeitem"][aria-label="nested.md"]') !== null`,
      '第二层远端清单（点目录才拉）',
    );
    const tabsBefore = await evaluate(`document.querySelectorAll('[role="tab"]').length`);
    assert.ok(
      (await helperCount()) >= helpersAfterConnect,
      '向导建立的那条 helper 通道没有留在原地：目录树列一层时它不见了',
    );
    await evaluate(`document.querySelector('[role="treeitem"][aria-label="a b.txt"]').click()`);
    await wait(
      `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('a b.txt')`,
      '远端文件预览标签',
    );
    await wait(
      `document.querySelector('section[aria-label="文档：a b.txt"]')?.textContent.includes('hello')`,
      '预览里的远端文件内容',
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('[role="tab"]').length`),
      tabsBefore + 1,
      '点远端文件应该新增一个预览标签',
    );

    // 远端条目只给远端动作（本地的重命名/移动/移除在远端子条目上只会失败）。
    // Radix 的菜单在 pointerdown 上开，不是 click。
    const menuItems = `[...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim()).join('|')`;
    const openMenu = (label: string) =>
      evaluate(`(() => {
        const el = document.querySelector('[aria-label=${JSON.stringify(`${label} 的操作`)}]');
        const init = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' };
        el.dispatchEvent(new PointerEvent('pointerdown', init));
        el.dispatchEvent(new PointerEvent('pointerup', init));
      })()`);
    const closeMenu = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;
    await openMenu('a b.txt');
    await wait(`${menuItems}.includes('下载到本地')`, '远端文件的下载入口');
    const fileMenu = await evaluate(menuItems);
    assert.ok(fileMenu.includes('用系统默认程序打开'), `远端文件菜单缺少打开入口：${fileMenu}`);
    assert.ok(!fileMenu.includes('重命名'), `远端文件菜单不该出现本地动作：${fileMenu}`);
    await evaluate(closeMenu);
    await openMenu('sub');
    await wait(`${menuItems}.includes('上传本地文件')`, '远端目录的上传入口');
    const dirMenu = await evaluate(menuItems);
    assert.ok(!dirMenu.includes('新建文件夹'), `远端目录菜单不该出现本地动作：${dirMenu}`);
    await evaluate(closeMenu);

    const references = await evaluate(
      `(async () => (await window.dela.workspace.remoteReferences(${JSON.stringify(entry.id)})).map(r => r.title ?? r.key))()`,
    );
    assert.ok(references.includes('a b.txt'), `@ 候选缺少远端文件：${JSON.stringify(references)}`);
    assert.ok(
      references.includes('sub/nested.md'),
      `@ 候选缺少子目录文件：${JSON.stringify(references)}`,
    );

    // 远端没有文件监听：工具写文件后靠主进程广播让目录树重读，否则只能收起再展开。
    await remoteOperations(target).write.writeFile(`${root}/fresh.txt`, '新文件\n');
    await wait(
      `document.querySelector('[role="treeitem"][aria-label="fresh.txt"]') !== null`,
      '刷新后自动出现的远端新文件',
    );

    // Dela 之外改的远端文件只走一次性 ssh，靠 helper 的 inotify watch 推回来；
    // 每轮重 touch 一次，避免「上报监视集合」和这次改动抢跑。
    const outside = `${root}/outside-watch.txt`;
    const outsideShown = `document.querySelector('[role="treeitem"][aria-label="outside-watch.txt"]') !== null`;
    let watched = false;
    for (let attempt = 0; attempt < 12 && !watched; attempt++) {
      await exec(target, `touch ${outside}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      watched = await evaluate(outsideShown);
    }
    assert.ok(watched, 'Dela 之外建的文件没有出现在目录树里（watch 没生效）');

    // 远程终端：本地 node-pty 起 ssh -tt，远端给交互登录 shell，cwd 应是项目目录。
    await evaluate(`(async () => {
      window.__term = { id: crypto.randomUUID(), data: '' };
      window.dela.terminal.onEvent((event) => {
        if (event.type === 'data') window.__term.data += event.data;
      });
      await window.dela.terminal.create(${JSON.stringify(entry.id)}, window.__term.id);
    })()`);
    let termData = '';
    try {
      // 提示符里主目录被 bash 缩写成 ~（PS1 的 \w），所以按 ~/目录名 断言。
      const prompt = `~/${root.split('/').pop()}`;
      for (let i = 0; i < 100 && !termData.includes(prompt); i++) {
        termData = await evaluate(`window.__term.data`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!termData.includes(prompt)) {
        const snapshots = await evaluate(
          `(async () => (await window.dela.terminal.list(${JSON.stringify(entry.id)})).map(s => ({ exitCode: s.exitCode, tail: s.buffer.slice(-400) })))()`,
        );
        throw new Error(
          `远端终端里没等到项目目录。\n事件数据：${JSON.stringify(termData.slice(-400))}\n快照：${JSON.stringify(snapshots)}`,
        );
      }
      await evaluate(`window.dela.terminal.write(window.__term.id, 'echo MARK-$(pwd)\\r')`);
      // 只认命令输出：输入回显里是 MARK-$(pwd)，展开成绝对路径的结果不会出现在回显里。
      await wait(`window.__term.data.includes('MARK-${root}')`, '远端终端执行命令的输出');
      const buffer = await evaluate(
        `(async () => (await window.dela.terminal.list(${JSON.stringify(entry.id)})).map(s => s.buffer).join(''))()`,
      );
      assert.ok(buffer.includes(`MARK-${root}`), '终端快照里没有命令输出');
    } finally {
      await evaluate(`window.dela.terminal.close(window.__term.id)`).catch(() => {});
    }

    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          result: 'passed',
          profile,
          root,
          references,
          terminal: true,
          watch: true,
          preview: true,
          errors,
        },
        null,
        2,
      ),
    );
    await exec(target, `rm -rf ${root}`);
    fixtureRoot = null;
    win.destroy();
    app.quit();
  })
  .catch(async (error) => {
    console.error(error);
    if (fixtureRoot) await exec(target, `rm -rf ${fixtureRoot}`).catch(() => {});
    app.exit(1);
  });
