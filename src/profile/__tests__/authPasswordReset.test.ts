import { describe, it, expect } from 'vitest';
import { formatAuthError } from '../auth';

describe('formatAuthError — password reset / email auth', () => {
  it('maps invalid-email for reset feedback', () => {
    expect(formatAuthError({ code: 'auth/invalid-email', message: 'x' })).toMatch(
      /invalid/i,
    );
  });

  it('maps user-not-found for reset feedback', () => {
    expect(formatAuthError({ code: 'auth/user-not-found', message: 'x' })).toMatch(
      /no account found/i,
    );
  });

  it('maps missing-email', () => {
    expect(formatAuthError({ code: 'auth/missing-email', message: 'x' })).toMatch(
      /enter your email/i,
    );
  });

  it('points wrong-password at Forgot password', () => {
    expect(formatAuthError({ code: 'auth/wrong-password', message: 'x' })).toMatch(
      /forgot password/i,
    );
  });

  it('points invalid-credential at Forgot password', () => {
    expect(formatAuthError({ code: 'auth/invalid-credential', message: 'x' })).toMatch(
      /forgot password/i,
    );
  });
});
