import privacy from '../../../../../docs/privacy.md?raw';
import { LegalDocument } from './legal-doc';

/**
 * 设置 › 隐私条款：正文就是仓库里的 docs/privacy.md，构建时以 ?raw 内联。
 * 单一真源——改条款只改那个文件，官网发布同一份文本。
 * 内容是逐条陈述当前实现的数据事实（依据 src/main 的实际实现整理），不含承诺与营销表述；
 * 实现发生变化时必须同步核对文档里的每一条陈述。
 */
export function PrivacySection() {
  return <LegalDocument markdown={privacy} settingId="privacy" title="隐私条款" />;
}
