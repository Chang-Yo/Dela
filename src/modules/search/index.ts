// 全局搜索：数据来源由各模块注册，本模块只汇总、分组并提供搜索弹窗。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { searchContract } from './contract';
import { querySearch } from './main/registry';

export { likePattern, registerSearchProvider, type SearchProvider } from './main/registry';

export const searchModule = defineModule({
  id: 'search',
  ipc: implement(searchContract, { query: querySearch }),
});
