import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, getDatabase } from '../src/main/database';
import {
  canvasNextPage,
  configureCanvas,
  readCanvasSource,
  registerCanvasIpc,
  syncCanvasCourse,
  syncCanvasCourses,
} from '../src/main/canvas';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  readWorkspaceEntry,
  registerWorkspaceIpc,
  saveWorkspaceNote,
  updateWorkspaceEntry,
} from '../src/main/projects';
import { saveModelCredential } from '../src/main/credentials';

const profile = mkdtempSync(join(tmpdir(), 'dela-workspace-test-'));
app.setPath('userData', profile);
const pdf = new TextEncoder().encode('%PDF-1.4\nfixture');
let failFiles = false;
let storageGets = 0;
let modelCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  if (url.hostname === 'models.sjtu.edu.cn') {
    modelCalls += 1;
    const body = JSON.parse(String(init?.body));
    const text = body.messages.at(-1).content;
    assert.match(text, /本次选中的资料/);
    assert.match(text, /恢复测试/);
    assert.doesNotMatch(text, /不应发送的资料/);
    return json({ choices: [{ message: { content: '这是引用所选笔记的测试回答。' } }] });
  }
  if (url.hostname === 's3.jcloud.sjtu.edu.cn') {
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    storageGets += 1;
    return new Response(pdf);
  }
  assert.equal(url.origin, 'https://oc.sjtu.edu.cn');
  assert.match(new Headers(init?.headers).get('Authorization') ?? '', /^Bearer /);
  if (url.pathname === '/files/3/download')
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://s3.jcloud.sjtu.edu.cn/fixture.pdf' },
    });
  if (url.pathname.endsWith('/users/self/profile')) return json({ id: 1 });
  if (url.pathname.endsWith('/courses')) {
    if (url.searchParams.get('page') === '2')
      return json([{ id: 2, name: '历史课程', term: { name: '2025 秋季' } }]);
    return json([{ id: 1, name: '验证课程', term: { name: '2026 秋季' } }], {
      Link: '<https://oc.sjtu.edu.cn/api/v1/courses?page=2>; rel="next"',
    });
  }
  if (url.pathname.endsWith('/courses/1/folders'))
    return json([
      { id: 10, parent_folder_id: null, name: 'course files' },
      { id: 11, parent_folder_id: 10, name: '第三章' },
    ]);
  if (url.pathname.endsWith('/courses/1/files'))
    return failFiles
      ? new Response('', { status: 401 })
      : json([
          {
            id: 3,
            folder_id: 11,
            display_name: '课件.pdf',
            size: pdf.length,
            'content-type': 'application/pdf',
            updated_at: '2026-09-01',
          },
        ]);
  if (url.pathname.endsWith('/files/3'))
    return json({
      id: 3,
      size: pdf.length,
      'content-type': 'application/pdf',
      url: 'https://oc.sjtu.edu.cn/files/3/download',
    });
  if (url.pathname.endsWith('/assignments'))
    return json([
      {
        id: 4,
        name: '实验要求',
        description: '<h1>实验要求</h1><p>比较分类误差。</p>',
        due_at: null,
        html_url: 'https://oc.sjtu.edu.cn/courses/1/assignments/4',
      },
    ]);
  if (url.pathname.endsWith('/discussion_topics')) return json([]);
  if (url.pathname.endsWith('/modules')) return json([{ id: 20, name: '分类模型' }]);
  if (url.pathname.endsWith('/modules/20/items'))
    return url.searchParams.get('page') === '2'
      ? json([{ id: 22, title: '实验要求', type: 'Assignment', content_id: 4 }])
      : json([{ id: 21, title: '课件引用', type: 'File', content_id: 3 }], {
          Link: '<https://oc.sjtu.edu.cn/api/v1/courses/1/modules/20/items?page=2>; rel="next"',
        });
  throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
};

