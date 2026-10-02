import { describe, expect, it } from 'vitest';
import { shouldRetrySideLiveAudio } from '../../ui/SideLiveChatButton';
import {
  deriveSideLiveChatUi,
  shouldFullyTeardownSideChat,
  shouldFailClosedWithoutVoiceSession,
  resolveVoiceSessionForReadyPoll,
  shouldClearVoiceReadyOnFailClosed,
  shouldShowPeerNeedsConnect,
  shouldPulseConnectVoice,
  effectiveLobbyVoiceJoined,
  shouldPeerWaitFail,
  deriveLobbyVoiceHint,
  shouldDropJoinedOnVoiceSessionError,
  formatVoiceStartFailure,
  shouldShowVoiceDebugLine,
  MIC_BLOCKED,
} from '../useSideLiveChat';

describe('deriveSideLiveChatUi', () => {
  it('idle / none before join', () => {
    expect(deriveSideLiveChatUi(false, false, false, 'idle')).toEqual({
      uiStatus: 'idle',
      indicator: 'none',
    });
  });

  it('green Live when peer connected', () => {
    expect(deriveSideLiveChatUi(true, true, false, 'live')).toEqual({
      uiStatus: 'live',
      indicator: 'green',
    });
  });

  it('red while joining / connecting', () => {
    expect(deriveSideLiveChatUi(true, false, true, 'connecting')).toEqual({
      uiStatus: 'joining',
      indicator: 'red',
    });
    expect(deriveSideLiveChatUi(true, false, false, 'connecting')).toEqual({
      uiStatus: 'joining',
      indicator: 'red',
    });
  });

  it('red offline / error when joined but not live', () => {
    expect(deriveSideLiveChatUi(true, false, false, 'error')).toEqual({
      uiStatus: 'offline',
      indicator: 'red',
    });
    expect(deriveSideLiveChatUi(true, false, false, 'denied')).toEqual({
      uiStatus: 'offline',
      indicator: 'red',
    });
  });
});

describe('shouldFullyTeardownSideChat', () => {
  it('tears down when left chat, unavailable, or no room code', () => {
    expect(shouldFullyTeardownSideChat(false, true, 'ABCD')).toBe(true);
    expect(shouldFullyTeardownSideChat(true, false, 'ABCD')).toBe(true);
    expect(shouldFullyTeardownSideChat(true, true, null)).toBe(true);
    expect(shouldFullyTeardownSideChat(true, true, '')).toBe(true);
  });

  it('keeps mic/signaling across transient pauses while still joined', () => {
    expect(shouldFullyTeardownSideChat(true, true, 'ABCD')).toBe(false);
  });
});

describe('shouldFailClosedWithoutVoiceSession', () => {
  it('fails closed when Joined but no active session', () => {
    expect(shouldFailClosedWithoutVoiceSession(true, false)).toBe(true);
  });
  it('ok when Joined with active session', () => {
    expect(shouldFailClosedWithoutVoiceSession(true, true)).toBe(false);
  });
  it('ok when not Joined', () => {
    expect(shouldFailClosedWithoutVoiceSession(false, false)).toBe(false);
  });
  it('fails closed when Joined but PC or signaling missing', () => {
    expect(
      shouldFailClosedWithoutVoiceSession(true, true, {
        hasPc: false,
        signalingBound: true,
      }),
    ).toBe(true);
    expect(
      shouldFailClosedWithoutVoiceSession(true, true, {
        hasPc: true,
        signalingBound: false,
      }),
    ).toBe(true);
    expect(
      shouldFailClosedWithoutVoiceSession(true, true, {
        hasPc: true,
        signalingBound: true,
      }),
    ).toBe(false);
  });
  it('does NOT fail-closed when held lobby session is alive (remount gap)', () => {
    expect(
      shouldFailClosedWithoutVoiceSession(true, false, {
        hasPc: false,
        signalingBound: false,
        heldSessionAlive: true,
      }),
    ).toBe(false);
  });
});

