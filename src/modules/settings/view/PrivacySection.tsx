import privacy from '../../../../../docs/privacy.md?raw';
import { LegalDocument } from './legal-doc';

/**
 * 正文即仓库的 docs/privacy.md（构建时 ?raw 内联），单一真源：改条款只改该文件，官网发布同一份文本。
 * 内容逐条陈述当前实现的数据事实，实现变化时必须同步核对。
 */
export function PrivacySection() {
  return <LegalDocument markdown={privacy} settingId="privacy" title="隐私条款" />;
}
