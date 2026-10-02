import { describe, expect, it } from 'vitest';
import {
  VOICE_PTT_ENABLED,
  SIDE_LIVE_CHAT_ENABLED,
  isSideLiveChatEnabled,
  isSideLiveChatHostAllowed,
  isMobileClient,
} from '../voiceConfig';

const PREVIEW_HOST = 'supercrib241-baba2--desktop-preview-wnxjhlfw.web.app';
const LIVE_HOST = 'supercrib241-baba2.web.app';
const LIVE_FIREBASEAPP = 'supercrib241-baba2.firebaseapp.com';

describe('voiceConfig flags', () => {
  it('keeps legacy table PTT off', () => {
    expect(VOICE_PTT_ENABLED).toBe(false);
  });

  it('enables side live chat compile flag', () => {
    expect(SIDE_LIVE_CHAT_ENABLED).toBe(true);
  });
});

describe('isMobileClient', () => {
  it('detects iPhone UA', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('detects Android phone UA (Mobile token)', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('detects Android tablet UA (no Mobile token) via touch', () => {
    expect(
      isMobileClient({
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X810) AppleWebKit/537.36 Safari/537.36',
        maxTouchPoints: 5,
        pointerCoarse: true,
        hoverNone: true,
      }),
    ).toBe(true);
  });

  it('detects classic iPad UA', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('detects iPadOS desktop-UA quirk (Macintosh + maxTouchPoints > 1)', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        maxTouchPoints: 5,
        pointerCoarse: true,
        hoverNone: true,
      }),
    ).toBe(true);
  });

  it('rejects desktop Chrome (fine pointer, no touch)', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        maxTouchPoints: 0,
        pointerCoarse: false,
        hoverNone: false,
      }),
    ).toBe(false);
  });

  it('rejects desktop Safari / Edge-like Mac without touch', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        maxTouchPoints: 0,
        pointerCoarse: false,
        hoverNone: false,
      }),
    ).toBe(false);
  });

  it('uses coarse pointer + hover:none + touch as generic mobile signal', () => {
    expect(
      isMobileClient({
        userAgent: 'SomeWeirdTablet/1.0',
        maxTouchPoints: 2,
        pointerCoarse: true,
        hoverNone: true,
      }),
    ).toBe(true);
  });

  it('does not treat desktop touchscreen (fine pointer + hover) as mobile', () => {
    expect(
      isMobileClient({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
        maxTouchPoints: 10,
        pointerCoarse: false,
        hoverNone: false,
      }),
    ).toBe(false);
  });
});

describe('isSideLiveChatHostAllowed', () => {
  it('allows preview, localhost, and live hosts', () => {
    expect(isSideLiveChatHostAllowed(PREVIEW_HOST)).toBe(true);
    expect(isSideLiveChatHostAllowed('localhost')).toBe(true);
    expect(isSideLiveChatHostAllowed('127.0.0.1')).toBe(true);
    expect(isSideLiveChatHostAllowed(LIVE_HOST)).toBe(true);
    expect(isSideLiveChatHostAllowed(LIVE_FIREBASEAPP)).toBe(true);
  });

  it('rejects unknown / empty hosts', () => {
    expect(isSideLiveChatHostAllowed(null)).toBe(false);
    expect(isSideLiveChatHostAllowed('')).toBe(false);
    expect(isSideLiveChatHostAllowed('evil.example.com')).toBe(false);
  });
});

describe('isSideLiveChatEnabled mobile gate', () => {
  it('enables on preview + mobile', () => {
    expect(isSideLiveChatEnabled(PREVIEW_HOST, true)).toBe(true);
  });

  it('enables on live + mobile', () => {
    expect(isSideLiveChatEnabled(LIVE_HOST, true)).toBe(true);
    expect(isSideLiveChatEnabled(LIVE_FIREBASEAPP, true)).toBe(true);
  });

  it('enables on localhost + mobile (dev testing)', () => {
    expect(isSideLiveChatEnabled('localhost', true)).toBe(true);
  });

  it('disables on preview + desktop', () => {
    expect(isSideLiveChatEnabled(PREVIEW_HOST, false)).toBe(false);
  });

  it('disables on live + desktop', () => {
    expect(isSideLiveChatEnabled(LIVE_HOST, false)).toBe(false);
    expect(isSideLiveChatEnabled(LIVE_FIREBASEAPP, false)).toBe(false);
  });

  it('disables on localhost + desktop', () => {
    expect(isSideLiveChatEnabled('localhost', false)).toBe(false);
  });

  it('rejects null / empty host even when mobile', () => {
    expect(isSideLiveChatEnabled(null, true)).toBe(false);
    expect(isSideLiveChatEnabled('', true)).toBe(false);
  });

  it('defaults mobile=false in node (no window) so accidental calls stay off', () => {
    // vitest environment is node — second arg omitted → false
    expect(isSideLiveChatEnabled(PREVIEW_HOST)).toBe(false);
    expect(isSideLiveChatEnabled(LIVE_HOST)).toBe(false);
  });
});
