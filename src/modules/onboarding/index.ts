// 首启引导：条款接受与向导完成状态存在主进程，向导步骤由各模块视图定义登记。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { hasConsented, readSetting, writeSetting } from '../settings';
import { onboardingContract } from './contract';
import { installMagpiePlugin, magpiePluginStatus } from './main/magpie';

const completedKey = 'onboarding-completed';

export const onboardingModule = defineModule({
  id: 'onboarding',
  ipc: implement(onboardingContract, {
    state: () => ({ consented: hasConsented(), completed: readSetting(completedKey) === '1' }),
    complete: () => writeSetting(completedKey, '1'),
    installMagpiePlugin,
    magpiePluginStatus,
  }),
});
