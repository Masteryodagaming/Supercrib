/**
 * Career W/L vs Club Night tournament submit are independent.
 * Refresh/rejoin at gameOver must still submit tournament results even when
 * career guards skip (sawLiveOnlineMatch false / room already recorded).
 */

export function shouldRecordOnlineCareer(opts: {
  sawLiveOnlineMatch: boolean;
  roomAlreadyRecorded: boolean;
}): boolean {
  return opts.sawLiveOnlineMatch && !opts.roomAlreadyRecorded;
}

export function shouldAttemptTournamentSubmit(opts: {
  hasTournamentContext: boolean;
  hasAuth: boolean;
  alreadySubmitted: boolean;
  inFlight: boolean;
  hasScores: boolean;
}): boolean {
  return (
    opts.hasTournamentContext &&
    opts.hasAuth &&
    !opts.alreadySubmitted &&
    !opts.inFlight &&
    opts.hasScores
  );
}
