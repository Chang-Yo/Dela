import { beforeEach, describe, expect, it } from 'vitest';
import { notificationSources } from '../../../shared/api';
import { useNotificationSourceFilter } from './source-filter';

describe('notification source filter', () => {
  beforeEach(() => {
    useNotificationSourceFilter.setState({ sources: notificationSources });
  });

  it('keeps the selection in canonical source order as sources are toggled', () => {
    const { toggleSource } = useNotificationSourceFilter.getState();
    toggleSource('jwc');
    toggleSource('mail');
    expect(useNotificationSourceFilter.getState().sources).toEqual(['shuiyuan', 'todo', 'canvas']);
    toggleSource('jwc');
    expect(useNotificationSourceFilter.getState().sources).toEqual([
      'shuiyuan',
      'todo',
      'jwc',
      'canvas',
    ]);
  });

  it('never leaves the selection empty', () => {
    useNotificationSourceFilter.setState({ sources: ['todo'] });
    useNotificationSourceFilter.getState().toggleSource('todo');
    expect(useNotificationSourceFilter.getState().sources).toEqual(['todo']);
  });
});
