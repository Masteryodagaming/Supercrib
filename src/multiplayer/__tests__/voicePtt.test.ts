import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setMicTrackEnabled,
  cloneMicTrackForVad,
  talkingWritePayload,
  isVoiceSdpPayload,
  isVoiceIcePayload,
  buildSdpPayload,
  buildIcePayload,
  voiceRootPath,
  VOICE_STUN_SERVERS,
  VOICE_ICE_SERVERS,
  isSeatVoiceReady,
  buildVoiceIceServers,
  formatVoiceLinkDebug,
  coerceSeatFrom,
  shouldPublishSdpBeforeIceGather,
  shouldClearAnswerOnOfferPublish,
  shouldAnswerOfferWithoutMic,
  shouldForceAudioSendRecv,
  shouldBumpRenegotiateAfterMicAttach,
  shouldBumpOutboundUpgradeOnLive,
  accumulateRemoteAudioTrack,
  captureSendTrackEnabledForSdp,
  restoreSendTrackEnabledAfterSdp,
  isInitialOffererSeat,
  shouldAnswerRemoteOffer,
  shouldApplyRemoteAnswer,
  shouldPublishVoiceReady,
  shouldAnnounceVoiceReady,
  shouldReassertVoiceReady,
  shouldRunLinkWatchdogIceRestart,
  audioDirectionFromSdp,
  LINK_WATCHDOG_MS,
  LINK_WATCHDOG_NO_ANSWER_MS,
  shouldBackupOffer,
  shouldCreateOfferAsSeat,
  shouldRollbackLocalOfferOnGlare,
  isPoliteVoicePeer,
  BACKUP_OFFER_WAIT_MS,
  ANSWER_FORCE_MS,
  GUEST_NO_OFFER_MSG,
  VOICE_SESSION_DEAD_MSG,
  WAITING_FOR_HOST_CONNECT_MSG,
  WAITING_FOR_PEER_CONNECT_MSG,
  PEER_WAIT_FAIL_MS,
  shouldPeerWaitFailClosed,
  MIC_BLOCKED_HINT,
  resolveRTCPeerConnectionCtor,
  RTCPEERCONNECTION_MISSING_MSG,
} from '../voicePtt';

