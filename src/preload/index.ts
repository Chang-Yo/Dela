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
import { search } from './search';
import { session } from './session';
import { settings } from './settings';
import { sponsors } from './sponsors';
import { shuiyuan } from './shuiyuan';
import { timetable } from './timetable';
import { todo } from './todo';
import { terminal } from './terminal';
import { vsjtu } from './vsjtu';
import { windowApi } from './window';
import { workspace } from './workspace';

contextBridge.exposeInMainWorld('dela', {
  version,
  firstLaunch: process.argv.includes('--dela-first-launch'),
  todo,
  terminal,
  search,
  notifications,
  window: windowApi,
  settings,
  llm,
  chat,
  mail,
  timetable,
  shuiyuan,
  vsjtu,
  canvas,
  workspace,
  session,
  layout,
  sponsors,
  capability,
} satisfies DelaApi);
