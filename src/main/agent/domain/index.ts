// 过渡期的通用能力清单：交大的命令域由 src/sjtu 各模块在 register() 中登记。
import { registerCommandDomain } from '../../../core/capabilities/commands';
import {
  registerResourceResolver,
  type ResourceResolver,
} from '../../../core/capabilities/resources';
import { DOCUMENT_SKILL, documentDependency, verifyDocumentRuntime } from '../../documents/runtime';
import { prepareDocumentFile } from '../../resources';
import { registerDocumentReader } from '../../../core/capabilities/documents';
import { documentDomain } from './document';
import { builtinResourceResolvers, resourceDomain } from './read-resource';

export function registerBuiltinCapabilities(): void {
  for (const domain of [resourceDomain, documentDomain]) registerCommandDomain(domain);
  for (const [type, resolver] of Object.entries(builtinResourceResolvers))
    registerResourceResolver(type, resolver as ResourceResolver);
  registerDocumentReader({
    skill: DOCUMENT_SKILL,
    dependency: documentDependency,
    verify: () => verifyDocumentRuntime(),
    prepare: prepareDocumentFile,
  });
}
