import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, CLIENT_ERROR_CODES, apiCodeFromDomain, isApiErrorCode, isApprovalOutdatedCode } from './errors';

describe('Fehlercodes', () => {
  it('sind klein geschrieben mit Unterstrich und eindeutig', () => {
    const values = Object.values(API_ERROR_CODES);
    for (const v of values) expect(v).toMatch(/^[a-z][a-z_]*[a-z]$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it('trennt Client-Codes von API-Codes', () => {
    for (const v of Object.values(CLIENT_ERROR_CODES)) expect(isApiErrorCode(v)).toBe(false);
  });

  it('übernimmt Domain-Codes in API-Schreibweise', () => {
    expect(apiCodeFromDomain('VERSION_SUPERSEDED')).toBe(API_ERROR_CODES.versionSuperseded);
    expect(apiCodeFromDomain('ODOMETER_REQUIRED')).toBe(API_ERROR_CODES.odometerRequired);
    expect(isApiErrorCode(apiCodeFromDomain('HASH_MISMATCH'))).toBe(true);
  });

  it('erkennt eine veraltete Freigabefassung', () => {
    expect(isApprovalOutdatedCode('version_superseded')).toBe(true);
    expect(isApprovalOutdatedCode('hash_mismatch')).toBe(true);
    expect(isApprovalOutdatedCode('already_decided')).toBe(false);
  });
});
