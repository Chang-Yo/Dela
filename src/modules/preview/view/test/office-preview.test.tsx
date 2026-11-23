// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';
import { OfficePreview } from '../OfficePreview';

const sheetXml = (text: string) =>
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  `<row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`;

function twoSheetWorkbook(): Promise<Buffer> {
  const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const parts: Record<string, string> = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${relNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${relNs}"><sheets>` +
      '<sheet name="甲" sheetId="1" r:id="rId1"/><sheet name="乙" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${relNs}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${relNs}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml('第一页'),
    'xl/worksheets/sheet2.xml': sheetXml('第二页'),
  };
  const zip = new ZipFile();
  for (const [name, xml] of Object.entries(parts)) zip.addBuffer(Buffer.from(xml), name);
  zip.end();
  return buffer(zip.outputStream);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('switches worksheets from the tab bar', async () => {
  const workbook = await twoSheetWorkbook();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(workbook))),
  );
  await act(async () => root.render(<OfficePreview url="dela-resource://book" kind="xlsx" />));
  const tabs = await vi.waitFor(() => {
    const found = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(found.map((tab) => tab.textContent)).toEqual(['甲', '乙']);
    return found;
  });
  expect(container.querySelector('.office-preview')!.textContent).toContain('第一页');

  await act(async () => tabs[1]!.click());
  await vi.waitFor(() =>
    expect(container.querySelector('.office-preview')!.textContent).toContain('第二页'),
  );
  expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
});
