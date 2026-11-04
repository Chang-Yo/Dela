import { app, BrowserWindow, ipcMain, nativeImage, protocol } from 'electron';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile, link } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  readShuiyuanSource,
  readShuiyuanSourcePreview,
  readShuiyuanSourcePage,
} from '../src/main/shuiyuan/sources';
import {
  encryptSnapshotBytes,
  writeSnapshotBytes,
  findShuiyuanSnapshot,
  handleShuiyuanSnapshotRequest,
} from '../src/main/shuiyuan/snapshot-files';
import { queueShuiyuanSnapshot } from '../src/main/shuiyuan/snapshot';
import { getDatabase } from '../src/main/database';
import { saveShuiyuanCredential } from '../src/main/credentials';

const profile = mkdtempSync(join(tmpdir(), 'dela-shuiyuan-perf-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('js-flags', '--expose-gc');
protocol.registerSchemesAsPrivileged([
  { scheme: 'dela-resource', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const label = process.argv[2] ?? 'after-warm';
const floors = Number(process.argv[3] ?? 3000);
const images = Number(process.argv[4] ?? 1000);
const pending = process.argv[5] === 'pending';
const active = process.argv[5] === 'active';
const scrolling = process.argv[5] === 'scroll';
const out = resolve('output/playwright/shuiyuan-perf');
let imageRequests = 0;
let ipcBytes = 0;
let readMs = 0;
let downloaded = 0;
let mainLagMs = 0;
let mainPeakHeapMiB = 0;
let lastTick = performance.now();
const mainSampler = setInterval(() => {
  const now = performance.now();
  mainLagMs = Math.max(mainLagMs, now - lastTick - 20);
  mainPeakHeapMiB = Math.max(mainPeakHeapMiB, process.memoryUsage().heapUsed / 1048576);
  lastTick = now;
}, 20);
const savedAt = '2026-11-04T00:00:00.000Z';
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;
const timeout = setTimeout(() => app.exit(2), 90000);
process.on('unhandledRejection', (error) => {
  console.error(error);
  app.exit(1);
});
app
  .whenReady()
  .then(async () => {
    await mkdir(out, { recursive: true });
    const dir = join(profile, 'shuiyuan-snapshots', pending || active ? '42.partial' : '42');
    await mkdir(dir, { recursive: true });
    let imageIndex = 0;
    const posts = Array.from({ length: floors }, (_, index) => {
      const count =
        Math.ceil(((index + 1) * images) / floors) - Math.ceil((index * images) / floors);
      const pictures = Array.from({ length: count }, () => {
        const id = (++imageIndex).toString(16).padStart(32, '0');
        return `<div class="lightbox-wrapper"><a class="lightbox"><img width="690" height="518" src="dela-resource://shuiyuan-snapshot/42/${id}.jpg"${pending ? ' data-snapshot-pending' : ''}></a></div>`;
      }).join('');
      return {
        postNumber: index + 1,
        username: `reader${index % 100}`,
        createdAt: savedAt,
        replyToPostNumber: null,
        cooked: `<p>第 ${index + 1} 楼。${'这是用于测量快照加载的合成正文，包含引用与图片。'.repeat(10)}</p><blockquote>引用前面的讨论内容。</blockquote>${pictures}`,
      };
    });
    // Pending images must retain remote URLs to exercise the actual placeholder branch.
    if (pending || active)
      for (const post of posts)
        post.cooked = post.cooked.replaceAll(
          'dela-resource://shuiyuan-snapshot/42/',
          active ? 'https://fixture.invalid/images/' : 'https://shuiyuan.sjtu.edu.cn/uploads/',
        );
    const json = JSON.stringify({ title: `${floors} 楼 / ${images} 张大图`, savedAt, posts });
    if (!active) {
      await writeSnapshotBytes(
        join(dir, 'index.json'),
        JSON.stringify({
          title: `${floors} 楼 / ${images} 张大图`,
          savedAt,
          postCount: posts.length,
          pageSize: 10,
        }),
      );
      for (let start = 0; start < posts.length; start += 10)
        await writeSnapshotBytes(
          join(dir, `page-${start / 10}.json`),
          JSON.stringify(posts.slice(start, start + 10)),
        );
    }
    const pixels = Buffer.alloc(4000 * 3000 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = (i / 4) % 251;
      pixels[i + 1] = (i / 4000) % 251;
      pixels[i + 2] = 120;
      pixels[i + 3] = 255;
    }
    const jpeg = nativeImage.createFromBitmap(pixels, { width: 4000, height: 3000 }).toJPEG(85);
    if (active) {
      saveShuiyuanCredential({
        key: 'synthetic',
        clientId: 'benchmark',
        username: 'benchmark',
        boundAt: savedAt,
      });
      getDatabase()
        .prepare('INSERT INTO shuiyuan_topics(topic_id,title,url,added_at) VALUES(42,?,?,?)')
        .run('性能基准', 'https://fixture.invalid', savedAt);
      await writeFile(
        join(dir, 'posts.ndjson'),
        posts
          .map((p, i) =>
            encryptSnapshotBytes(JSON.stringify({ ...p, id: i + 1 })).toString('base64'),
          )
          .join('\n') + '\n',
      );
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('/t/42.json'))
          return Response.json({
            id: 42,
            title: '性能基准',
            post_stream: { stream: posts.map((_, i) => i + 1), posts: [] },
          });
        assert(url.startsWith('https://fixture.invalid/images/'), 'No real network requests');
        await new Promise((resolve) => setTimeout(resolve, 50));
        downloaded++;
        return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
      };
      collect();
      mainLagMs = 0;
      mainPeakHeapMiB = process.memoryUsage().heapUsed / 1048576;
      lastTick = performance.now();
      queueShuiyuanSnapshot(42);
      while (!(await findShuiyuanSnapshot(42)))
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!active && !pending) {
      await mkdir(join(dir, 'images'), { recursive: true });
      const original = join(dir, 'image.jpg');
      await writeSnapshotBytes(original, jpeg);
      for (let index = 1; index <= images; index++)
        await link(original, join(dir, 'images', `${index.toString(16).padStart(32, '0')}.jpg`));
    }
    protocol.handle('dela-resource', (request) => {
      imageRequests++;
      return handleShuiyuanSnapshotRequest(new URL(request.url));
    });
    const preload = join(profile, 'preload.cjs');
    await writeFile(
      preload,
      `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('benchmark',{read:()=>ipcRenderer.invoke('bench:read'),report:v=>ipcRenderer.send('bench:report',v)});contextBridge.exposeInMainWorld('dela',{workspace:{onOfficeExportProgress:()=>()=>{}},shuiyuan:{getSourceRef:async()=>({title:'性能基准',author:'benchmark',postsCount:${floors},snapshot:null}),readSnapshotPage:(...a)=>ipcRenderer.invoke('bench:page',...a),onSnapshot:()=>()=>{},openInBrowser:async()=>{} }});`,
    );
    ipcMain.handle('bench:read', async () => {
      const start = performance.now();
      const content = await (label.startsWith('before')
        ? readShuiyuanSource(42)
        : readShuiyuanSourcePreview(42));
      readMs += performance.now() - start;
      ipcBytes += Buffer.byteLength(JSON.stringify(content));
      return content;
    });
    ipcMain.handle('bench:page', async (_event, topicId, page) => {
      const start = performance.now();
      const html = await readShuiyuanSourcePage(topicId, page);
      readMs += performance.now() - start;
      ipcBytes += Buffer.byteLength(html);
      return html;
    });
    const window = new BrowserWindow({
      show: true,
      width: 1280,
      height: 900,
      webPreferences: { preload, backgroundThrottling: false },
    });
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message);
    });
    window.webContents.debugger.attach('1.3');
    ipcMain.once('bench:report', async (_event, result) => {
      const measuredMainLag = mainLagMs;
      collect();
      const retainedHeapMiB = process.memoryUsage().heapUsed / 1048576;
      const dom = await window.webContents.debugger.sendCommand('Memory.getDOMCounters');
      const memory = app
        .getAppMetrics()
        .filter((m) => m.type === 'Tab')
        .map((m) => m.memory);
      const report = {
        label,
        floors,
        images,
        pending,
        imageDimensions: '4000x3000',
        jpegBytes: jpeg.length,
        snapshotBytes: Buffer.byteLength(json),
        readMs,
        ipcBytes,
        imageRequests,
        ...result,
        dom,
        rendererMemory: memory,
        active,
        mainPeakHeapMiB,
        mainLagMs: measuredMainLag,
        retainedHeapMiB,
        downloaded,
      };
      if (scrolling) {
        await window.webContents.executeJavaScript(
          `window.scrollProbe={gaps:[],last:performance.now()};window.scrollProbe.tick=function(t){scrollProbe.gaps.push(t-scrollProbe.last);scrollProbe.last=t;scrollProbe.frame=requestAnimationFrame(scrollProbe.tick)};scrollProbe.frame=requestAnimationFrame(scrollProbe.tick)`,
        );
        let peakRendererMiB = 0;
        let peakGpuMiB = 0;
        let maxResidentImages = 0;
        for (let step = 0; step < 480; step++) {
          await window.webContents.executeJavaScript(
            `document.querySelector('.overflow-y-auto').scrollTop += 650`,
          );
          await new Promise((resolve) => setTimeout(resolve, 70));
          if (step % 10 === 0) {
            const metrics = app.getAppMetrics();
            peakRendererMiB = Math.max(
              peakRendererMiB,
              metrics
                .filter((m) => m.type === 'Tab')
                .reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024,
            );
            peakGpuMiB = Math.max(
              peakGpuMiB,
              ...metrics.filter((m) => m.type === 'GPU').map((m) => m.memory.workingSetSize / 1024),
            );
            const counts = await Promise.all(
              window.webContents.mainFrame.frames.map((f) =>
                f.executeJavaScript(`document.querySelectorAll('img[src]').length`).catch(() => 0),
              ),
            );
            maxResidentImages = Math.max(
              maxResidentImages,
              counts.reduce((a, b) => a + b, 0),
            );
          }
        }
        await window.webContents.executeJavaScript(
          `document.querySelector('.overflow-y-auto').scrollTop=0`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        const gaps = await window.webContents.executeJavaScript(
          `cancelAnimationFrame(scrollProbe.frame);scrollProbe.gaps.sort((a,b)=>a-b)`,
        );
        Object.assign(report, {
          scroll: {
            imageRequests,
            maxResidentImages,
            peakRendererMiB,
            peakGpuMiB,
            maxFrameGap: Math.max(...gaps),
            p95FrameGap: gaps[Math.floor(gaps.length * 0.95)],
          },
        });
      }
      await writeFile(
        join(out, `${label}-${floors}-${images}-${pending ? 'pending' : 'cached'}.json`),
        JSON.stringify(report, null, 2),
      );
      await writeFile(
        join(out, `${label}-${floors}-${images}.png`),
        (await window.capturePage()).toPNG(),
      );
      console.log(JSON.stringify(report));
      if (label.includes('check')) {
        for (const width of [600, 900, 1280, 1920]) {
          window.setSize(width, 900);
          await new Promise((resolve) => setTimeout(resolve, 250));
          await window.webContents.executeJavaScript(
            `document.querySelector('.overflow-y-auto').scrollTop = 100000000`,
          );
          await new Promise((resolve) => setTimeout(resolve, 800));
          const endTexts = await Promise.all(
            window.webContents.mainFrame.frames.map((frame) =>
              frame.executeJavaScript('document.body.textContent'),
            ),
          );
          console.log(
            'Scroll check',
            width,
            await window.webContents.executeJavaScript(
              `JSON.stringify({rows:[...document.querySelectorAll('[data-index]')].map(e=>e.dataset.index),top:document.querySelector('.overflow-y-auto').scrollTop,height:document.querySelector('.overflow-y-auto').scrollHeight})`,
            ),
            endTexts.map((text) => text.slice(-90)),
          );
          assert(
            endTexts.some((text) => text.includes('第 ' + floors + ' 楼')),
            'Last floor must remain reachable',
          );
          assert(
            window.webContents.mainFrame.frames.length <= 5,
            'Only nearby pages should stay mounted',
          );
          await window.webContents.executeJavaScript(
            `document.querySelector('.overflow-y-auto').scrollTop = 0`,
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          const startTexts = await Promise.all(
            window.webContents.mainFrame.frames.map((frame) =>
              frame.executeJavaScript('document.body.textContent'),
            ),
          );
          assert(
            startTexts.some((text) => text.includes('第 1 楼')),
            'First floor must remount',
          );
          const overflow = await window.webContents.executeJavaScript(
            `document.documentElement.scrollWidth > innerWidth`,
          );
          assert(!overflow, 'No horizontal overflow');
          await writeFile(join(out, `check-${width}.png`), (await window.capturePage()).toPNG());
        }
        const frame = window.webContents.mainFrame.frames[0]!;
        if (!pending) {
          const dimensions = await frame.executeJavaScript(
            `(()=>{const m=document.querySelector('img[src]');return {width:m.naturalWidth,height:m.naturalHeight,src:m.src}})()`,
          );
          assert(dimensions.width > 0, 'Visible image must finish loading');
          if (!label.startsWith('before') && !label.startsWith('stage2-before')) {
            assert(dimensions.src.includes('thumbnail=1'));
            assert(Math.max(dimensions.width, dimensions.height) <= 960);
          }
          await frame.executeJavaScript(`document.querySelector('a.lightbox img').click()`);
          await new Promise((resolve) => setTimeout(resolve, 150));
          assert(
            await window.webContents.executeJavaScript(
              `!!document.querySelector('[aria-label="图片查看"]')`,
            ),
          );
          assert(
            await window.webContents.executeJavaScript(
              `!document.querySelector('[aria-label="图片查看"] img').src.includes('thumbnail=1')`,
            ),
            'Lightbox must request the original image',
          );
        }
        console.log(
          'Scroll to last floor, return to first floor, responsive widths, bounded frames and lightbox: passed',
        );
      }
      clearTimeout(timeout);
      clearInterval(mainSampler);
      app.exit(0);
    });
    await window.loadFile(
      resolve(
        `.tools/shuiyuan-perf/${label.startsWith('stage2-before') ? 'stage2/view' : label.startsWith('before') ? 'view-before' : 'view'}/.tools/shuiyuan-perf/input/index.html`,
      ),
    );
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
