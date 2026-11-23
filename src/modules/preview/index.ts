// 预览：Office 转 PDF 导出与文件类型识别；预览界面在 view/。
import { defineModule } from '../../app/module';

export { exportOfficePdf } from './main/export';
export { officeExportPreviewInfo, readOfficeExportLink } from './main/links';
export { classifyOfficeFile, officeZipMime } from './main/parse';

export const previewModule = defineModule({ id: 'preview' });
