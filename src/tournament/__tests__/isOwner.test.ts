import { describe, expect, it } from 'vitest';
import {
  OWNER_FORBIDDEN_MESSAGE,
  isOwner,
  requireOwner,
} from '../isOwner';

describe('isOwner', () => {
  it('matches default owner email j0shwa@hotmail.com when env empty', () => {
    expect(
      isOwner({ uid: 'x', email: 'j0shwa@hotmail.com', displayName: null }),
    ).toBe(true);
    expect(
      isOwner({ uid: 'x', email: 'joshuamilliea@icloud.com', displayName: null }),
    ).toBe(false);
    expect(isOwner(null)).toBe(false);
  });

  it('requireOwner throws 403-style message', () => {
    expect(() => requireOwner(null)).toThrow(OWNER_FORBIDDEN_MESSAGE);
  });
});
