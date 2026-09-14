import { app, BrowserWindow, ipcMain, net } from 'electron';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  truncateSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { closeDatabase, getDatabase } from '../src/main/database';
import { prepareEmail } from '../src/main/mail/drafts';
import { releaseComposeFiles } from '../src/main/mail/send';
import {
  canvasNextPage,
  configureCanvas,
  readCanvasSource,
  syncCanvasCourse,
  syncCanvasCourses,
} from '../src/main/canvas/api';
import { registerCanvasIpc } from '../src/main/canvas/ipc';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  importWorkspaceFiles,
  readWorkspaceEntry,
  saveWorkspaceNote,
  updateWorkspaceEntry,
} from '../src/main/workspace/api';
import { registerPreviewProtocol, registerPreviewScheme } from '../src/main/workspace/preview';
import { registerWorkspaceIpc } from '../src/main/workspace/ipc';
import { saveModelCredential } from '../src/main/credentials';

const profile = mkdtempSync(join(tmpdir(), 'dela-workspace-test-'));
app.setPath('userData', profile);
registerPreviewScheme();
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
    assert.equal(first.bytes, undefined);
    assert.match(second.previewUrl ?? '', /^dela-resource:\/\/canvas\/file%3A3/);
    assert.equal(storageGets, 1);
    const canvasKey = createHash('sha256').update('3:2026-09-01').digest('hex');
    const cachedPath = (
      db
        .prepare('SELECT value FROM workspace_settings WHERE key=?')
        .get(`canvas-file:${canvasKey}`) as { value: string }
    ).value;
    assert.equal(
      cachedPath,
      join(
        profile,
        'notes',
        'courses',
        'term-2026-fall',
        '验证课程 [1]',
        'files',
        'folder-11',
        '课件.pdf',
      ),
    );
    assert.deepEqual(new Uint8Array(readFileSync(cachedPath)), pdf);
    const oldCanvasPath = join(
      profile,
      'notes',
      '课程资料',
      '2026 秋季',
      '验证课程 [1]',
      '文件',
      '第三章',
      '课件.pdf',
    );
    mkdirSync(dirname(oldCanvasPath), { recursive: true });
    renameSync(cachedPath, oldCanvasPath);
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      `canvas-file:${canvasKey}`,
      oldCanvasPath,
    );
    await readCanvasSource('file:3');
    assert.equal(
      (
        db
          .prepare('SELECT value FROM workspace_settings WHERE key=?')
          .get(`canvas-file:${canvasKey}`) as { value: string }
      ).value,
      cachedPath,
    );
    const largePdfId = randomUUID();
    const largePdfPath = join(profile, 'large-fixture.pdf');
    const largePdfSize = 256 * 1024 * 1024;
    writeFileSync(largePdfPath, pdf);
    truncateSync(largePdfPath, largePdfSize);
    db.prepare('INSERT INTO workspace_entries VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?)').run(
      largePdfId,
      'large-fixture.pdf',
      'local',
      largePdfPath,
      new Date().toISOString(),
    );
    const largePdf = await readWorkspaceEntry(largePdfId);
    assert.equal(largePdf.format, 'pdf');
    assert.equal(largePdf.bytes, undefined);
    registerPreviewProtocol();
    const preview = await net.fetch(second.previewUrl!);
    assert.equal(preview.status, 200);
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), pdf);
    const previewRange = await net.fetch(second.previewUrl!, {
      headers: { Range: 'bytes=0-4' },
    });
    assert.equal(previewRange.status, 206);
    assert.equal(await previewRange.text(), '%PDF-');
    const largePreviewRange = await net.fetch(largePdf.previewUrl!, {
      headers: { Range: 'bytes=0-4' },
    });
    assert.equal(largePreviewRange.status, 206);
    assert.equal(largePreviewRange.headers.get('content-range'), `bytes 0-4/${largePdfSize}`);
    assert.equal(await largePreviewRange.text(), '%PDF-');
    // Legacy cache migration must work without downloading or overwriting an existing file.
    mkdirSync(join(profile, 'canvas-cache'), { recursive: true });
    writeFileSync(join(profile, 'canvas-cache', canvasKey), pdf);
    db.prepare('DELETE FROM workspace_settings WHERE key=?').run(`canvas-file:${canvasKey}`);
    await readCanvasSource('file:3');
    assert.equal(storageGets, 1);
    assert(
      existsSync(
        join(
          profile,
          'notes',
          'courses',
          'term-2026-fall',
          '验证课程 [1]',
          'files',
          'folder-11',
          '课件 (2).pdf',
        ),
      ),
    );
    assert.equal((await readCanvasSource('assignment:4')).format, 'html');

    const folder = createWorkspaceEntry({ name: '主题资料', kind: 'folder', parentId: null });
    const child = createWorkspaceEntry({ name: '参考', kind: 'folder', parentId: folder.id });
    const outsideFile = join(profile, '外部文件.txt');
    writeFileSync(outsideFile, '原文件');
    const [imported] = importWorkspaceFiles(child.id, [outsideFile]);
    assert.equal(readFileSync(outsideFile, 'utf8'), '原文件');
    assert.equal(
      readFileSync(join(profile, 'notes', 'workspace', '主题资料', '参考', '外部文件.txt'), 'utf8'),
      '原文件',
    );
    assert.equal((await readWorkspaceEntry(imported!.id)).text, '原文件');
    updateWorkspaceEntry(folder.id, { kind: 'project' });
    assert.equal(
      getWorkspaceState().entries.find((entry) => entry.id === folder.id)?.kind,
      'project',
    );
    assert.throws(() => updateWorkspaceEntry(folder.id, { parentId: child.id }), /子文件夹/);
    const oldWorkspaceRoot = join(profile, 'notes', '工作区');
    const workspaceRoot = join(profile, 'notes', 'workspace');
    renameSync(workspaceRoot, oldWorkspaceRoot);
    db.prepare('UPDATE workspace_entries SET local_path=REPLACE(local_path, ?, ?)').run(
      workspaceRoot,
      oldWorkspaceRoot,
    );
    getWorkspaceState();
    assert(existsSync(workspaceRoot));
    assert(!existsSync(oldWorkspaceRoot));
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
    let path = (
      db.prepare('SELECT path FROM workspace_notes WHERE id=?').get(note.noteId) as { path: string }
    ).path;
    assert.equal(path, join(profile, 'notes', 'workspace', '主题资料', '参考', '笔记.md'));
    const duplicateNote = createWorkspaceEntry({
      name: '笔记.md',
      kind: 'note',
      parentId: child.id,
      text: '独立副本',
    });
    assert.equal((await readWorkspaceEntry(duplicateNote.id)).text, '独立副本');
    assert(existsSync(join(profile, 'notes', 'workspace', '主题资料', '参考', '笔记 (2).md')));
    const legacyId = randomUUID();
    const legacyNoteId = randomUUID();
    const legacyPath = join(profile, 'notes', `${legacyNoteId}.md`);
    writeFileSync(legacyPath, '旧版内容');
    db.prepare('INSERT INTO workspace_notes VALUES (?, ?)').run(legacyNoteId, legacyPath);
    db.prepare('INSERT INTO workspace_entries VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)').run(
      legacyId,
      child.id,
      '旧版笔记',
      'note',
      legacyNoteId,
      new Date().toISOString(),
    );
    getWorkspaceState();
    assert.equal((await readWorkspaceEntry(legacyId)).text, '旧版内容');
    assert.equal(
      readFileSync(join(profile, 'notes', 'workspace', '主题资料', '参考', '旧版笔记'), 'utf8'),
      '旧版内容',
    );
    assert.equal(readFileSync(legacyPath, 'utf8'), '旧版内容');
    writeFileSync(path, '# 外部编辑');
    assert.throws(() => saveWorkspaceNote(note.id, '# 不覆盖', revision), /外部修改/);
    assert.equal(readFileSync(path, 'utf8'), '# 外部编辑');
    const disk = await readWorkspaceEntry(note.id);
    saveWorkspaceNote(note.id, '# 恢复测试', disk.revision!);
    updateWorkspaceEntry(note.id, { parentId: folder.id, name: '记录.md' });
    assert(!existsSync(path));
    path = join(profile, 'notes', 'workspace', '主题资料', '记录.md');
    assert.equal(readFileSync(path, 'utf8'), '# 恢复测试');
    updateWorkspaceEntry(child.id, { name: '参考改名', parentId: other.id });
    assert.equal(
      readFileSync(join(profile, 'notes', 'workspace', '独立项目', '参考改名', '旧版笔记'), 'utf8'),
      '旧版内容',
    );
    assert.equal((await readWorkspaceEntry(duplicateNote.id)).text, '独立副本');
    // Simulate a crash after the physical rename but before the database commit.
    const moveFrom = join(profile, 'notes', 'workspace', '独立项目', '参考改名');
    const moveTo = join(profile, 'notes', 'workspace', '独立项目', '恢复后的参考');
    db.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('storage-move', ?)").run(
      JSON.stringify({
        from: moveFrom,
        to: moveTo,
        id: child.id,
        name: '恢复后的参考',
        parentId: other.id,
        kind: 'folder',
      }),
    );
    renameSync(moveFrom, moveTo);
    closeDatabase();
    getWorkspaceState();
    assert.equal((await readWorkspaceEntry(legacyId)).text, '旧版内容');
    assert(existsSync(join(moveTo, '笔记 (2).md')));
    const odd = createWorkspaceEntry({
      name: '../CON',
      kind: 'note',
      parentId: folder.id,
      text: '安全路径',
    });
    assert.equal((await readWorkspaceEntry(odd.id)).text, '安全路径');
    assert(existsSync(join(profile, 'notes', 'workspace', '主题资料', '.._CON')));
    assert(existsSync(join(profile, 'dela-before-storage-tree.db')));
    renameSync(path, `${path}.external`);
    assert.throws(() => updateWorkspaceEntry(note.id, { name: '不应生效.md' }));
    assert.equal(
      getWorkspaceState().entries.find((entry) => entry.id === note.id)?.name,
      '记录.md',
    );
    renameSync(`${path}.external`, path);
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
    const email = prepareEmail({
      to: ['recipient@example.com'],
      subject: '报告草稿',
      text: '请查看附件',
      attachments: [{ type: 'workspace', id: note.id }],
    });
    assert.equal(email.sent, false);
    const prepared = await invoke(
      `return await window.dela.mail.openDraft(${JSON.stringify(email.draftId)});`,
    );
    assert.equal(prepared.subject, '报告草稿');
    assert.equal(prepared.text, '请查看附件');
    assert.equal(prepared.files.length, 1);
    assert.equal(prepared.files[0].size, Buffer.byteLength('# 恢复测试'));
    assert.equal('path' in prepared.files[0], false);
    releaseComposeFiles(prepared.files.map((file: { id: string }) => file.id));
    assert.equal(chat.running, false);
    assert.equal(await invoke(`return typeof window.dela.workspace.cancelAsk;`), 'function');
    assert.equal(await invoke(`return typeof window.dela.workspace.onChatUpdate;`), 'function');
    await invoke(`await document.fonts.ready;`);
    assert.equal(
      await invoke(`return Boolean(document.querySelector('textarea[aria-label="发送给助手"]'));`),
      true,
    );
    writeFileSync(
      join(process.cwd(), '.tools', 'agent-home.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await invoke(`await window.dela.workspace.remove(${JSON.stringify(child.id)});`);
    assert.equal((await readWorkspaceEntry(ref2.id)).format, 'html');
    assert(existsSync(path));
    assert.equal(readFileSync(join(moveTo, '旧版笔记'), 'utf8'), '旧版内容');
    closeDatabase();
    const restored = getWorkspaceState();
    assert.equal(restored.views[folder.id]?.active, note.id);
    assert.equal(restored.views[folder.id]?.scroll[note.id], 120);
    assert.equal((await readWorkspaceEntry(note.id)).text, '# 恢复测试');
    const restoredChat = await invoke(
      `return await window.dela.workspace.getChat(${JSON.stringify(folder.id)});`,
    );
    assert.equal(restoredChat.messages.length, 2);
    // 多会话：新对话后旧会话保留在历史中，可搜索、重新打开与删除。
    await invoke(`await window.dela.workspace.newChat(${JSON.stringify(folder.id)});`);
    const secondAsk = await invoke(
      `return await window.dela.workspace.ask(${JSON.stringify(folder.id)}, '第二轮提问', [${JSON.stringify(note.id)}]);`,
    );
    assert.equal(secondAsk.messages.length, 2);
    assert.notEqual(secondAsk.sessionId, restoredChat.sessionId);
    const byQuery = await invoke(
      `return await window.dela.workspace.listChats(${JSON.stringify(folder.id)}, '第二轮');`,
    );
    assert.equal(byQuery.length, 1);
    const allSessions = await invoke(
      `return await window.dela.workspace.listChats(${JSON.stringify(folder.id)}, '');`,
    );
    assert.equal(allSessions.length, 2);
    const reopened = await invoke(
      `return await window.dela.workspace.openChat(${JSON.stringify(folder.id)}, ${JSON.stringify(restoredChat.sessionId)});`,
    );
    assert.equal(reopened.messages.length, 2);
    await invoke(
      `await window.dela.workspace.deleteChat(${JSON.stringify(folder.id)}, ${JSON.stringify(secondAsk.sessionId)});`,
    );
    const remaining = await invoke(
      `return await window.dela.workspace.listChats(${JSON.stringify(folder.id)}, '');`,
    );
    assert.equal(remaining.length, 1);
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
