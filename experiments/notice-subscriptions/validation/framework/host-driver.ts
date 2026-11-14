import { renderNoticePage } from '../../render';
import { analyzeNoticePage } from '../../parser';

const [url, electronPath, workerPath] = process.argv.slice(2);
if (!url || !electronPath || !workerPath) throw new Error('Missing host runtime arguments');

const page = await renderNoticePage(url, 8000, { electronPath, workerPath });
console.log(
  JSON.stringify({
    cwd: process.cwd(),
    charset: page.charset,
    ...analyzeNoticePage(page.body, page.url, { charset: page.charset }),
  }),
);
