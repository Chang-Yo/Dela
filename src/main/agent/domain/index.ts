// 过渡期的能力清单：各域迁入自己的模块后，改由模块定义声明。
import { registerCommandDomain } from '../../../core/capabilities/commands';
import {
  registerResourceResolver,
  type ResourceResolver,
} from '../../../core/capabilities/resources';
import { registerSessionScope } from '../../../core/agent/scopes';
import { coursesDirectory } from '../../canvas/api';
import { DOCUMENT_SKILL, documentDependency, verifyDocumentRuntime } from '../../documents/runtime';
import { prepareDocumentFile } from '../../resources';
import { registerDocumentReader } from '../../../core/capabilities/documents';
import { canvasDomain } from './canvas';
import { classroomDomain } from './classroom';
import { documentDomain } from './document';
import { mailDomain } from './mail';
import { builtinResourceResolvers, resourceDomain } from './read-resource';
import { shuiyuanDomain } from './shuiyuan';
import { timetableDomain } from './timetable';
import { todoDomain } from './todo';
import { workspaceDomain } from './workspace';

export function registerBuiltinCapabilities(): void {
  for (const domain of [
    resourceDomain,
    documentDomain,
    canvasDomain,
    classroomDomain,
    mailDomain,
    shuiyuanDomain,
    timetableDomain,
    todoDomain,
    workspaceDomain,
  ])
    registerCommandDomain(domain);
  for (const [type, resolver] of Object.entries(builtinResourceResolvers))
    registerResourceResolver(type, resolver as ResourceResolver);
  registerSessionScope({ id: 'library', directory: coursesDirectory });
  registerDocumentReader({
    skill: DOCUMENT_SKILL,
    dependency: documentDependency,
    verify: () => verifyDocumentRuntime(),
    prepare: prepareDocumentFile,
  });
}
