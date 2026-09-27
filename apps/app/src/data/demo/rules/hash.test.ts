import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, sha256Hex } from './hash';

describe('SHA-256', () => {
  it('liefert die Referenzwerte (FIPS 180-4)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('verarbeitet Umlaute als UTF-8', () => {
    expect(sha256Hex('Ölwechsel')).toHaveLength(64);
    expect(sha256Hex('Ölwechsel')).not.toBe(sha256Hex('Olwechsel'));
  });
});

describe('Kanonisches JSON', () => {
  it('ist unabhängig von der Schlüsselreihenfolge', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(contentHash({ x: [1, 2], y: 'z' })).toBe(contentHash({ y: 'z', x: [1, 2] }));
  });

  it('unterscheidet Reihenfolge in Listen', () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });
});
