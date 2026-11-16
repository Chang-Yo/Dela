import terms from '../../../../docs/terms.md?raw';
import { LegalDocument } from './legal-doc';

/** 正文即 docs/terms.md（?raw 内联），官网发布同一份文本；开头引用块由 legal-doc 渲染成卡片。 */
export function TermsSection() {
  return <LegalDocument markdown={terms} settingId="terms" title="使用条款" />;
}
