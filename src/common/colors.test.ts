import { afterEach, describe, expect, it } from 'bun:test';

import { cssColor } from './colors';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cssColor()', () => {
  it('returns a colour that is not a CSS variable as is', () => {
    const element = document.createElement('div');

    expect(cssColor('#4e79a7', element)).toBe('#4e79a7');
    expect(cssColor('rgb(1, 2, 3)', element)).toBe('rgb(1, 2, 3)');
    expect(cssColor('var(--color, red)', element)).toBe('var(--color, red)');
  });

  it('resolves a CSS variable for the given element', () => {
    // Note: happy-dom doesn't support the inheritance of CSS variables, so we define them on the elements themselves
    //       (their inheritance is the job of the browser, not of cssColor()).

    document.body.innerHTML = '<b style="--color: #123456"></b><i style="--color:  #abcdef  "></i>';

    expect(cssColor('var(--color)', document.querySelector('b') as Element)).toBe('#123456');
    expect(cssColor('var(--color)', document.querySelector('i') as Element)).toBe('#abcdef');
  });

  it('returns a CSS variable as is if it is not defined', () => {
    document.body.innerHTML = '<div></div>';

    expect(cssColor('var(--undefined-color)', document.querySelector('div') as Element)).toBe('var(--undefined-color)');
  });
});
