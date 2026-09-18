// Isolated renderer fixture; no account, credentials or personal files.
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const { join, resolve } = require('node:path');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { deflateSync } = require('node:zlib');
const assert = require('node:assert/strict');
const root = resolve(process.argv[2] || '.');
const profile = mkdtempSync(join(tmpdir(), 'dela-pdf-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dela-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function fixture() {
  const objects = [];
  const add = (value) => {
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    return objects.length;
  };
  const stream = (dictionary, bytes) =>
    Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
      bytes,
      Buffer.from('\nendstream'),
    ]);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pixels = Buffer.alloc(2048 * 2048 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 17 + (i >> 12)) % 256;
  const image = add(
    stream(
      '/Type /XObject /Subtype /Image /Width 2048 /Height 2048 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode',
      deflateSync(pixels),
    ),
  );
  // Tiny JPEG2000 swatch exercises the bundled OpenJPEG WASM decoder.
  const jpx = add(
    stream(
      '/Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode',
      Buffer.from(
        'AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAIAAAACAAAwcHAAAAAAAPY29scgEAAAAAABAAAACyanAyY/9P/1EALwAAAAAAIAAAACAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAUEBAAB/1wAE0BASEhQSEhQSEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS4y/5AACgAAAAAAKwAB/5PB8gEHx9QEAb/PtAgAJ4CAgICAgICAgICAgICAgP/Z',
        'base64',
      ),
    ),
  );
  const pages = [];
  for (let page = 1; page <= 300; page++) {
    const content = add(
      stream(
        '',
        Buffer.from(
          `q 500 0 0 400 40 200 cm /Im Do Q q 32 0 0 32 40 650 cm /Jx Do Q BT /F1 24 Tf 40 740 Td (Lecture page ${page}) Tj ET`,
        ),
      ),
    );
    pages.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page % 7 ? '600 800' : '800 600'}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im ${image} 0 R /Jx ${jpx} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count 300 /Kids [${pages.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );
  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}
