import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, type ColorScheme } from './index';

const schemes: ColorScheme[] = ['light', 'dark'];

describe('Farbkontraste (WCAG AA)', () => {
  for (const scheme of schemes) {
    const c = colors[scheme];
    it(`${scheme}: Text auf Flächen ≥ 4.5:1`, () => {
      for (const bg of [c.bg, c.surface, c.surfaceRaised]) {
        expect(contrastRatio(c.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.textSubtle, c.surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${scheme}: Text auf Akzent ≥ 4.5:1`, () => {
      expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${scheme}: Statusfarben auf ihren hellen Flächen ≥ 4.5:1`, () => {
      expect(contrastRatio(c.success, c.successSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.warning, c.warningSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.danger, c.dangerSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.info, c.infoSoft)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${scheme}: Akzent und Fokus auf Flächen ≥ 3:1 (Bedienelemente)`, () => {
      expect(contrastRatio(c.accent, c.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.accent, c.accentSoft)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
