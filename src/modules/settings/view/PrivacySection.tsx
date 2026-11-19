import privacy from '../../../../docs/privacy.md?raw';
import { LegalDocument } from './legal-doc';

/** 正文即 docs/privacy.md（?raw 内联），官网发布同一份文本；实现变化时须同步核对。 */
export function PrivacySection() {
  return <LegalDocument markdown={privacy} settingId="privacy" title="隐私条款" />;
}
