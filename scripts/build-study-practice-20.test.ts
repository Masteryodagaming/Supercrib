/**
 * Generates scripts/study-practice-20.json from seeded offline Practice 20 sim.
 * Run: npx vitest run scripts/build-study-practice-20.test.ts
 */
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  writeStudyPractice20Artifacts,
  buildStudyPractice20,
  STUDY_JOIN_CODE,
  STUDY_TOURNAMENT_ID,
  STUDY_OWNER_UID,
} from './build-study-practice-20';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

describe('build Study · Practice 20 Firebase payload', () => {
  it('writes JSON with expected podium (Casey / Jordan / Parker / Sam)', () => {
    const { summary, doc } = writeStudyPractice20Artifacts(scriptsDir);

    expect(summary.podium.first).toBe('AI Casey');
    expect(summary.podium.second).toBe('AI Jordan');
    expect(summary.podium.third).toBe('AI Parker');
    expect(summary.podium.fourth).toBe('AI Sam');

    expect(doc.meta.name).toBe('Study · Practice 20');
    expect(doc.meta.status).toBe('complete');
    expect(doc.meta.phase).toBe('complete');
    expect(doc.meta.hostUserId).toBe(STUDY_OWNER_UID);
    expect(doc.meta.joinCode).toBe(STUDY_JOIN_CODE);
    expect(doc.meta.id).toBe(STUDY_TOURNAMENT_ID);
    expect(doc.meta.playoffAdvanceCount).toBe(8);
    expect(doc.meta.currentRound).toBe(19);
    expect(doc.meta.totalRounds).toBe(19);
    expect(doc.meta.pairingsLocked).toBe(true);
    expect(doc.meta.scoringVersion).toBe(2);
    expect(Object.keys(doc.players)).toHaveLength(20);
    expect(Object.keys(doc.rounds)).toHaveLength(19);
    expect(doc.playoffs?.status).toBe('complete');
    expect(doc.joinRequests).toEqual({});

    // Players with podium places
    expect(doc.players[summary.podium.firstId].place).toBe(1);
    expect(doc.players[summary.podium.secondId].place).toBe(2);
    expect(doc.players[summary.podium.thirdId].place).toBe(3);
    expect(doc.players[summary.podium.fourthId].place).toBe(4);
    expect(doc.players[STUDY_OWNER_UID].displayName).toBe('Joshwa Milliea');
    expect(doc.players[STUDY_OWNER_UID].seat).toBe(0);

    // File on disk
    const raw = JSON.parse(
      readFileSync(join(scriptsDir, 'study-practice-20.json'), 'utf8'),
    );
    expect(raw.meta.joinCode).toBe(STUDY_JOIN_CODE);
    expect(raw.playoffs.status).toBe('complete');

    // Re-run is deterministic
    const again = buildStudyPractice20({ nowMs: doc.meta.createdAt });
    expect(again.summary.podium).toEqual(summary.podium);
    expect(again.summary.rrTop8.map((r) => r.userId)).toEqual(
      summary.rrTop8.map((r) => r.userId),
    );
  });
});
