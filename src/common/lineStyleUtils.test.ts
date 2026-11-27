import { describe, expect, it } from 'bun:test';

import { dashGradient, dotLength, type LineStyle, lineDash, validLineWidth } from './lineStyleUtils';

// validLineWidth().

describe('validLineWidth()', () => {
  it('keeps a finite and positive line width', () => {
    expect(validLineWidth(1, 2)).toBe(1);
    expect(validLineWidth(0.5, 2)).toBe(0.5);
    expect(validLineWidth(10, 2)).toBe(10);
  });

  it('uses the default line width for a missing, non-finite, zero, or negative line width', () => {
    expect(validLineWidth(undefined, 2)).toBe(2);
    expect(validLineWidth(Number.NaN, 2)).toBe(2);
    expect(validLineWidth(Number.POSITIVE_INFINITY, 2)).toBe(2);
    expect(validLineWidth(0, 2)).toBe(2);
    expect(validLineWidth(-1, 2)).toBe(2);
  });
});

// dotLength().

describe('dotLength()', () => {
  it('is the line width, but at least three pixels', () => {
    expect(dotLength(1)).toBe(3);
    expect(dotLength(2)).toBe(3);
    expect(dotLength(3)).toBe(3);
    expect(dotLength(4)).toBe(4);
    expect(dotLength(10)).toBe(10);
  });
});

// lineDash().

describe('lineDash()', () => {
  it('has no dash pattern for a solid line', () => {
    expect(lineDash('solid', 3)).toEqual([]);
    expect(lineDash(undefined, 3)).toEqual([]);
  });

  it('has the dash pattern of each line style, in dot lengths', () => {
    expect(lineDash('dash', 3)).toEqual([9, 9]);
    expect(lineDash('dot', 3)).toEqual([3, 3]);
    expect(lineDash('dashDot', 3)).toEqual([9, 3, 3, 3]);
    expect(lineDash('dashDotDot', 3)).toEqual([9, 3, 3, 3, 3, 3]);
  });

  it('scales its dash pattern with the length of a dot', () => {
    expect(lineDash('dash', 1)).toEqual([3, 3]);
    expect(lineDash('dashDot', 4)).toEqual([12, 4, 4, 4]);
    expect(lineDash('dot', 1.5)).toEqual([1.5, 1.5]);
  });

  it('draws a solid line for a line style that it does not know about', () => {
    expect(lineDash('none' as LineStyle, 3)).toEqual([]);
    expect(lineDash('toString' as LineStyle, 3)).toEqual([]);
  });
});

// dashGradient().

describe('dashGradient()', () => {
  it('has no gradient for a solid line', () => {
    expect(dashGradient([])).toBe('');
  });

  it('alternates dashes, in the current colour, and gaps', () => {
    expect(dashGradient([6, 6])).toBe(
      'repeating-linear-gradient(to right, currentcolor 0px 6px, transparent 6px 12px)'
    );
    expect(dashGradient([6, 2, 2, 2])).toBe(
      'repeating-linear-gradient(to right, currentcolor 0px 6px, transparent 6px 8px, currentcolor 8px 10px, transparent 10px 12px)'
    );
  });
});