const pdf = fixture();
const canvas = {
  connected: true,
  syncedAt: null,
  courses: [
    { id: 1, name: '计算机视觉', term: '2026 秋季', syncedAt: '2026-09-14' },
    { id: 2, name: '未分类课程', term: '未标注学期' },
  ],
  items: [1, 2].map((id) => ({
    id: `file:${id}`,
    courseId: 1,
    parentId: null,
    sourceId: `file:${id}`,
    name: `Lecture ${id}.pdf`,
    kind: 'file',
  })),
};
const workspace = {
  entries: [],
  directory: '',
  views: {
    sources: { tabs: [], active: null, expanded: ['term:2026 秋季', 'course:1'], scroll: {} },
  },
};
let ranges = 0;
let failRange = false;
const routes = {
  'workspace:get-state': () => workspace,
  'canvas:get-state': () => canvas,
  'workspace:save-view': (_, scope, view) => {
    workspace.views[scope] = view;
  },
  'canvas:read': (_, id) => ({
    title: id,
    format: 'pdf',
    mime: 'application/pdf',
    previewUrl: `dela-resource://canvas/${id}`,
  }),
  'window:get-state': () => ({ maximized: false }),
  'settings:get-theme': () => 'light',
  'settings:get-zoom': () => 1,
  'settings:get-font-scale': () => 1,
  'workspace:get-chat': () => ({
    messages: [],
    running: false,
    configured: false,
    models: [],
    model: '',
  }),
  'llm:list': () => ({ providers: [], activeId: null }),
};
for (const [name, handler] of Object.entries(routes)) ipcMain.handle(name, handler);
app
  .whenReady()
  .then(async () => {
    protocol.handle('dela-resource', async (request) => {
      await new Promise((r) => setTimeout(r, 30));
      const range = request.headers.get('range')?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range
        ? Math.min(Number(range[2] || pdf.length - 1), pdf.length - 1)
        : pdf.length - 1;
      if (range) ranges++;
      const headers = {
        'content-type': 'application/pdf',
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        'access-control-allow-origin': 'null',
        'access-control-expose-headers': 'Accept-Ranges, Content-Length, Content-Range',
      };
      if (failRange && start > 0) return new Response(null, { status: 503, headers });
      if (range) headers['content-range'] = `bytes ${start}-${end}/${pdf.length}`;
      return new Response(pdf.subarray(start, end + 1), { status: range ? 206 : 200, headers });
    });
    const win = new BrowserWindow({
      width: 1440,
      height: 960,
      show: false,
      webPreferences: {
        preload: join(root, 'out/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    win.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') errors.push(event.message);
    });
    const evaluate = (code) => win.webContents.executeJavaScript(code, true);
    const wait = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(code)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(
        `Timed out: ${code}\n${errors.join('\n')}\n${await evaluate('document.body.innerText')}`,
      );
    };
    const click = (text) =>
      evaluate(
        `[...document.querySelectorAll('button')].findLast(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`,
      );
    await win.loadFile(join(root, 'out/renderer/index.html'), { query: { 'smoke-test': '1' } });
    await wait(
      "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '资料')",
    );
    await click('资料');
    await evaluate(
      `const style = document.createElement('style'); style.textContent = '* { transition: none !important; animation: none !important; }'; document.head.append(style);`,
    );
    await wait('document.querySelector(\'[role=treeitem][aria-label="Lecture 1.pdf"]\')');
    assert.equal(await evaluate("document.body.innerText.includes('未标注学期')"), false);
    await click('归档');
    await wait("document.body.innerText.includes('未标注学期')");
    await click('归档');
    const open = (n) =>
      evaluate(`document.querySelector('[role=treeitem][aria-label="Lecture ${n}.pdf"]').click()`);
    await open(1);
    await wait("document.querySelector('.textLayer')?.textContent.includes('Lecture page 1')");
    assert.equal(await evaluate("document.querySelectorAll('iframe').length"), 0);
    await evaluate(
      "document.querySelector('.textLayer').closest('.overflow-auto').scrollTop = 150000",
    );
    await wait(
      "Number(document.querySelector('[aria-label=\"PDF 页码\"]').value) > 50 && document.querySelector('.textLayer')?.textContent",
    );
    const page = await evaluate('document.querySelector(\'[aria-label="PDF 页码"]\').value');
    const count = await evaluate("document.querySelectorAll('canvas').length");
    assert.ok(count <= 10, `Too many canvases: ${count}`);
    await open(2);
    await wait(
      "document.querySelectorAll('[role=tab]').length === 2 && document.querySelector('.textLayer')?.textContent.includes('Lecture page 1')",
    );
    await click('Lecture 1.pdf');
    await wait(
      `document.querySelector('[aria-label="PDF 页码"]').value === ${JSON.stringify(page)} && document.querySelector('.textLayer')?.textContent`,
    );
    // Exercise cancellation while old requests and Worker setup are pending.
    for (let i = 0; i < 20; i++) {
      await open((i % 2) + 1);
      await new Promise((r) => setTimeout(r, 10));
    }
    await open(1);
    await wait(
      `document.querySelector('.textLayer')?.textContent && document.querySelector('[aria-label="PDF 页码"]').value === ${JSON.stringify(page)}`,
    );
    assert.equal(await evaluate("document.body.innerText.includes('PDF 打开失败')"), false);
    assert.equal(
      await evaluate(
        `(() => { const h = document.querySelector('.textLayer').closest('.overflow-auto'); return h.scrollWidth - h.clientWidth; })()`,
      ),
      0,
    );
    // Count visible frames, not just canvas nodes: a blank replacement used to
    // pass the old resource/position checks while flashing on screen.
    await wait(`(() => {
      const row = document.querySelector('[data-page-number="${page}"]');
      return [...row.querySelectorAll('canvas')].some(c => c.width && getComputedStyle(c).visibility === 'visible' && !c.hidden);
    })()`);
    await evaluate(`(() => {
      const row = document.querySelector('[data-page-number="${page}"]');
      window.pdfStableCanvas = [...row.querySelectorAll('canvas')].find(c => getComputedStyle(c).visibility === 'visible' && !c.hidden);
      window.pdfBlankFrames = 0;
      window.pdfBlankDetails = [];
      window.pdfObservedFrames = 0;
      const check = () => {
        window.pdfObservedFrames++;
        if (![...row.querySelectorAll('canvas')].some(c => c.width && getComputedStyle(c).visibility === 'visible' && !c.hidden)) { window.pdfBlankFrames++; window.pdfBlankDetails.push({ connected: row.isConnected, html: row.innerHTML.slice(0, 600) }); }
      };
      window.pdfObserver = new MutationObserver(check);
      window.pdfObserver.observe(row, { childList: true, subtree: true, attributes: true });
      window.pdfSampleTimer = setInterval(check, 16);
      check();
    })()`);
    await evaluate(
      `(() => { const h = document.querySelector('.textLayer').closest('.overflow-auto'); window.pdfScrollBefore = h.scrollTop; h.scrollTop += h.clientHeight / 2; })()`,
    );
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(
      await evaluate('window.pdfStableCanvas.isConnected && window.pdfStableCanvas.width > 0'),
      'Scrolling invalidated a retained canvas',
    );
    await evaluate(
      "document.querySelector('.textLayer').closest('.overflow-auto').scrollTop = window.pdfScrollBefore",
    );
    // Native trackpad pinch is represented by ctrl+wheel in Chromium.
    const anchor = await evaluate(`(() => {
      const h = document.querySelector('.textLayer').closest('.overflow-auto');
      const box = h.getBoundingClientRect();
      const page = document.querySelector('[data-page-number="${page}"]');
      const bounds = page.getBoundingClientRect();
      const x = h.clientWidth / 2, y = h.clientHeight / 2;
      const position = { vertical: (box.top + y - bounds.top) / bounds.height, horizontal: (box.left + x - bounds.left) / bounds.width };
      const e = new WheelEvent('wheel', { ctrlKey: true, deltaY: -20, clientX: box.left + x, clientY: box.top + y, bubbles: true, cancelable: true });
      h.dispatchEvent(e);
      return { ...position, prevented: e.defaultPrevented };
    })()`);
    assert.equal(anchor.prevented, true);
    await wait("parseInt(document.querySelector('[title=适合宽度]').textContent) > 100");
    await wait('!window.pdfStableCanvas.isConnected');
    assert.equal(
      await evaluate('window.pdfBlankFrames'),
      0,
      JSON.stringify(await evaluate('window.pdfBlankDetails')),
    );
    assert.ok(await evaluate('window.pdfObservedFrames >= 3'), 'Canvas observer did not run');
    await evaluate('window.pdfObserver.disconnect(); clearInterval(window.pdfSampleTimer)');
    const after = await evaluate(`(() => {
      const h = document.querySelector('.textLayer').closest('.overflow-auto');
      const box = h.getBoundingClientRect(), p = document.querySelector('[data-page-number="${page}"]').getBoundingClientRect();
      return { vertical: (box.top + h.clientHeight / 2 - p.top) / p.height, horizontal: (box.left + h.clientWidth / 2 - p.left) / p.width };
    })()`);
    assert.ok(Math.abs(after.vertical - anchor.vertical) < 0.02, JSON.stringify({ anchor, after }));
    assert.ok(
      Math.abs(after.horizontal - anchor.horizontal) < 0.01,
      JSON.stringify({ anchor, after }),
    );
    // Return to fit width, then pan sideways: there should be no tiny overflow.
    await evaluate("document.querySelector('[title=适合宽度]').click()");
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(
      await evaluate(
        `(() => { const h = document.querySelector('.textLayer').closest('.overflow-auto'); h.scrollLeft = 10; return h.scrollLeft; })()`,
      ),
      0,
    );
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 3,
      mobile: false,
    });
    await evaluate('document.querySelector(\'[aria-label="放大 PDF"]\').click()');
    // Allow the official 400ms delayed redraw to start before testing its result.
    await new Promise((r) => setTimeout(r, 450));
    await wait("[...document.querySelectorAll('canvas')].some(c => c.width > 0)");
    assert.ok(
      await evaluate(
        "[...document.querySelectorAll('canvas')].every(c => c.width * c.height <= 4 * 1024 * 1024)",
      ),
    );
    await wait(
      `document.querySelector('[aria-label="PDF 页码"]').value === ${JSON.stringify(page)}`,
    );
    await wait(
      `document.querySelector('[data-page-number="${page}"]:not(.loading) .textLayer')?.textContent`,
    );
    writeFileSync(join(profile, 'wide.png'), (await win.webContents.capturePage()).toPNG());
    for (const width of [900, 600]) {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 400));
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      assert.equal(await evaluate(`document.querySelector('[aria-label="PDF 页码"]').value`), page);
      await wait(
        `document.querySelector('[data-page-number="${page}"]:not(.loading) .textLayer')?.textContent`,
      );
      writeFileSync(join(profile, `${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    failRange = true;
    await open(2);
    await wait("document.body.innerText.includes('PDF 分段读取失败')");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await evaluate("document.body.innerText.includes('AbortError')"), false);
    failRange = false;
    await click('重试');
    await wait("document.querySelector('.textLayer')?.textContent.includes('Lecture page 1')");
    assert.ok(ranges > 0, 'PDF must use range requests');
    assert.deepEqual(
      errors.filter((message) => !message.includes('503')),
      [],
    );
    console.log(
      JSON.stringify({
        result: 'passed',
        page,
        canvases: count,
        ranges,
        screenshots: profile,
        errors,
      }),
    );
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
