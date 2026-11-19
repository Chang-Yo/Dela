// 预览：PDF 与 Office 的文档读取组件、Office 转 PDF 导出；预览界面在 view/。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerDocumentReader } from '../../core/capabilities/documents';
import { prepareDocumentFile } from '../workspace';
import { documentDomain } from './main/agent';
import { DOCUMENT_SKILL, documentDependency, verifyDocumentRuntime } from './main/runtime';

export { exportOfficePdf } from './main/export';
export { officeExportPreviewInfo, readOfficeExportLink } from './main/links';
export { classifyOfficeFile, officeZipMime } from './main/parse';
export {
  DOCUMENT_SKILL,
  assertDocumentDependency,
  cancelDocumentInstallation,
  documentDependency,
  documentPython,
  documentRuntimeDirectory,
  installDocumentDependency,
} from './main/runtime';

export const previewModule = defineModule({
  id: 'preview',
  register() {
    registerCommandDomain(documentDomain);
    registerDocumentReader({
      skill: DOCUMENT_SKILL,
      dependency: documentDependency,
      verify: () => verifyDocumentRuntime(),
      prepare: prepareDocumentFile,
    });
  },
});
