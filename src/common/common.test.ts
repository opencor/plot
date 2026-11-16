import { afterEach, beforeEach, describe, expect, it, type Mock, mock, spyOn } from 'bun:test';

import { downloadFile, EMPTY_FLOAT64_ARRAY, formatError, sanitiseHtml, sleep, waitForNextPaint } from './common';

afterEach(() => {
  mock.restore();
});

// Some helpers.

const setTimeoutCalls = (): [callback: () => void, delay: number | undefined][] => {
  // Mock setTimeout() and return the calls that are made to it, so that we can check their delay and run their callback
  // when we want.

  const res: [callback: () => void, delay: number | undefined][] = [];

  spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
    res.push([callback, delay]);

    return 0;
  }) as typeof setTimeout);

  return res;
};

// formatError().

describe('formatError()', () => {
  it('returns the message of an error, or converts anything else to a string', () => {
    expect(formatError(new Error('Something went wrong.'))).toBe('Something went wrong.');
    expect(formatError(123)).toBe('123');
  });
});

// downloadFile().

describe('downloadFile()', () => {
  let createObjectURL: Mock<typeof URL.createObjectURL>;
  let revokeObjectURL: Mock<typeof URL.revokeObjectURL>;
  let clickedLinks: HTMLAnchorElement[];

  beforeEach(() => {
    createObjectURL = spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
    revokeObjectURL = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    clickedLinks = [];

    spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      // Check that our link is in the document when it gets clicked (some browsers require it).

      expect(document.body.contains(this)).toBe(true);

      clickedLinks.push(this);
    });
  });

  it('downloads some text as a file of the given type', async () => {
    downloadFile('data.csv', 'a,b\n1,2\n', 'text/csv');

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toBe('a,b\n1,2\n');
    expect(clickedLinks.length).toBe(1);
    expect(clickedLinks[0]?.href).toBe('blob:url');
    expect(clickedLinks[0]?.download).toBe('data.csv');
    expect(document.body.contains(clickedLinks[0] as Node)).toBe(false);
  });

  it('downloads a blob as is', () => {
    const blob = new Blob(['<svg/>'], { type: 'image/svg+xml' });

    downloadFile('plot.svg', blob, 'text/plain');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('only revokes its object URL once the download has had plenty of time to start', () => {
    const calls = setTimeoutCalls();

    downloadFile('data.csv', '', 'text/csv');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toBe(60000);

    calls[0]?.[0]();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url');
  });
});

// sanitiseHtml().

