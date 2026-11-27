// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { followTopicLink, leaveTopic, openTopic, useShuiyuan } from '../store';

beforeEach(() => useShuiyuan.setState({ reading: null, trail: [] }));

it('returns through linked topics to the floor each link was clicked on, then to the feed', () => {
  openTopic(1);
  followTopicLink({ topicId: 1, postNumber: 7 }, 2, undefined);
  followTopicLink({ topicId: 2, postNumber: 3 }, 3, 12);
  expect(useShuiyuan.getState().reading).toEqual({ topicId: 3, postNumber: 12 });

  leaveTopic();
  expect(useShuiyuan.getState().reading).toEqual({ topicId: 2, postNumber: 3 });
  leaveTopic();
  expect(useShuiyuan.getState().reading).toEqual({ topicId: 1, postNumber: 7 });
  leaveTopic();
  expect(useShuiyuan.getState().reading).toBeNull();
});

it('starts a fresh trail when a topic is opened from a list', () => {
  openTopic(1);
  followTopicLink({ topicId: 1, postNumber: 7 }, 2, undefined);
  openTopic(5);
  leaveTopic();
  expect(useShuiyuan.getState().reading).toBeNull();
});
