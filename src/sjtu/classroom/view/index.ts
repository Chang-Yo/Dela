import { MonitorPlay } from 'lucide-react';
import { defineView } from '../../../app/module';
import { subscribe } from '../../../core/protocol/contract';
import { showToast } from '../../../renderer/app/toasts';
import { classroomContract } from '../contract';
import { ClassroomStorage } from './ClassroomStorage';
import { ClassroomView } from './ClassroomView';

export const classroomView = defineView({
  pages: {
    classroom: { component: ClassroomView, nav: { label: '课堂视频', icon: MonitorPlay } },
  },
  settings: { storage: ClassroomStorage },
  start() {
    subscribe(classroomContract, window.dela?.bridge, 'downloadEnded', ({ name, state }) =>
      showToast(
        state === 'completed'
          ? { variant: 'success', title: '下载完成', description: name }
          : { variant: 'error', title: '下载中断', description: `${name}，请重新下载` },
      ),
    );
  },
});