describe('voicePtt pure helpers', () => {
  it('keeps the VAD monitor live while muting only its sender clone', () => {
    const sendTrack = { enabled: true };
    const monitorTrack = {
      enabled: false,
      clone: vi.fn(() => sendTrack),
    } as unknown as MediaStreamTrack;

    const result = cloneMicTrackForVad(monitorTrack, false);

    expect(monitorTrack.enabled).toBe(true);
    expect(monitorTrack.clone).toHaveBeenCalledOnce();
    expect(result).toBe(sendTrack);
    expect(result.enabled).toBe(false);
  });

  it('voiceRootPath normalizes room code', () => {
    expect(voiceRootPath(' ab12 ')).toBe('rooms/AB12/voice');
  });

  it('exposes STUN servers in VOICE_STUN_SERVERS', () => {
    expect(VOICE_STUN_SERVERS.length).toBeGreaterThan(0);
    expect(VOICE_STUN_SERVERS.every((s) => String(s.urls).includes('stun:'))).toBe(true);
  });

  it('VOICE_ICE_SERVERS exposes STUN fallback (TURN built async)', () => {
    expect(VOICE_ICE_SERVERS.length).toBeGreaterThan(0);
    const urls = VOICE_ICE_SERVERS.map((s) => String(s.urls));
    expect(urls.some((u) => u.includes('stun:'))).toBe(true);
  });

  it('buildVoiceIceServers keeps STUN and adds openrelay Metered TURN', async () => {
    const servers = await buildVoiceIceServers();
    const urls = servers.map((s) => (Array.isArray(s.urls) ? s.urls.join(',') : String(s.urls)));
    expect(urls.some((u) => u.includes('stun:'))).toBe(true);
    expect(urls.some((u) => u.includes('turn:') && u.includes('openrelay.metered.ca'))).toBe(true);
    // Dead FreeSTUN / staticauth must stay out (CF proxy / ICE 701).
    expect(urls.some((u) => u.includes('freestun.net'))).toBe(false);
    expect(urls.some((u) => u.includes('staticauth.openrelay'))).toBe(false);
    expect(urls.some((u) => u.includes('freeturn.net'))).toBe(false);
    const turn = servers.find((s) => {
      const u = Array.isArray(s.urls) ? s.urls.join(',') : String(s.urls);
      return u.includes('turn:') && u.includes('openrelay.metered.ca');
    });
    expect(turn?.username).toBe('openrelayproject');
    expect(turn?.credential).toBe('openrelayproject');
  });

  it('formatVoiceLinkDebug renders ready/mic/offer diagnostics', () => {
    const line = formatVoiceLinkDebug({
      readyMe: true,
      peerReady: true,
      bothReady: true,
      hasOffer: false,
      hasAnswer: false,
      seenOffer: true,
      wroteAnswer: false,
      rtdbAnswer: false,
      ice: 'checking',
      conn: 'connecting',
      micAttached: true,
      seat: 1,
    });
    expect(line).toContain('readyMe=1');
    expect(line).toContain('peerReady=1');
    expect(line).toContain('bothReady=1');
    expect(line).toContain('micAttached=1');
    expect(line).toContain('offer=0');
    expect(line).toContain('seenOffer=1');
    expect(line).toContain('wroteAnswer=0');
    expect(line).toContain('rtdbAnswer=0');
    expect(line).toContain('sendDir=none');
    expect(line).toContain('sendEn=-');
    expect(line).toContain('ice=checking');
    expect(line).toContain('seat=1');
  });

  it('formatVoiceLinkDebug shows seat0 stuck offer=0 when mic missing', () => {
    const line = formatVoiceLinkDebug({
      readyMe: true,
      peerReady: true,
      bothReady: true,
      hasOffer: false,
      hasAnswer: false,
      seenOffer: false,
      wroteAnswer: false,
      rtdbAnswer: false,
      ice: 'none',
      conn: 'none',
      micAttached: false,
      seat: 0,
    });
    expect(line).toContain('micAttached=0');
    expect(line).toContain('offer=0');
    expect(line).toContain('seat=0');
  });

  it('formatVoiceLinkDebug healthy line includes answer=1 wroteAnswer=1', () => {
    const line = formatVoiceLinkDebug({
      readyMe: true,
      peerReady: true,
      bothReady: true,
      hasOffer: true,
      hasAnswer: true,
      seenOffer: true,
      wroteAnswer: true,
      rtdbAnswer: true,
      ice: 'connected',
      conn: 'connected',
      micAttached: true,
      seat: 0,
      sendDir: 'sendrecv',
      sendEnabled: false,
    });
    expect(line).toContain('offer=1');
    expect(line).toContain('answer=1');
    expect(line).toContain('wroteAnswer=1');
    expect(line).toContain('rtdbAnswer=1');
    expect(line).toContain('sendDir=sendrecv');
    expect(line).toContain('sendEn=0');
    expect(line).toContain('ice=connected');
  });

  it('isSeatVoiceReady treats sparse RTDB array holes as not ready', () => {
    // NCM5X wild shape: ready=[null, true] — only seat 1 joined chat.
    expect(isSeatVoiceReady([null, true], 0)).toBe(false);
    expect(isSeatVoiceReady([null, true], 1)).toBe(true);
  });

  it('isSeatVoiceReady handles map and array RTDB shapes', () => {
    expect(isSeatVoiceReady({ '0': true, '1': false }, 0)).toBe(true);
    expect(isSeatVoiceReady({ '0': true, '1': false }, 1)).toBe(false);
    expect(isSeatVoiceReady([true, false], 0)).toBe(true);
    expect(isSeatVoiceReady([true, false], 1)).toBe(false);
    expect(isSeatVoiceReady([false, true], 1)).toBe(true);
    expect(isSeatVoiceReady(null, 0)).toBe(false);
  });

  it('VOICE_ICE_SERVERS includes Cloudflare STUN', () => {
    const urls = VOICE_ICE_SERVERS.map((s) => String(s.urls));
    expect(urls.some((u) => u.includes('stun.cloudflare.com'))).toBe(true);
  });

  it('setMicTrackEnabled toggles track.enabled', () => {
    const track = { enabled: false } as MediaStreamTrack;
    expect(setMicTrackEnabled(track, true)).toBe(true);
    expect(track.enabled).toBe(true);
    expect(setMicTrackEnabled(track, false)).toBe(false);
    expect(track.enabled).toBe(false);
    expect(setMicTrackEnabled(null, true)).toBe(false);
  });

  it('talkingWritePayload is strict boolean true', () => {
    expect(talkingWritePayload(true)).toBe(true);
    expect(talkingWritePayload(false)).toBe(false);
  });

  it('isVoiceSdpPayload validates offer/answer shape', () => {
    expect(isVoiceSdpPayload({ type: 'offer', sdp: 'v=0', from: 0, at: 1 })).toBe(true);
    expect(isVoiceSdpPayload({ type: 'answer', sdp: 'v=0', from: 1, at: 2 })).toBe(true);
    // RTDB may deserialize seat as numeric string — must still accept.
    expect(isVoiceSdpPayload({ type: 'offer', sdp: 'v=0', from: '0', at: 1 })).toBe(true);
    expect(isVoiceSdpPayload({ type: 'answer', sdp: 'v=0', from: '1', at: 2 })).toBe(true);
    expect(isVoiceSdpPayload({ type: 'offer', sdp: '', from: 0, at: 1 })).toBe(false);
    expect(isVoiceSdpPayload(null)).toBe(false);
    expect(isVoiceSdpPayload({ type: 'offer', sdp: 'x', from: 2, at: 1 })).toBe(false);
  });

  it('coerceSeatFrom accepts number and numeric string 0|1', () => {
    expect(coerceSeatFrom(0)).toBe(0);
    expect(coerceSeatFrom(1)).toBe(1);
    expect(coerceSeatFrom('0')).toBe(0);
    expect(coerceSeatFrom('1')).toBe(1);
    expect(coerceSeatFrom(2)).toBeNull();
    expect(coerceSeatFrom('x')).toBeNull();
  });

  it('shouldPublishSdpBeforeIceGather is true (MT22J: do not block answer on gather)', () => {
    // Trickle ICE writes ice/{seat}; awaiting gather before RTDB set() left
    // answer=0 while host Failed ice=new on cellular / slow gather.
    expect(shouldPublishSdpBeforeIceGather()).toBe(true);
  });

  it('isVoiceIcePayload validates candidate shape', () => {
    expect(
      isVoiceIcePayload({
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0,
        from: 1,
        at: 9,
      }),
    ).toBe(true);
    expect(isVoiceIcePayload({ candidate: '', from: 0, at: 1 })).toBe(false);
  });

  it('buildSdpPayload / buildIcePayload shapes', () => {
    const sdp = buildSdpPayload({ type: 'offer', sdp: 'v=0\r\n' }, 0, 42);
    expect(sdp).toEqual({ type: 'offer', sdp: 'v=0\r\n', from: 0, at: 42 });

    const ice = buildIcePayload(
      {
        candidate: 'candidate:abc',
        sdpMid: '0',
        sdpMLineIndex: 0,
      } as RTCIceCandidate,
      1,
      7,
    );
    expect(ice.from).toBe(1);
    expect(ice.candidate).toBe('candidate:abc');
    expect(ice.at).toBe(7);
  });

  it('shouldClearAnswerOnOfferPublish only on iceRestart or distinct renegotiate', () => {
    // Offer retry while waiting for first answer must NOT wipe answer.
    expect(
      shouldClearAnswerOnOfferPublish({
        iceRestart: false,
        offerSdpChanged: true,
        hadRemoteAnswer: false,
      }),
    ).toBe(false);
    expect(
      shouldClearAnswerOnOfferPublish({
        iceRestart: false,
        offerSdpChanged: false,
        hadRemoteAnswer: false,
      }),
    ).toBe(false);
    // Identical republish after answer exists — keep answer.
    expect(
      shouldClearAnswerOnOfferPublish({
        iceRestart: false,
        offerSdpChanged: false,
        hadRemoteAnswer: true,
      }),
    ).toBe(false);
    // Distinct new offer after prior answer — clear so guest re-answers.
    expect(
      shouldClearAnswerOnOfferPublish({
        iceRestart: false,
        offerSdpChanged: true,
        hadRemoteAnswer: true,
      }),
    ).toBe(true);
    // ICE restart always clears.
    expect(
      shouldClearAnswerOnOfferPublish({
        iceRestart: true,
        offerSdpChanged: false,
        hadRemoteAnswer: false,
      }),
    ).toBe(true);
  });

  it('shouldAnswerOfferWithoutMic is false (wait for sendrecv mic)', () => {
    // recvonly-first answers left host deaf to seat1 on iOS Safari.
    expect(shouldAnswerOfferWithoutMic()).toBe(false);
  });

  it('shouldForceAudioSendRecv only after mic is on the sender', () => {
    expect(shouldForceAudioSendRecv({ micAttached: false })).toBe(false);
    expect(shouldForceAudioSendRecv({ micAttached: true })).toBe(true);
  });

  it('shouldBumpRenegotiateAfterMicAttach is off while answers wait for mic', () => {
    // shouldAnswerOfferWithoutMic()===false → no recvonly-first residue.
    expect(
      shouldBumpRenegotiateAfterMicAttach({
        micAttached: true,
        hasPublishedOffer: false,
        canCreateOffer: false,
        seenRemoteOffer: true,
        wroteLocalAnswer: false,
      }),
    ).toBe(false);
    expect(
      shouldBumpRenegotiateAfterMicAttach({
        micAttached: true,
        hasPublishedOffer: false,
        canCreateOffer: false,
        seenRemoteOffer: false,
        wroteLocalAnswer: true,
      }),
    ).toBe(false);
  });

  it('shouldBumpOutboundUpgradeOnLive only for explicit recvonly/inactive', () => {
    const base = {
      micAttached: true,
      hasPublishedOffer: false,
      canCreateOffer: false,
      seenRemoteOffer: true,
      wroteLocalAnswer: true,
    };
    // Parent gate is false while wait-for-mic answers are on.
    expect(
      shouldBumpOutboundUpgradeOnLive({
        ...base,
        audioCurrentDirection: 'recvonly',
      }),
    ).toBe(false);
    expect(
      shouldBumpOutboundUpgradeOnLive({
        ...base,
        audioCurrentDirection: 'sendrecv',
      }),
    ).toBe(false);
  });

  it('accumulateRemoteAudioTrack replaces prior audio tracks', () => {
    const removed: string[] = [];
    const tracks: { id: string; kind: string; readyState: string }[] = [];
    const stream = {
      getAudioTracks: () => tracks.filter((t) => t.kind === 'audio') as unknown as MediaStreamTrack[],
      getTracks: () => tracks as unknown as MediaStreamTrack[],
      removeTrack: (t: MediaStreamTrack) => {
        removed.push((t as unknown as { id: string }).id);
        const i = tracks.findIndex((x) => x.id === (t as unknown as { id: string }).id);
        if (i >= 0) tracks.splice(i, 1);
      },
      addTrack: (t: MediaStreamTrack) => {
        tracks.push(t as unknown as { id: string; kind: string; readyState: string });
      },
    } as unknown as MediaStream;
    const oldTrack = {
      id: 'old',
      kind: 'audio',
      readyState: 'live',
      enabled: true,
    } as unknown as MediaStreamTrack;
    const newTrack = {
      id: 'new',
      kind: 'audio',
      readyState: 'live',
      enabled: true,
    } as unknown as MediaStreamTrack;
    tracks.push(oldTrack as unknown as { id: string; kind: string; readyState: string });
    const out = accumulateRemoteAudioTrack(stream, newTrack);
    expect(out).toBe(stream);
    expect(removed).toEqual(['old']);
    expect(tracks.map((t) => t.id)).toEqual(['new']);
  });

  it('capture/restore send track enabled around SDP keeps VAD gate', () => {
    const track = { enabled: false } as MediaStreamTrack;
    const was = captureSendTrackEnabledForSdp(track);
    expect(was).toBe(false);
    expect(track.enabled).toBe(true);
    restoreSendTrackEnabledAfterSdp(track, was);
    expect(track.enabled).toBe(false);
    expect(captureSendTrackEnabledForSdp(null)).toBeNull();
    restoreSendTrackEnabledAfterSdp(null, false);
  });

  it('shouldAnnounceVoiceReady requires mic on sender', () => {
    expect(
      shouldAnnounceVoiceReady({ canPublishReady: true, micAttached: false }),
    ).toBe(false);
    expect(
      shouldAnnounceVoiceReady({ canPublishReady: false, micAttached: true }),
    ).toBe(false);
    expect(
      shouldAnnounceVoiceReady({ canPublishReady: true, micAttached: true }),
    ).toBe(true);
  });

  it('shouldReassertVoiceReady blocks stayReady before mic (Cn2CEX15 race)', () => {
    // start({announceReady:false}) set stayReady=true; ready listener must NOT
    // write ready=true until adoptMicStream.
    expect(
      shouldReassertVoiceReady({
        stayReady: true,
        canPublishReady: true,
        micAttached: false,
        mineAlreadyReady: false,
      }),
    ).toBe(false);
    expect(
      shouldReassertVoiceReady({
        stayReady: true,
        canPublishReady: true,
        micAttached: true,
        mineAlreadyReady: false,
      }),
    ).toBe(true);
    expect(
      shouldReassertVoiceReady({
        stayReady: true,
        canPublishReady: true,
        micAttached: true,
        mineAlreadyReady: true,
      }),
    ).toBe(false);
  });

  it('shouldRunLinkWatchdogIceRestart waits for answer / longer grace', () => {
    const base = {
      bothReady: true,
      isPeerLive: false,
      micAttached: true,
      graceMs: LINK_WATCHDOG_MS,
      answerGraceMs: LINK_WATCHDOG_NO_ANSWER_MS,
    };
    // No answer yet — 3.5s old window must NOT restart.
    expect(
      shouldRunLinkWatchdogIceRestart({
        ...base,
        hasAnswer: false,
        msSinceBothReady: 3500,
      }),
    ).toBe(false);
    expect(
      shouldRunLinkWatchdogIceRestart({
        ...base,
        hasAnswer: false,
        msSinceBothReady: LINK_WATCHDOG_NO_ANSWER_MS,
      }),
    ).toBe(true);
    // With answer — grace is LINK_WATCHDOG_MS (8s), not 3.5s.
    expect(
      shouldRunLinkWatchdogIceRestart({
        ...base,
        hasAnswer: true,
        msSinceBothReady: 3500,
      }),
    ).toBe(false);
    expect(
      shouldRunLinkWatchdogIceRestart({
        ...base,
        hasAnswer: true,
        msSinceBothReady: LINK_WATCHDOG_MS,
      }),
    ).toBe(true);
    // No mic → never.
    expect(
      shouldRunLinkWatchdogIceRestart({
        ...base,
        micAttached: false,
        hasAnswer: true,
        msSinceBothReady: LINK_WATCHDOG_MS,
      }),
    ).toBe(false);
  });

  it('audioDirectionFromSdp reads first audio m-line direction', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=sendrecv',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=recvonly',
    ].join('\n');
    expect(audioDirectionFromSdp(sdp)).toBe('sendrecv');
    expect(
      audioDirectionFromSdp(
        'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n',
      ),
    ).toBe('recvonly');
    expect(audioDirectionFromSdp('')).toBeNull();
    expect(audioDirectionFromSdp(null)).toBeNull();
  });

  it('VAD mute still leaves SDP sendrecv intent (force after mic)', () => {
    // Track may be enabled=false for VAD silence, but force/sendrecv policy
    // is keyed on micAttached — not track.enabled.
    expect(shouldForceAudioSendRecv({ micAttached: true })).toBe(true);
    const track = { enabled: false } as MediaStreamTrack;
    const was = captureSendTrackEnabledForSdp(track);
    expect(track.enabled).toBe(true);
    restoreSendTrackEnabledAfterSdp(track, was);
    expect(track.enabled).toBe(false);
  });

  it('isInitialOffererSeat is only seat 0', () => {
    expect(isInitialOffererSeat(0)).toBe(true);
    expect(isInitialOffererSeat(1)).toBe(false);
  });

  it('shouldAnswerRemoteOffer: only seat1 answers, only seat0 offers (no glare)', () => {
    expect(shouldAnswerRemoteOffer(1, 0)).toBe(true);
    expect(shouldAnswerRemoteOffer(0, 0)).toBe(false);
    // Seat 0 must NEVER answer a seat-1 offer (that was the glare path).
    expect(shouldAnswerRemoteOffer(0, 1)).toBe(false);
    expect(shouldAnswerRemoteOffer(1, 1)).toBe(false);
  });

  it('shouldApplyRemoteAnswer: only seat0 applies answers from seat1', () => {
    expect(shouldApplyRemoteAnswer(0, 1)).toBe(true);
    expect(shouldApplyRemoteAnswer(1, 0)).toBe(false);
    expect(shouldApplyRemoteAnswer(0, 0)).toBe(false);
    expect(shouldApplyRemoteAnswer(1, 1)).toBe(false);
  });

  it('shouldPublishVoiceReady fails closed without session/PC/signaling', () => {
    expect(
      shouldPublishVoiceReady({
        hasActiveSession: false,
        hasPc: true,
        signalingBound: true,
      }),
    ).toBe(false);
    expect(
      shouldPublishVoiceReady({
        hasActiveSession: true,
        hasPc: false,
        signalingBound: true,
      }),
    ).toBe(false);
    expect(
      shouldPublishVoiceReady({
        hasActiveSession: true,
        hasPc: true,
        signalingBound: false,
      }),
    ).toBe(false);
    expect(
      shouldPublishVoiceReady({
        hasActiveSession: true,
        hasPc: true,
        signalingBound: true,
      }),
    ).toBe(true);
  });

  it('ANSWER_FORCE_MS is 1s; VOICE_SESSION_DEAD_MSG tells host to tap Connect voice', () => {
    expect(ANSWER_FORCE_MS).toBe(1000);
    expect(VOICE_SESSION_DEAD_MSG).toMatch(/Voice session dead/);
    expect(VOICE_SESSION_DEAD_MSG).toMatch(/tap Connect voice again/);
  });

  it('peerReady=0 guest UX: Waiting for host + fail ~15s (no infinite CONNECTING)', () => {
    expect(WAITING_FOR_HOST_CONNECT_MSG).toMatch(/Waiting for host to tap Connect voice/);
    expect(WAITING_FOR_PEER_CONNECT_MSG).toMatch(/Waiting for opponent to tap Connect voice/);
    expect(PEER_WAIT_FAIL_MS).toBe(15000);
    expect(
      shouldPeerWaitFailClosed({
        localReady: false,
        peerReady: false,
        bothReady: false,
        isPeerLive: false,
      }),
    ).toBe(false);
    expect(
      shouldPeerWaitFailClosed({
        localReady: true,
        peerReady: false,
        bothReady: false,
        isPeerLive: false,
      }),
    ).toBe(true);
    expect(MIC_BLOCKED_HINT).toMatch(/Allow microphone/);
  });

  it('seat0 never answers an offer from=1 (single deterministic offerer)', () => {
    expect(shouldAnswerRemoteOffer(0, 1)).toBe(false);
    expect(shouldAnswerRemoteOffer(1, 0)).toBe(true);
  });

  it('shouldBackupOffer after ~2s bothReady with no offer', () => {
    expect(BACKUP_OFFER_WAIT_MS).toBe(2000);
    expect(
      shouldBackupOffer({
        bothReady: true,
        hasRemoteOffer: false,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 2000,
      }),
    ).toBe(true);
    expect(
      shouldBackupOffer({
        bothReady: true,
        hasRemoteOffer: false,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 1999,
      }),
    ).toBe(false);
    expect(
      shouldBackupOffer({
        bothReady: true,
        hasRemoteOffer: true,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 5000,
      }),
    ).toBe(false);
  });

  it('shouldCreateOfferAsSeat: seat0 only — seat1 never offers even with backup flag', () => {
    expect(
      shouldCreateOfferAsSeat({
        mySeat: 0,
        bothReady: true,
        alreadyPublishedOffer: false,
        backupOffererActive: false,
        hasRemoteOffer: false,
      }),
    ).toBe(true);
    expect(
      shouldCreateOfferAsSeat({
        mySeat: 1,
        bothReady: true,
        alreadyPublishedOffer: false,
        backupOffererActive: false,
        hasRemoteOffer: false,
      }),
    ).toBe(false);
    expect(
      shouldCreateOfferAsSeat({
        mySeat: 1,
        bothReady: true,
        alreadyPublishedOffer: false,
        backupOffererActive: true,
        hasRemoteOffer: false,
      }),
    ).toBe(false);
    expect(
      shouldCreateOfferAsSeat({
        mySeat: 1,
        bothReady: true,
        alreadyPublishedOffer: false,
        backupOffererActive: true,
        hasRemoteOffer: true,
      }),
    ).toBe(false);
  });

  it('glare: polite peer rolls back; higher at wins', () => {
    expect(isPoliteVoicePeer(1)).toBe(true);
    expect(isPoliteVoicePeer(0)).toBe(false);
    expect(
      shouldRollbackLocalOfferOnGlare({
        mySeat: 1,
        haveLocalOffer: true,
        remoteOfferAt: 100,
        localOfferAt: 100,
      }),
    ).toBe(true);
    expect(
      shouldRollbackLocalOfferOnGlare({
        mySeat: 0,
        haveLocalOffer: true,
        remoteOfferAt: 100,
        localOfferAt: 100,
      }),
    ).toBe(false);
    expect(
      shouldRollbackLocalOfferOnGlare({
        mySeat: 0,
        haveLocalOffer: true,
        remoteOfferAt: 200,
        localOfferAt: 100,
      }),
    ).toBe(true);
    expect(
      shouldRollbackLocalOfferOnGlare({
        mySeat: 1,
        haveLocalOffer: true,
        remoteOfferAt: 50,
        localOfferAt: 100,
      }),
    ).toBe(false);
  });

  it('GUEST_NO_OFFER_MSG is reconnect copy after backup', () => {
    expect(GUEST_NO_OFFER_MSG).toMatch(/No offer/);
    expect(GUEST_NO_OFFER_MSG).toMatch(/reconnect/i);
  });

  it('formatVoiceLinkDebug includes diag= and lastErr= when set', () => {
    const line = formatVoiceLinkDebug({
      readyMe: true,
      peerReady: true,
      bothReady: true,
      hasOffer: true,
      hasAnswer: false,
      seenOffer: true,
      wroteAnswer: false,
      rtdbAnswer: false,
      ice: 'new',
      conn: 'new',
      micAttached: true,
      seat: 1,
      diag: 'createAnswer:InvalidStateError:x',
      lastErr: 'createAnswer',
    });
    expect(line).toContain('diag=createAnswer:InvalidStateError:x');
    expect(line).toContain('lastErr=createAnswer');
    expect(line).toContain('seat=1');
  });

  describe('resolveRTCPeerConnectionCtor', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns globalThis.RTCPeerConnection when it is a function', () => {
      function FakePC(this: { cfg?: unknown }, cfg?: unknown) {
        this.cfg = cfg;
      }
      vi.stubGlobal('RTCPeerConnection', FakePC);
      const Ctor = resolveRTCPeerConnectionCtor();
      expect(Ctor).toBe(FakePC);
      const inst = new Ctor({ iceServers: [] });
      expect(inst).toBeTruthy();
    });

    it('falls back to window.RTCPeerConnection', () => {
      function FakeWinPC(this: object) {}
      vi.stubGlobal('RTCPeerConnection', undefined);
      vi.stubGlobal('window', {
        ...((globalThis as { window?: object }).window ?? {}),
        RTCPeerConnection: FakeWinPC,
      });
      // globalThis.RTCPeerConnection stubbed undefined — window fallback
      const g = globalThis as { RTCPeerConnection?: unknown };
      g.RTCPeerConnection = undefined;
      const Ctor = resolveRTCPeerConnectionCtor();
      expect(Ctor).toBe(FakeWinPC);
    });

    it('throws a clear error when no constructor is available', () => {
      vi.stubGlobal('RTCPeerConnection', undefined);
      vi.stubGlobal('webkitRTCPeerConnection', undefined);
      const g = globalThis as {
        RTCPeerConnection?: unknown;
        webkitRTCPeerConnection?: unknown;
        window?: { RTCPeerConnection?: unknown; webkitRTCPeerConnection?: unknown };
      };
      g.RTCPeerConnection = undefined;
      g.webkitRTCPeerConnection = undefined;
      if (g.window) {
        g.window.RTCPeerConnection = undefined;
        g.window.webkitRTCPeerConnection = undefined;
      }
      expect(() => resolveRTCPeerConnectionCtor()).toThrow(
        RTCPEERCONNECTION_MISSING_MSG,
      );
    });

    it('rejects a non-function shadow (object) instead of "is not a constructor"', () => {
      vi.stubGlobal('RTCPeerConnection', { iceServers: [] });
      expect(() => resolveRTCPeerConnectionCtor()).toThrow(/RTCPeerConnection unavailable/);
    });
  });

});
