import { describe, expect, it } from 'bun:test';

import { type IValuesStatistics, isContinuationOf, logValues, valuesStatistics } from './traceValues';

// Some helpers.

const view = (buffer: Float64Array, length: number, offset: number = 0): Float64Array => {
  // Return a view of the given buffer, from the given offset and with the given length.

  return buffer.subarray(offset, offset + length);
};

const statistics = (values: number[]): Pick<IValuesStatistics, 'min' | 'max' | 'sorted'> => {
  // Return the statistics that matter of the given values.

  const { min, max, sorted } = valuesStatistics(Float64Array.from(values));

  return { min, max, sorted };
};

const randomGenerator = (seed: number): (() => number) => {
  // Return a deterministic pseudo-random number generator (Mulberry32), so that our tests are reproducible.

  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// isContinuationOf().

describe('isContinuationOf()', () => {
  const buffer = new Float64Array(10);

  it('is false when there are no previous values', () => {
    expect(isContinuationOf(view(buffer, 3), undefined)).toBe(false);
  });

  it('is true for the same values', () => {
    const values = view(buffer, 3);

    expect(isContinuationOf(values, values)).toBe(true);
  });

  it('is true for a view of the same buffer, from the same offset, and at least as long', () => {
    expect(isContinuationOf(view(buffer, 3), view(buffer, 3))).toBe(true);
    expect(isContinuationOf(view(buffer, 5), view(buffer, 3))).toBe(true);
    expect(isContinuationOf(view(buffer, 5, 2), view(buffer, 3, 2))).toBe(true);
  });

  it('is false for a shorter view of the same buffer', () => {
    expect(isContinuationOf(view(buffer, 2), view(buffer, 3))).toBe(false);
  });

  it('is false for a view of the same buffer, but from a different offset', () => {
    expect(isContinuationOf(view(buffer, 5, 1), view(buffer, 3))).toBe(false);
  });

  it('is false for a view of a different buffer, even with the same values', () => {
    expect(isContinuationOf(view(new Float64Array(10), 5), view(buffer, 3))).toBe(false);
  });
});

// valuesStatistics().

describe('valuesStatistics()', () => {
  it('handles no values', () => {
    expect(statistics([])).toEqual({
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      sorted: true
    });
  });

  it('handles one value', () => {
    expect(statistics([3])).toEqual({ min: 3, max: 3, sorted: true });
  });

  it('determines the range of some values and whether they are sorted', () => {
    expect(statistics([1, 2, 3, 4])).toEqual({ min: 1, max: 4, sorted: true });
    expect(statistics([1, 1, 2, 2])).toEqual({ min: 1, max: 2, sorted: true });
    expect(statistics([1, 3, 2, 4])).toEqual({ min: 1, max: 4, sorted: false });
    expect(statistics([4, 3, 2, 1])).toEqual({ min: 1, max: 4, sorted: false });
    expect(statistics([-5, 0, 7.5])).toEqual({ min: -5, max: 7.5, sorted: true });
  });

  it('ignores non-finite values when determining the range of some values', () => {
    expect(statistics([Number.NaN, 2, 3])).toMatchObject({ min: 2, max: 3 });
    expect(statistics([1, Number.NaN, 3])).toMatchObject({ min: 1, max: 3 });
    expect(statistics([1, 2, Number.NaN])).toMatchObject({ min: 1, max: 2 });
    expect(statistics([Number.NEGATIVE_INFINITY, 2, Number.POSITIVE_INFINITY])).toMatchObject({ min: 2, max: 2 });
  });

  it('has an empty range when there are no finite values', () => {
    expect(statistics([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toMatchObject({
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY
    });
  });

  it('considers one value as sorted, even if it is NaN', () => {
    // Note: a value can only be out of order with respect to another value.

    expect(statistics([Number.NaN])).toMatchObject({ sorted: true });
  });

  it('considers NaN values as unsorted', () => {
    expect(statistics([1, Number.NaN, 3])).toMatchObject({ sorted: false });
    expect(statistics([1, 2, Number.NaN])).toMatchObject({ sorted: false });
    expect(statistics([Number.NaN, 2, 3])).toMatchObject({ sorted: false });
  });

  it('considers infinities as sorted when they are in increasing order', () => {
    expect(statistics([Number.NEGATIVE_INFINITY, 1, Number.POSITIVE_INFINITY])).toMatchObject({ sorted: true });
    expect(statistics([Number.POSITIVE_INFINITY, 1])).toMatchObject({ sorted: false });
  });

  it('carries on from the statistics of some previous values, if some values are a continuation of them', () => {
    const buffer = new Float64Array([1, 2, 3, 4, 5, 6]);
    const previous = valuesStatistics(view(buffer, 3));

    expect(valuesStatistics(view(buffer, 6), previous)).toMatchObject({ min: 1, max: 6, sorted: true });
  });

  it('takes into account the last of some previous values having changed', () => {
    const buffer = new Float64Array([1, 2, 3, 4, 5, 6]);
    const previous = valuesStatistics(view(buffer, 3));

    buffer[2] = 9;

    expect(valuesStatistics(view(buffer, 6), previous)).toMatchObject({ min: 1, max: 9, sorted: false });

    buffer[2] = -9;

    expect(valuesStatistics(view(buffer, 3), previous)).toMatchObject({ min: -9, max: 2, sorted: false });
  });

  it('only processes the new values (and the last of the previous values) of a continuation', () => {
    // Note: values before the last of the previous values are not expected to change, so if they do, then our
    //       statistics don't reflect it, which is how we can check that they were not processed again.

    const buffer = new Float64Array([1, 2, 3, 4, 5, 6]);
    const previous = valuesStatistics(view(buffer, 3));

    buffer[0] = 100;

    expect(valuesStatistics(view(buffer, 6), previous)).toMatchObject({ min: 1, max: 6, sorted: true });
  });

  it('processes all the values again if they are not a continuation of the previous ones', () => {
    const buffer = new Float64Array([1, 2, 3, 4, 5, 6]);
    const previous = valuesStatistics(view(buffer, 3));
    const otherBuffer = Float64Array.from(buffer);

    otherBuffer[0] = 100;

    expect(valuesStatistics(view(otherBuffer, 6), previous)).toMatchObject({ min: 2, max: 100, sorted: false });
    expect(valuesStatistics(view(buffer, 1), previous)).toMatchObject({ min: 1, max: 1, sorted: true });
  });

  it('gives the same results incrementally as from scratch', () => {
    // Simulate some live data, i.e. a buffer that gets appended to (by a random number of values at a time) and which
    // last value gets retrieved again (and may therefore change), and check that, at each step, our statistics are
    // the same as those of the same values processed from scratch.

    const random = randomGenerator(123);
    const SPECIAL_VALUES = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (let run = 0; run < 50; ++run) {
      const NB_OF_VALUES = 200;
      const buffer = new Float64Array(NB_OF_VALUES);
      const randomValue = (index: number): number => {
        const r = random();

        if (r < 0.03) {
          return SPECIAL_VALUES[Math.floor(3 * random())] as number;
        }

        // Mostly increasing values, but not always (so that some of our runs are sorted and some are not).

        return run % 2 ? index + (r < 0.05 ? -10 : 0) : index + 10 * r;
      };
      let length = 0;
      let previous: IValuesStatistics | undefined;

      while (length < NB_OF_VALUES) {
        if (length > 0 && random() < 0.5) {
          buffer[length - 1] = randomValue(length - 1);
        }

        const newLength = Math.min(NB_OF_VALUES, length + 1 + Math.floor(10 * random()));

        for (let i = length; i < newLength; ++i) {
          buffer[i] = randomValue(i);
        }

        length = newLength;

        const values = view(buffer, length);
        const incremental = valuesStatistics(values, previous);
        const fromScratch = valuesStatistics(Float64Array.from(values));

        expect({ min: incremental.min, max: incremental.max, sorted: incremental.sorted }).toEqual({
          min: fromScratch.min,
          max: fromScratch.max,
          sorted: fromScratch.sorted
        });

        previous = incremental;
      }
    }
  });
});

// logValues().

describe('logValues()', () => {
  it('returns the base-10 logarithm of some values, with NaN for non-positive values', () => {
    const values = Float64Array.from([1, 10, 1000, 0.01, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]);

    expect(Array.from(logValues(values).values)).toEqual([
      0,
      1,
      3,
      -2,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ]);
  });

  it('uses a buffer with the capacity of the buffer of the values', () => {
    const buffer = new Float64Array(10);
    const res = logValues(view(buffer, 3, 2));

    expect(res.buffer.length).toBe(8);
    expect(res.values.length).toBe(3);
    expect(res.values.buffer).toBe(res.buffer.buffer);
  });

  it('carries on from the logarithm of some previous values, if some values are a continuation of them', () => {
    const buffer = new Float64Array([1, 10, 100, 1000, 10000]);
    const previous = logValues(view(buffer, 2));

    buffer[1] = 1e5; // The last of our previous values may change.

    const res = logValues(view(buffer, 4), previous);

    expect(res.buffer).toBe(previous.buffer);
    expect(Array.from(res.values)).toEqual([0, 5, 2, 3]);
    expect(isContinuationOf(res.values, previous.values)).toBe(true);
  });

  it('only processes the new values (and the last of the previous values) of a continuation', () => {
    // Note: values before the last of the previous values are not expected to change, so if they do, then their
    //       logarithm doesn't reflect it, which is how we can check that they were not processed again.

    const buffer = new Float64Array([1, 10, 100, 1000]);
    const previous = logValues(view(buffer, 2));

    buffer[0] = 1e5;

    expect(Array.from(logValues(view(buffer, 4), previous).values)).toEqual([0, 1, 2, 3]);
  });

  it('uses a new buffer if some values are not a continuation of the previous ones', () => {
    const buffer = new Float64Array([1, 10, 100, 1000]);
    const previous = logValues(view(buffer, 3));
    const shorter = logValues(view(buffer, 2), previous);
    const other = logValues(Float64Array.from(buffer), previous);

    expect(shorter.buffer).not.toBe(previous.buffer);
    expect(Array.from(shorter.values)).toEqual([0, 1]);
    expect(other.buffer).not.toBe(previous.buffer);
    expect(Array.from(other.values)).toEqual([0, 1, 2, 3]);
    expect(isContinuationOf(other.values, previous.values)).toBe(false);
  });
});