app
  .whenReady()
  .then(async () => {
    const db = getDatabase();
    db.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('directory', ?)").run(
      join(profile, 'notes'),
    );
    await configureCanvas('fixture-token');
    assert.equal((await syncCanvasCourses()).courses.length, 2);
    const synced = await syncCanvasCourse(1);
    assert.equal(synced.items.find((item) => item.name === '课件.pdf')?.parentId, 'folder:11');
    assert.equal(synced.items.find((item) => item.id === 'module-item:21')?.sourceId, 'file:3');
    assert.equal(
      synced.items.find((item) => item.id === 'module-item:22')?.sourceId,
      'assignment:4',
    );
    assert.throws(() => canvasNextPage('<https://example.com/steal>; rel="next"'), /分页地址无效/);
    failFiles = true;
    const partial = await syncCanvasCourse(1);
    assert(partial.courses.find((course) => course.id === 1)?.error?.includes('401'));
    assert(partial.items.some((item) => item.name === '课件.pdf'));
    const [first, second] = await Promise.all([
      readCanvasSource('file:3'),
      readCanvasSource('file:3'),
    ]);
    assert.equal(first.format, 'pdf');
    assert.equal(second.bytes?.length, pdf.length);
    assert.equal(storageGets, 1);
    assert.equal((await readCanvasSource('assignment:4')).format, 'html');

    const folder = createWorkspaceEntry({ name: '主题资料', kind: 'folder', parentId: null });
    const child = createWorkspaceEntry({ name: '参考', kind: 'folder', parentId: folder.id });
    updateWorkspaceEntry(folder.id, { kind: 'project' });
    assert.equal(
      getWorkspaceState().entries.find((entry) => entry.id === folder.id)?.kind,
      'project',
    );
    assert.throws(() => updateWorkspaceEntry(folder.id, { parentId: child.id }), /子文件夹/);
    const note = createWorkspaceEntry({
      name: '笔记.md',
      kind: 'note',
      parentId: child.id,
      text: '# 初稿',
    });
    const other = createWorkspaceEntry({ name: '独立项目', kind: 'project', parentId: null });
    const ref1 = createWorkspaceEntry({
      name: '实验要求',
      kind: 'source',
      sourceId: 'assignment:4',
      parentId: child.id,
    });
    const ref2 = createWorkspaceEntry({
      name: '实验要求',
      kind: 'source',
      sourceId: 'assignment:4',
      parentId: other.id,
    });
    assert.equal(
      createWorkspaceEntry({
        name: '实验要求',
        kind: 'source',
        sourceId: 'assignment:4',
        parentId: child.id,
      }).id,
      ref1.id,
    );
    assert.equal(ref1.sourceId, ref2.sourceId);
    const opened = await readWorkspaceEntry(note.id);
    const revision = saveWorkspaceNote(note.id, '# 恢复测试', opened.revision!);
    const path = (
      db.prepare('SELECT path FROM workspace_notes WHERE id=?').get(note.noteId) as { path: string }
    ).path;
    writeFileSync(path, '# 外部编辑');
    assert.throws(() => saveWorkspaceNote(note.id, '# 不覆盖', revision), /外部修改/);
    assert.equal(readFileSync(path, 'utf8'), '# 外部编辑');
    const disk = await readWorkspaceEntry(note.id);
    saveWorkspaceNote(note.id, '# 恢复测试', disk.revision!);
    updateWorkspaceEntry(note.id, { parentId: folder.id, name: '记录.md' });
    createWorkspaceEntry({
      name: '未选资料',
      kind: 'note',
      parentId: other.id,
      text: '不应发送的资料',
    });

    registerCanvasIpc();
    registerWorkspaceIpc();
    ipcMain.handle('window:get-state', () => ({ maximized: false }));
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(process.cwd(), 'out/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadFile(join(process.cwd(), 'out/renderer/index.html'));
    const invoke = (body: string) =>
      win.webContents.executeJavaScript(`(async () => { ${body} })()`);
    await invoke(
      `await window.dela.workspace.saveView(${JSON.stringify(folder.id)}, {tabs:[${JSON.stringify(note.id)}], active:${JSON.stringify(note.id)}, expanded:[${JSON.stringify(child.id)}], scroll:{${JSON.stringify(note.id)}:120}});`,
    );
    saveModelCredential('fixture-model-key', 'qwen');
    const chat = await invoke(
      `return await window.dela.workspace.ask(${JSON.stringify(folder.id)}, '总结所选笔记', [${JSON.stringify(note.id)}]);`,
    );
    assert.equal(chat.messages.length, 2);
    assert.equal(modelCalls, 1);
    await invoke(`await window.dela.workspace.remove(${JSON.stringify(child.id)});`);
    assert.equal((await readWorkspaceEntry(ref2.id)).format, 'html');
    assert(existsSync(path));
    closeDatabase();
    const restored = getWorkspaceState();
    assert.equal(restored.views[folder.id]?.active, note.id);
    assert.equal(restored.views[folder.id]?.scroll[note.id], 120);
    assert.equal((await readWorkspaceEntry(note.id)).text, '# 恢复测试');
    const restoredChat = await invoke(
      `return await window.dela.workspace.getChat(${JSON.stringify(folder.id)});`,
    );
    assert.equal(restoredChat.messages.length, 2);
    win.destroy();
    closeDatabase();
    console.log(
      'Workspace smoke passed: pagination, partial-sync cache, shared references, download isolation, folder conversion/moves, note conflict protection, persistent tabs/scroll/chat and selected model context.',
    );
    app.quit();
  })
  .catch((error: unknown) => {
    console.error(error);
    closeDatabase();
    app.exit(1);
  });