describe('fail-closed vs held lobby voice session', () => {
  it('resolveVoiceSessionForReadyPoll prefers held over null sessionRef', () => {
    const held = { isDisposed: () => false, id: 'held' };
    const dead = { isDisposed: () => true, id: 'dead' };
    expect(resolveVoiceSessionForReadyPoll(null, held)?.id).toBe('held');
    expect(resolveVoiceSessionForReadyPoll(dead, held)?.id).toBe('held');
    expect(resolveVoiceSessionForReadyPoll(null, null)).toBeNull();
    expect(resolveVoiceSessionForReadyPoll(dead, dead)).toBeNull();
  });

  it('shouldClearVoiceReadyOnFailClosed keeps ready when heldCanPublish', () => {
    expect(
      shouldClearVoiceReadyOnFailClosed({
        joined: true,
        heldCanPublish: true,
        hasActiveSession: false,
        hasPc: false,
        signalingBound: false,
      }),
    ).toBe(false);
  });

  it('shouldClearVoiceReadyOnFailClosed clears when session truly dead', () => {
    expect(
      shouldClearVoiceReadyOnFailClosed({
        joined: true,
        heldCanPublish: false,
        hasActiveSession: false,
        hasPc: false,
        signalingBound: false,
      }),
    ).toBe(true);
    expect(
      shouldClearVoiceReadyOnFailClosed({
        joined: true,
        heldCanPublish: false,
        hasActiveSession: true,
        hasPc: false,
        signalingBound: true,
      }),
    ).toBe(true);
  });
});

describe('lobby Connect voice labels (UX contract)', () => {
  it('idle before connect; live green after peer link', () => {
    expect(deriveSideLiveChatUi(false, false, false, 'idle').uiStatus).toBe('idle');
    expect(deriveSideLiveChatUi(true, true, false, 'live')).toEqual({
      uiStatus: 'live',
      indicator: 'green',
    });
  });
});

describe('lobby voice peer-blame UX (unjoined never Failed)', () => {
  it('unjoined seat never shows peer-needs-Connect Failed', () => {
    expect(
      shouldShowPeerNeedsConnect({
        joined: false,
        localReady: false,
        peerReady: false,
        uiStatus: 'idle',
      }),
    ).toBe(false);
    expect(
      shouldShowPeerNeedsConnect({
        joined: false,
        localReady: false,
        peerReady: true,
        uiStatus: 'offline',
      }),
    ).toBe(false);
    expect(
      effectiveLobbyVoiceJoined({
        joined: false,
        localReady: false,
        uiStatus: 'offline',
      }),
    ).toBe(false);
    expect(
      shouldPulseConnectVoice({
        joined: false,
        localReady: false,
        uiStatus: 'idle',
      }),
    ).toBe(true);
    expect(
      deriveLobbyVoiceHint({
        joined: false,
        localReady: false,
        peerReady: false,
        uiStatus: 'idle',
        peerSeatName: 'Dummy2',
      }),
    ).toMatch(/tap Connect voice/);
    expect(
      deriveLobbyVoiceHint({
        joined: false,
        localReady: false,
        peerReady: false,
        uiStatus: 'idle',
        peerSeatName: 'Dummy2',
      }),
    ).not.toMatch(/needs Connect/);
  });

  it('joined + localReady + peerReady=0 shows waiting / peer needs Connect', () => {
    expect(
      shouldShowPeerNeedsConnect({
        joined: true,
        localReady: true,
        peerReady: false,
        uiStatus: 'joining',
      }),
    ).toBe(true);
    expect(
      deriveLobbyVoiceHint({
        joined: true,
        localReady: true,
        peerReady: false,
        uiStatus: 'joining',
        peerSeatName: 'Dummy2',
      }),
    ).toBe('Dummy2 needs Connect — waiting on them.');
  });

  it('after 15s Failed only when joined+localReady (peer wait gate)', () => {
    expect(
      shouldPeerWaitFail({
        localReady: false,
        peerReady: false,
        bothReady: false,
        isPeerLive: false,
      }),
    ).toBe(false);
    expect(
      shouldPeerWaitFail({
        localReady: true,
        peerReady: false,
        bothReady: false,
        isPeerLive: false,
      }),
    ).toBe(true);
    expect(
      shouldPeerWaitFail({
        localReady: true,
        peerReady: true,
        bothReady: false,
        isPeerLive: false,
      }),
    ).toBe(false);
  });

  it('Failed without localReady drops to Connect pulse (no peer blame)', () => {
    expect(
      effectiveLobbyVoiceJoined({
        joined: true,
        localReady: false,
        uiStatus: 'offline',
      }),
    ).toBe(false);
    expect(
      shouldPulseConnectVoice({
        joined: true,
        localReady: false,
        uiStatus: 'offline',
      }),
    ).toBe(true);
    expect(
      shouldShowPeerNeedsConnect({
        joined: true,
        localReady: false,
        peerReady: false,
        uiStatus: 'offline',
      }),
    ).toBe(false);
    expect(
      deriveLobbyVoiceHint({
        joined: true,
        localReady: false,
        peerReady: false,
        uiStatus: 'offline',
        peerSeatName: 'Dummy2',
      }),
    ).toMatch(/tap Connect voice/);
  });

  it('mic denied copy asks Allow microphone then Connect voice', () => {
    expect(MIC_BLOCKED).toMatch(/Allow microphone/);
    expect(MIC_BLOCKED).toMatch(/Connect voice/);
  });
});


