import { describe, expect, it, vi } from 'vitest';
import {
  attachRemoteStreamToAudio,
  configureRemoteAudioElement,
  shouldRetryRemoteVoicePlay,
} from '../remoteVoicePlayback';

describe('remoteVoicePlayback', () => {
  it('configures an audible inline autoplay sink', () => {
    const attrs = new Map<string, string>();
    const el = {
      autoplay: false,
      defaultMuted: true,
      muted: true,
      volume: 0,
      setAttribute: vi.fn((key: string, value: string) => attrs.set(key, value)),
    } as unknown as HTMLAudioElement;

    configureRemoteAudioElement(el);

    expect(el.autoplay).toBe(true);
    expect(el.defaultMuted).toBe(false);
    expect(el.muted).toBe(false);
    expect(el.volume).toBe(1);
    expect((el as HTMLAudioElement & { playsInline?: boolean }).playsInline).toBe(true);
    expect(attrs.get('playsinline')).toBe('true');
    expect(attrs.get('webkit-playsinline')).toBe('true');
  });

  it('attaches the remote stream and never leaves received tracks disabled', () => {
    const track = { enabled: false };
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const el = {
      autoplay: false,
      defaultMuted: true,
      muted: true,
      volume: 0,
      srcObject: null,
      setAttribute: vi.fn(),
    } as unknown as HTMLAudioElement;

    attachRemoteStreamToAudio(el, stream);

    expect(el.srcObject).toBe(stream);
    expect(track.enabled).toBe(true);
    expect(el.muted).toBe(false);
    expect(el.volume).toBe(1);
  });

  it('retries only with a stream at Live, talking, or visible', () => {
    expect(shouldRetryRemoteVoicePlay({ hasStream: false, live: true })).toBe(false);
    expect(shouldRetryRemoteVoicePlay({ hasStream: true })).toBe(false);
    expect(shouldRetryRemoteVoicePlay({ hasStream: true, live: true })).toBe(true);
    expect(shouldRetryRemoteVoicePlay({ hasStream: true, talking: true })).toBe(true);
    expect(shouldRetryRemoteVoicePlay({ hasStream: true, visible: true })).toBe(true);
  });
});
