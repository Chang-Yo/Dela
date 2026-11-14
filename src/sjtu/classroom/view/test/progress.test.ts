// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPlaybackProgress,
  readPlaybackProgress,
  resumePlaybackTime,
  savePlaybackProgress,
} from './progress';

beforeEach(() => localStorage.clear());

describe('playback progress', () => {
  it('saves whole seconds per video without mixing lectures', () => {
    savePlaybackProgress(11, 120.9);
    savePlaybackProgress(12, 30);
    expect(readPlaybackProgress(11)).toBe(120);
    expect(readPlaybackProgress(12)).toBe(30);
  });

  it('ignores missing, malformed and sub-second values', () => {
    expect(readPlaybackProgress(11)).toBeNull();
    localStorage.setItem('dela.classroom.progress.11', 'not-a-number');
    expect(readPlaybackProgress(11)).toBeNull();
    localStorage.setItem('dela.classroom.progress.11', '-5');
    expect(readPlaybackProgress(11)).toBeNull();
    savePlaybackProgress(11, 0.9);
    expect(readPlaybackProgress(11)).toBeNull();
  });

  it('clears only the requested video', () => {
    savePlaybackProgress(11, 120);
    savePlaybackProgress(12, 30);
    clearPlaybackProgress(11);
    expect(readPlaybackProgress(11)).toBeNull();
    expect(readPlaybackProgress(12)).toBe(30);
  });
});

describe('resumePlaybackTime', () => {
  it('returns a saved position before the end', () => {
    expect(resumePlaybackTime(120, 300)).toBe(120);
  });

  it('does not resume without a valid saved position or duration', () => {
    expect(resumePlaybackTime(null, 300)).toBeNull();
    expect(resumePlaybackTime(0, 300)).toBeNull();
    expect(resumePlaybackTime(120, 0)).toBeNull();
    expect(resumePlaybackTime(120, Number.NaN)).toBeNull();
  });

  it('treats the last second and out-of-range values as complete', () => {
    expect(resumePlaybackTime(299, 300)).toBeNull();
    expect(resumePlaybackTime(400, 300)).toBeNull();
    expect(resumePlaybackTime(298, 300)).toBe(298);
  });
});