describe('host Connect start-failure UX', () => {
  it('does not drop joined on error while session can still publish ready', () => {
    expect(
      shouldDropJoinedOnVoiceSessionError({ canPublishReady: true }),
    ).toBe(false);
  });

  it('drops joined on error only when session cannot publish ready', () => {
    expect(
      shouldDropJoinedOnVoiceSessionError({ canPublishReady: false }),
    ).toBe(true);
  });

  it('formatVoiceStartFailure includes the real exception message', () => {
    expect(formatVoiceStartFailure(new Error('Permission denied'))).toContain(
      'Permission denied',
    );
    expect(formatVoiceStartFailure(new Error('Permission denied'))).toMatch(
      /Voice failed to start/i,
    );
    expect(formatVoiceStartFailure('boom')).toContain('boom');
    expect(formatVoiceStartFailure(null)).toMatch(/Voice failed to start/i);
  });

  it('keeps debug line visible with inline error after joined drops', () => {
    expect(
      shouldShowVoiceDebugLine({
        joined: false,
        debugLine: 'readyMe=0 micAttached=0',
        inlineError: 'Voice failed to start: boom',
      }),
    ).toBe(true);
    expect(
      shouldShowVoiceDebugLine({
        joined: false,
        debugLine: 'readyMe=0',
        inlineError: null,
      }),
    ).toBe(false);
    expect(
      shouldShowVoiceDebugLine({
        joined: true,
        debugLine: 'readyMe=1',
        inlineError: null,
      }),
    ).toBe(true);
  });
});


describe('Safari remote audio retry policy', () => {
  it('retries attached remote audio when Live or first talking arrives', () => {
    expect(shouldRetrySideLiveAudio({ hasStream: true, joined: true, uiStatus: 'live', remoteTalking: false })).toBe(true);
    expect(shouldRetrySideLiveAudio({ hasStream: true, joined: true, uiStatus: 'joining', remoteTalking: true })).toBe(true);
  });

  it('does not retry without a stream or before joining', () => {
    expect(shouldRetrySideLiveAudio({ hasStream: false, joined: true, uiStatus: 'live', remoteTalking: true })).toBe(false);
    expect(shouldRetrySideLiveAudio({ hasStream: true, joined: false, uiStatus: 'live', remoteTalking: true })).toBe(false);
  });
});
