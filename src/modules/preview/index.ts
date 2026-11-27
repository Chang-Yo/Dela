// 预览：Office 文件类型识别；预览界面在 view/。
import { defineModule } from '../../app/module';

export { classifyOfficeFile, officeZipMime } from './main/parse';

export const previewModule = defineModule({ id: 'preview' });
