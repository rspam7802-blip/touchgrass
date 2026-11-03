import { describe, expect, it } from 'vitest';
import { ROOMS } from '../socket';
import {
  ConversationListQuery,
  CreatePollBody,
  DeleteMessageQuery,
  EventSignal,
  MessagePageQuery,
  MuteBody,
  ReactBody,
  SendMessageBody,
  SystemMessage,
  UpsertIcebreakerBody,
  VoteBody,
} from './chat';

const MEDIA = '0192f3a4-5b6c-7d8e-9f01-000000000001';

describe('chat schemas (F-CHT-01..05)', () => {
  it('text needs a body, images need media; client ids are URL-safe', () => {
    expect(SendMessageBody.parse({ clientId: 'abcdefgh', body: ' hi ' })).toEqual({
      clientId: 'abcdefgh',
      kind: 'text',
      body: 'hi',
    });
    expect(SendMessageBody.safeParse({ clientId: 'abcdefgh', body: '   ' }).success).toBe(false);
    expect(SendMessageBody.safeParse({ clientId: 'abcdefgh', kind: 'image' }).success).toBe(false);
    expect(
      SendMessageBody.safeParse({ clientId: 'abcdefgh', kind: 'image', mediaId: MEDIA }).success,
    ).toBe(true);
    expect(SendMessageBody.safeParse({ clientId: 'short', body: 'hi' }).success).toBe(false);
    expect(SendMessageBody.safeParse({ clientId: 'has spaces!', body: 'hi' }).success).toBe(false);
  });

  it('applies list, page, mute, react and delete defaults and bounds', () => {
    expect(ConversationListQuery.parse({})).toEqual({ filter: 'all', limit: 30 });
    expect(ConversationListQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(MessagePageQuery.parse({ limit: '100' })).toEqual({ limit: 100 });
    expect(MuteBody.safeParse({ duration: 'month' }).success).toBe(false);
    expect(ReactBody.safeParse({ emoji: '🙌' }).success).toBe(true);
    expect(ReactBody.safeParse({ emoji: '💩' }).success).toBe(false);
    expect(DeleteMessageQuery.parse({})).toEqual({ scope: 'me' });
  });

  it('polls need 2–10 distinct options (case-insensitive)', () => {
    const base = { question: 'Chai or coffee?', options: ['Chai', 'Coffee'] };
    expect(CreatePollBody.parse(base)).toEqual({
      ...base,
      multi: false,
      anonymous: false,
      closesAt: null,
    });
    expect(CreatePollBody.safeParse({ ...base, options: ['Chai', 'chai'] }).success).toBe(false);
    expect(CreatePollBody.safeParse({ ...base, options: ['Chai'] }).success).toBe(false);
    expect(VoteBody.safeParse({ optionIds: [] }).success).toBe(true);
  });

  it('system messages are a closed set', () => {
    expect(SystemMessage.safeParse({ type: 'request_accepted' }).success).toBe(true);
    expect(SystemMessage.safeParse({ type: 'chat_opened', prompt: null }).success).toBe(true);
    expect(SystemMessage.safeParse({ type: 'custom', text: 'x' }).success).toBe(false);
  });
});

describe('at-the-plan schemas (F-ATE-01..02)', () => {
  it('icebreakers need all three languages', () => {
    const prompt = { en: 'Best biryani?', te: 'ఉత్తమ బిర్యానీ?', hi: 'सबसे अच्छी बिरयानी?' };
    expect(UpsertIcebreakerBody.parse({ prompt, category: 'local' }).active).toBe(true);
    expect(
      UpsertIcebreakerBody.safeParse({ prompt: { ...prompt, hi: '' }, category: 'local' }).success,
    ).toBe(false);
  });

  it('signals carry an upper-case hex colour and names for screen readers', () => {
    const signal = {
      color: '#1A5FD0',
      icon: '🌊',
      colorName: 'blue',
      iconName: 'wave',
      availableFrom: '2026-11-03T12:00:00.000Z',
    };
    expect(EventSignal.parse(signal)).toEqual(signal);
    expect(EventSignal.safeParse({ ...signal, color: 'blue' }).success).toBe(false);
  });

  it('room names are namespaced per kind', () => {
    expect(ROOMS.user('u1')).toBe('user:u1');
    expect(ROOMS.conversation('c1')).toBe('conv:c1');
    expect(ROOMS.event('e1')).toBe('event:e1');
  });
});
