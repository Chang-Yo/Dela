import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyzeNoticePage, extractNoticeEntries } from './parser';
import { fetchNoticePage } from './fetch';
import { renderNoticePage } from './render';
import { subscriptionStateSchema, updateSubscription } from './state';

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      render: { type: 'boolean' },
      sample: { type: 'string' },
      select: { type: 'string' },
      save: { type: 'string' },
      out: { type: 'string' },
      snapshot: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const [command, input] = positionals;
  if (values.help || !command) {
    console.log(
      'preview <URL> [--render | --file HTML] [--sample 标题] [--select 1 --save STATE.json] [--out RESULT.json] [--snapshot HTML]\nrefresh <STATE.json> [--file HTML] [--out RESULT.json] [--snapshot HTML]',
    );
    return;
  }
  if (!input || !['preview', 'refresh'].includes(command))
    throw new Error('请指定 preview <URL> 或 refresh <STATE.json>');
  const previous =
    command === 'refresh'
      ? subscriptionStateSchema.parse(JSON.parse(await readFile(input, 'utf8')))
      : null;
  if (values.render && (values.file || previous))
    throw new Error('--render 仅用于在线预览；刷新沿用已保存的加载模式');
  const acquisition = previous?.acquisition ?? (values.render ? 'rendered' : 'http');
  const url = previous?.rule.pageUrl ?? input;
  const page = values.file
    ? {
        url,
        body: await readFile(values.file),
        charset: undefined,
        fetchedAt: new Date().toISOString(),
      }
    : acquisition === 'rendered'
      ? await renderNoticePage(url)
      : await fetchNoticePage(url);
  if (values.snapshot) await writeFile(values.snapshot, page.body);
  let output: unknown;
  let refreshedState: string | undefined;
  if (previous) {
    const rule = { ...previous.rule, pageUrl: page.url };
    if (rule.pageUrl !== previous.rule.pageUrl)
      throw new Error('订阅地址发生重定向，请重新预览并确认');
    const entries = extractNoticeEntries(page.body, rule, page.charset);
    const update = updateSubscription(rule, entries, previous, page.fetchedAt);
    refreshedState = JSON.stringify(update.state, null, 2) + '\n';
    output = {
      url: page.url,
      checkedAt: page.fetchedAt,
      entries: entries.length,
      baseline: false,
      newEntries: update.newEntries,
    };
  } else {
    const analysis = analyzeNoticePage(page.body, page.url, {
      sampleTitle: values.sample,
      charset: page.charset,
    });
    if (acquisition === 'rendered' && !values.file) {
      analysis.diagnostics = analysis.diagnostics.filter(
        (message) => message !== '本次仅分析服务器 HTML，未执行页面 JavaScript',
      );
      analysis.diagnostics.push(
        '已执行页面 JavaScript；DOM 稳定为限时启发式，不保证所有异步内容加载完成',
      );
    }
    if (values.save) {
      const index = Number(values.select);
      if (!Number.isInteger(index) || index < 1 || !analysis.candidates[index - 1])
        throw new Error('保存前请用 --select 指定预览中候选的序号（从 1 开始）');
      const selected = analysis.candidates[index - 1]!;
      const entries = extractNoticeEntries(page.body, selected.rule, page.charset);
      const update = updateSubscription(selected.rule, entries, null, page.fetchedAt);
      await writeFile(
        values.save,
        JSON.stringify({ ...update.state, acquisition }, null, 2) + '\n',
      );
    }
    output = { fetchedAt: page.fetchedAt, acquisition, ...analysis };
  }
  const json = JSON.stringify(output, null, 2) + '\n';
  if (values.out) await writeFile(values.out, json);
  else
    await new Promise<void>((resolve, reject) => {
      process.stdout.once('error', reject);
      process.stdout.write(json, (error) => {
        if (error) reject(error);
        else {
          process.stdout.removeListener('error', reject);
          resolve();
        }
      });
    });
  if (refreshedState) await writeFile(input, refreshedState);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