describe('sanitiseHtml()', () => {
  it('returns some text without any markup or character reference as is', () => {
    expect(sanitiseHtml(undefined)).toBe('');
    expect(sanitiseHtml('')).toBe('');
    expect(sanitiseHtml('Time (s)')).toBe('Time (s)');
  });

  it('keeps character references and escapes special characters', () => {
    expect(sanitiseHtml('a &amp; b')).toBe('a &amp; b');
    expect(sanitiseHtml('a &lt; b')).toBe('a &lt; b');
    expect(sanitiseHtml('a < b')).toBe('a &lt; b');
    expect(sanitiseHtml('&alpha;')).toBe('α');
  });

  it('keeps formatting elements, without their attributes', () => {
    expect(sanitiseHtml('<i>I<sub>K,r</sub></i>')).toBe('<i>I<sub>K,r</sub></i>');
    expect(sanitiseHtml('<b>b</b><br><code>c</code><em>e</em><strong>s</strong><sup>2</sup>')).toBe(
      '<b>b</b><br><code>c</code><em>e</em><strong>s</strong><sup>2</sup>'
    );
    expect(sanitiseHtml('<b style="color: red" onclick="alert(1)">b</b>')).toBe('<b>b</b>');
    expect(sanitiseHtml('<i class="pi pi-cog">i</i>')).toBe('<i>i</i>');
  });

  it('replaces other elements with their contents', () => {
    expect(sanitiseHtml('<span class="x">a <a href="https://example.com">link</a></span>')).toBe('a link');
    expect(sanitiseHtml('<div><p>a <i>b</i></p></div>')).toBe('a <i>b</i>');
  });

  it('removes elements whose contents are not meant to be shown as text', () => {
    expect(sanitiseHtml('a<script>alert(1)</script>b')).toBe('ab');
    expect(sanitiseHtml('a<style>body { color: red; }</style>b')).toBe('ab');
    expect(sanitiseHtml('a<template><b>t</b></template>b')).toBe('ab');
    expect(sanitiseHtml('a<select><option>o</option></select>b')).toBe('ab');
    expect(sanitiseHtml('a<textarea>t</textarea>b')).toBe('ab');
  });

  it('removes comments', () => {
    // Note: happy-dom drops top-level comments when parsing some HTML (unlike browsers), so we use a comment within an
    //       element.

    expect(sanitiseHtml('<b>a<!-- comment -->b</b>')).toBe('<b>ab</b>');
  });

  it('removes elements that could load or run something', () => {
    expect(sanitiseHtml('a<img src="x" onerror="alert(1)">b')).toBe('ab');
    expect(sanitiseHtml('a<svg><circle onload="alert(1)"/></svg>b')).toBe('ab');
  });

  it('caches its results, and clears its cache once it is full', () => {
    const parseFromString = spyOn(DOMParser.prototype, 'parseFromString');

    expect(sanitiseHtml('<b>cached</b>')).toBe('<b>cached</b>');
    expect(sanitiseHtml('<b>cached</b>')).toBe('<b>cached</b>');
    expect(parseFromString).toHaveBeenCalledTimes(1);

    // Fill our cache (which can hold 256 results), so that it gets cleared, and check that our first result is not
    // cached anymore.

    for (let i = 0; i < 256; ++i) {
      sanitiseHtml(`<b>${i}</b>`);
    }

    parseFromString.mockClear();

    expect(sanitiseHtml('<b>cached</b>')).toBe('<b>cached</b>');
    expect(parseFromString).toHaveBeenCalledTimes(1);
  });
});

// sleep().

describe('sleep()', () => {
  it('resolves after the given number of milliseconds', async () => {
    const calls = setTimeoutCalls();
    let resolved = false;
    const promise = sleep(100).then(() => {
      resolved = true;
    });

    await Bun.sleep(0);

    expect(resolved).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toBe(100);

    calls[0]?.[0]();

    await promise;

    expect(resolved).toBe(true);
  });
});

// waitForNextPaint().

describe('waitForNextPaint()', () => {
  const visibilityState = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  };

  afterEach(() => {
    // Remove our own visibility state, so that our document uses its original one again.

    delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
  });

  it('waits for two animation frames', async () => {
    const callbacks: FrameRequestCallback[] = [];

    spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) =>
      callbacks.push(callback)
    );
    spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    let resolved = false;
    const promise = waitForNextPaint().then(() => {
      resolved = true;
    });

    expect(callbacks.length).toBe(1);

    callbacks[0]?.(0);

    await Bun.sleep(0);

    expect(callbacks.length).toBe(2);
    expect(resolved).toBe(false);

    callbacks[1]?.(0);

    await promise;

    expect(resolved).toBe(true);
  });

  it('does not wait if our document is hidden', async () => {
    const requestAnimationFrame = spyOn(globalThis, 'requestAnimationFrame');

    visibilityState('hidden');

    await waitForNextPaint();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('stops waiting if our document gets hidden', async () => {
    const cancelAnimationFrame = spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123);
    visibilityState('visible');

    const promise = waitForNextPaint();

    // A visibility change that doesn't hide our document doesn't stop us from waiting.

    document.dispatchEvent(new Event('visibilitychange'));

    expect(cancelAnimationFrame).not.toHaveBeenCalled();

    visibilityState('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    await promise;

    expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
  });
});

// EMPTY_FLOAT64_ARRAY.

describe('EMPTY_FLOAT64_ARRAY', () => {
  it('is an empty array that cannot be changed', () => {
    expect(EMPTY_FLOAT64_ARRAY).toBeInstanceOf(Float64Array);
    expect(EMPTY_FLOAT64_ARRAY.length).toBe(0);
    expect(Object.isFrozen(EMPTY_FLOAT64_ARRAY)).toBe(true);
  });
});
