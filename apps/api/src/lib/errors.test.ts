/**
 * Die API sendet nur Fehlercodes aus packages/contracts/src/errors.ts (gemeinsame Liste für
 * API und App). Geprüft wird statisch:
 * 1. Kein Fehleraufruf in apps/api/src verwendet einen frei geschriebenen Code.
 * 2. Jeder fachliche Domain-Code, den die API kleingeschrieben weitergibt, steht in der Liste.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, apiCodeFromDomain, isApiErrorCode } from '@werkstatt/contracts';

const here = fileURLToPath(new URL('.', import.meta.url));
const apiSrc = join(here, '..');
const domainSrc = join(here, '../../../../packages/domain/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('Fehlercodes der API', () => {
  it('verwendet in Fehleraufrufen nur Konstanten aus @werkstatt/contracts', () => {
    const literal = /(new HttpError\(\s*\d+,\s*|conflict\(\s*|unprocessable\(\s*|errorBody\(\s*|, undefined, )'([a-z_]+)'/g;
    const offenders: string[] = [];
    for (const file of sourceFiles(apiSrc)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(literal)) offenders.push(`${file.replace(apiSrc, '')}: ${m[2]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('kennt alle fachlichen Domain-Codes, die die API weitergibt', () => {
    const codes = new Set<string>();
    const patterns = [/fail\('([A-Z_]+)'/g, /code: '([A-Z_]+)'/g];
    for (const file of sourceFiles(domainSrc)) {
      const text = readFileSync(file, 'utf8');
      for (const p of patterns) for (const m of text.matchAll(p)) codes.add(m[1]!);
      // Code-Unionen wie `export type XCode = 'A' | 'B'`
      for (const m of text.matchAll(/export type \w*(?:Code|Reason)\w* =([^;]+);/g)) {
        for (const c of m[1]!.matchAll(/'([A-Z_]+)'/g)) codes.add(c[1]!);
      }
    }
    // Ablehnungsgründe (DenyReason) gibt die API nur als Meldung mit 403/404 weiter, nicht als Code.
    const denyReasons = new Set(['NO_CUSTOMER_LINK', 'NOT_OWN_RECORD', 'NOT_CURRENT_OWNER', 'NOT_ASSIGNED', 'INTERNAL_ONLY', 'NOT_PUBLISHED', 'DRAFT', 'ROLE_NOT_ALLOWED', 'ITEM_NOT_AUTHORIZED', 'WORK_ORDER_NOT_ACTIVE']);
    // Interne Abgleichsgründe (SumUp, Serviceeinträge) werden nur protokolliert, nie gesendet.
    const internal = (c: string) =>
      /MISMATCH$|TRANSACTION|MERCHANT_NOT_CONFIGURED|^(PAID|PENDING|FAILED|EXPIRED|CANCELLED|SUCCESSFUL|UNKNOWN_STATUS)$|^(OTHER_WORK_ORDER|NO_MAINTENANCE_TYPE|UNKNOWN_MAINTENANCE_TYPE|NOT_DONE|ALREADY_RECORDED|WORK_ORDER_NOT_COMPLETED)$|^(NOT_CANONICAL|DIVISION_BY_ZERO|INVALID_APPROVAL_CONTENT|INVALID_(DATE|DATETIME|NUMBER|QUANTITY|PRICE|RATE|TIME|TIMESTAMP|INTERVAL|VAT_RATE))$|^PENDING_APPROVAL_ITEMS$|^AMOUNT_TOO_LARGE$/.test(c);
    const missing = [...codes].filter((c) => !denyReasons.has(c) && !internal(c) && !isApiErrorCode(apiCodeFromDomain(c)));
    expect(missing).toEqual([]);
  });

  it('enthält die in der Übergabe genannten Vertragscodes', () => {
    expect(API_ERROR_CODES.odometerRequired).toBe('odometer_required');
    expect(API_ERROR_CODES.approvalRequired).toBe('approval_required');
    expect(API_ERROR_CODES.shareExpired).toBe('share_expired');
    expect(API_ERROR_CODES.schedulingConflicts).toBe('scheduling_conflicts');
  });
});
