import { contextBridge } from 'electron';
import { version } from '../../package.json';
import type { DelaApi } from '../shared/api';
import { canvas } from './canvas';
import { chat } from './chat';
import { llm } from './llm';
import { capabilityApi as capability } from './capabilities';
import { layout } from './layout';
import { mail } from './mail';
import { notifications } from './notifications';
import { remotes } from './remotes';
import { search } from './search';
import { session } from './session';
import { settings } from './settings';
import { shuiyuan } from './shuiyuan';
import { timetable } from './timetable';
import { todo } from './todo';
import { terminal } from './terminal';
import { windowApi } from './window';
import { workspace } from './workspace';

contextBridge.exposeInMainWorld('dela', {
  version,
  firstLaunch: process.argv.includes('--dela-first-launch'),
  todo,
  terminal,
  remotes,
  search,
  notifications,
  window: windowApi,
  settings,
  llm,
  chat,
  mail,
  timetable,
  shuiyuan,
  canvas,
  workspace,
  session,
  layout,
  capability,
} satisfies DelaApi);
