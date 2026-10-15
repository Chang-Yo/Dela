import terms from '../../../../../docs/terms.md?raw';
import { LegalDocument } from './legal-doc';

/**
 * 设置 › 使用条款：正文就是仓库里的 docs/terms.md，构建时以 ?raw 内联。
 * 单一真源——改条款只改那个文件，官网发布同一份文本。
 * 开头的引用块是「安装或使用即接受」的声明，由 legal-doc 渲染成卡片。
 */
export function TermsSection() {
  return <LegalDocument markdown={terms} settingId="terms" title="使用条款" />;
}
