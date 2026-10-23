// Explicit online smoke: installs into a temporary profile, never the user's component directory.
import { app } from 'electron';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeDatabase } from '../src/main/database';
import { listSkills, setSkillEnabled } from '../src/main/agent/skills';
import {
  documentDependency,
  documentPython,
  documentRuntimeDirectory,
  installDocumentDependency,
} from '../src/main/documents/runtime';
import { prepareDocumentFile, releaseDocumentResource } from '../src/main/resources';

const exec = promisify(execFile);
const profile = mkdtempSync(join(tmpdir(), 'dela-document-中文 '));
for (const name of ['userData', 'home', 'documents', 'temp'] as const) app.setPath(name, profile);
const timeout = setTimeout(() => app.exit(1), 540000);

app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    assert.equal(process.platform, 'darwin');
    assert.equal(process.arch, 'arm64');
    assert.equal(documentDependency().status, 'missing');
    const document = (await listSkills()).find((s) => s.name === 'document-reading');
    assert.equal(document?.enabled, false);
    console.log('Installing document component in an isolated temporary profile…');
    await installDocumentDependency();
    assert.equal(documentDependency().status, 'ready');
    const skills = await setSkillEnabled(document!.id, true);
    assert.equal(skills.find((s) => s.name === 'document-reading')?.enabled, true);
    assert.match(
      await readFile(join(documentRuntimeDirectory(), 'THIRD-PARTY-NOTICES.txt'), 'utf8'),
      /MarkItDown/,
    );
    const fixtures = join(profile, 'fixtures 中文');
    await mkdir(fixtures);
    const generator = join(fixtures, 'generate.py');
    await writeFile(
      generator,
      `from pathlib import Path
from zipfile import ZipFile
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches
from PIL import Image
root=Path(__file__).parent
with ZipFile(root/'sample.docx','w') as archive:
    archive.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    archive.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    archive.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dela 文档读取 smoke</w:t></w:r></w:p></w:body></w:document>')
book=Workbook()
book.active.append(['Dela 文档读取 smoke',42])
book.save(root/'sample.xlsx')
deck=Presentation()
slide=deck.slides.add_slide(deck.slide_layouts[6])
slide.shapes.add_textbox(Inches(1),Inches(1),Inches(6),Inches(1)).text='Dela 文档读取 smoke'
deck.save(root/'sample.pptx')
Image.new('RGB',(100,100),'navy').save(root/'sample.pdf')
`,
    );
    const options = {
      cwd: tmpdir(),
      env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
      timeout: 120000,
    };
    await exec(documentPython(), ['-I', generator], options);
    for (const extension of ['docx', 'xlsx', 'pptx', 'pdf']) {
      const job = await prepareDocumentFile((input) =>
        copyFile(join(fixtures, `sample.${extension}`), input),
      );
      try {
        const { stdout } = await exec(
          job.python,
          ['-I', job.script, job.input, '--output', job.output],
          options,
        );
        const result = JSON.parse(stdout);
        if (extension === 'pdf') {
          assert.equal(result.status, 'needs_visual_read');
          assert.equal(result.images.length, 1);
          assert.ok((await readFile(result.images[0].path)).length > 0);
        } else {
          assert.equal(result.status, 'extracted');
          assert.match(await readFile(result.content, 'utf8'), /Dela 文档读取 smoke/);
        }
      } finally {
        await releaseDocumentResource(job.jobId);
      }
      await assert.rejects(readFile(job.input), { code: 'ENOENT' });
      console.log(`${extension}: prepare → shared Python reader → release passed`);
    }
    console.log(
      'Document runtime smoke passed: official install, skill enable, DOCX/XLSX/PPTX/PDF, system PATH, cleanup.',
    );
    exitCode = 0;
  } catch (error) {
    console.error(error);
  } finally {
    clearTimeout(timeout);
    closeDatabase();
    await rm(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
