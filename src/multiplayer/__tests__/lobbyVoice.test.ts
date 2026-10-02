import { describe, expect, it, beforeEach } from 'vitest';
import {
  shouldRecreateHeldLobbyVoiceSession,
  shouldOfferOnceWhenBothLobbyReady,
  shouldKickLobbyHostOffer,
  guestNoHostOfferFailMessage,
  shouldLobbyBackupOffer,
  answererIsOfferFromOtherSeat,
  shouldAnswerOnceWhenOfferFromOther,
  shouldCarryVoiceSessionIntoTable,
  shouldDisposeVoiceOnEffectCleanup,
  __resetLobbyVoiceHoldForTests,
  getHeldLobbyVoiceSession,
} from '../lobbyVoice';
import { GUEST_NO_OFFER_MSG, BACKUP_OFFER_WAIT_MS } from '../voicePtt';

describe('lobby voice — both-ready offer/answer once', () => {
  beforeEach(() => {
    __resetLobbyVoiceHoldForTests();
  });

  it('seat 0 offers once when both lobby-voice-ready', () => {
    expect(
      shouldOfferOnceWhenBothLobbyReady({
        mySeat: 0,
        bothLobbyVoiceReady: true,
        alreadyPublishedOffer: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferOnceWhenBothLobbyReady({
        mySeat: 0,
        bothLobbyVoiceReady: true,
        alreadyPublishedOffer: true,
      }),
    ).toBe(false);
  });

  it('seat 1 does not initial-offer', () => {
    expect(
      shouldOfferOnceWhenBothLobbyReady({
        mySeat: 1,
        bothLobbyVoiceReady: true,
        alreadyPublishedOffer: false,
      }),
    ).toBe(false);
  });

  it('no offer until both lobby-voice-ready', () => {
    expect(
      shouldOfferOnceWhenBothLobbyReady({
        mySeat: 0,
        bothLobbyVoiceReady: false,
        alreadyPublishedOffer: false,
      }),
    ).toBe(false);
  });

  it('shouldKickLobbyHostOffer matches both-ready → seat 0 must offer', () => {
    expect(
      shouldKickLobbyHostOffer({
        mySeat: 0,
        bothLobbyVoiceReady: true,
        alreadyPublishedOffer: false,
      }),
    ).toBe(true);
    expect(
      shouldKickLobbyHostOffer({
        mySeat: 0,
        bothLobbyVoiceReady: true,
        alreadyPublishedOffer: true,
      }),
    ).toBe(false);
    expect(
      shouldKickLobbyHostOffer({
        mySeat: 1,
        bothLobbyVoiceReady: true,
        alreadyPublishedOffer: false,
      }),
    ).toBe(false);
  });

  it('guest fail copy only after backup still finds no offer', () => {
    expect(guestNoHostOfferFailMessage()).toBe(GUEST_NO_OFFER_MSG);
    expect(guestNoHostOfferFailMessage()).toMatch(/No offer/);
    expect(guestNoHostOfferFailMessage()).toMatch(/reconnect/i);
  });

  it('bothReady + seat0 silent → seat1 backup offers after ~2s', () => {
    expect(BACKUP_OFFER_WAIT_MS).toBe(2000);
    expect(
      shouldLobbyBackupOffer({
        mySeat: 1,
        bothLobbyVoiceReady: true,
        hasRemoteOffer: false,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 2000,
      }),
    ).toBe(true);
    expect(
      shouldLobbyBackupOffer({
        mySeat: 1,
        bothLobbyVoiceReady: true,
        hasRemoteOffer: false,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 500,
      }),
    ).toBe(false);
    expect(
      shouldLobbyBackupOffer({
        mySeat: 0,
        bothLobbyVoiceReady: true,
        hasRemoteOffer: false,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 5000,
      }),
    ).toBe(false);
    expect(
      shouldLobbyBackupOffer({
        mySeat: 1,
        bothLobbyVoiceReady: true,
        hasRemoteOffer: true,
        hasLocalPublishedOffer: false,
        msSinceBothReady: 5000,
      }),
    ).toBe(false);
  });

  it('answerer is seat 1 answering seat 0 only (seat 0 never answers)', () => {
    expect(answererIsOfferFromOtherSeat(1, 0)).toBe(true);
    expect(answererIsOfferFromOtherSeat(0, 1)).toBe(false);
    expect(answererIsOfferFromOtherSeat(1, 1)).toBe(false);
    expect(answererIsOfferFromOtherSeat(0, 0)).toBe(false);
  });

  it('seat 1 answers seat 0 once; seat 0 ignores offers from seat 1', () => {
    expect(
      shouldAnswerOnceWhenOfferFromOther({
        mySeat: 1,
        offerFrom: 0,
        alreadyPublishedAnswer: false,
      }),
    ).toBe(true);
    expect(
      shouldAnswerOnceWhenOfferFromOther({
        mySeat: 0,
        offerFrom: 1,
        alreadyPublishedAnswer: false,
      }),
    ).toBe(false);
    expect(
      shouldAnswerOnceWhenOfferFromOther({
        mySeat: 1,
        offerFrom: 1,
        alreadyPublishedAnswer: false,
      }),
    ).toBe(false);
    expect(
      shouldAnswerOnceWhenOfferFromOther({
        mySeat: 1,
        offerFrom: 0,
        alreadyPublishedAnswer: true,
      }),
    ).toBe(false);
    expect(
      shouldAnswerOnceWhenOfferFromOther({
        mySeat: 1,
        offerFrom: null,
        alreadyPublishedAnswer: false,
      }),
    ).toBe(false);
  });
});

describe('lobby voice — session survives table mount', () => {
  it('carries into table when joined and not leaving', () => {
    expect(
      shouldCarryVoiceSessionIntoTable({
        voiceJoined: true,
        leavingRoom: false,
        disconnectVoice: false,
      }),
    ).toBe(true);
  });

  it('does not carry when leaving room or disconnect voice', () => {
    expect(
      shouldCarryVoiceSessionIntoTable({
        voiceJoined: true,
        leavingRoom: true,
        disconnectVoice: false,
      }),
    ).toBe(false);
    expect(
      shouldCarryVoiceSessionIntoTable({
        voiceJoined: true,
        leavingRoom: false,
        disconnectVoice: true,
      }),
    ).toBe(false);
    expect(
      shouldCarryVoiceSessionIntoTable({
        voiceJoined: false,
        leavingRoom: false,
        disconnectVoice: false,
      }),
    ).toBe(false);
  });

  it('effect cleanup keeps PC while still joined', () => {
    expect(
      shouldDisposeVoiceOnEffectCleanup({
        stillJoined: true,
        intentionalLeave: false,
      }),
    ).toBe(false);
  });

  it('effect cleanup disposes on intentional leave or not joined', () => {
    expect(
      shouldDisposeVoiceOnEffectCleanup({
        stillJoined: true,
        intentionalLeave: true,
      }),
    ).toBe(true);
    expect(
      shouldDisposeVoiceOnEffectCleanup({
        stillJoined: false,
        intentionalLeave: false,
      }),
    ).toBe(true);
  });

  it('module hold starts empty', () => {
    expect(getHeldLobbyVoiceSession()).toBeNull();
  });
});

describe('shouldRecreateHeldLobbyVoiceSession', () => {
  it('keeps brand-new unstarted held session', () => {
    expect(
      shouldRecreateHeldLobbyVoiceSession({
        disposed: false,
        peerLive: false,
        hasPc: false,
        canPublishReady: false,
        started: false,
      }),
    ).toBe(false);
  });

  it('recreates started zombie that cannot publish', () => {
    expect(
      shouldRecreateHeldLobbyVoiceSession({
        disposed: false,
        peerLive: false,
        hasPc: false,
        canPublishReady: false,
        started: true,
      }),
    ).toBe(true);
  });

  it('keeps healthy publishing session', () => {
    expect(
      shouldRecreateHeldLobbyVoiceSession({
        disposed: false,
        peerLive: false,
        hasPc: true,
        canPublishReady: true,
        started: true,
      }),
    ).toBe(false);
  });
});
