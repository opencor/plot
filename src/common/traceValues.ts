import type * as math from './math';

// Incremental processing of the values of our traces (see GraphPanelWidget.vue and gpuPlotRenderer.ts).
// Note: our data gets may get updated often (e.g., many times a second while a simulation is running), and typically
//       with a few more values each time. So, rather than process all of our values every time, we check whether they
//       are a continuation of the values we processed before (i.e. a view of the same buffer, from the same offset, and
//       at least as long), in which case we assume that only their last value onwards may have changed (e.g., live data
//       that gets appended to, with its last value retrieved again). This means that processing N new values costs
//       O(N) rather than O(number of values).

export const isContinuationOf = (values: math.FloatArray, previousValues: math.FloatArray | undefined): boolean => {
  return (
    previousValues !== undefined &&
    values.buffer === previousValues.buffer &&
    values.byteOffset === previousValues.byteOffset &&
    values.length >= previousValues.length
  );
};

// The statistics of some values, i.e. the range of their finite values and whether they are sorted in increasing order.
// Note #1: we ignore non-finite values (rather than let uPlot determine the range of our data) since a NaN value would
//          make our range NaN (e.g., if a trace starts with a NaN value, uPlot never moves away from it).
// Note #2: if some values are a continuation of the previous ones, then we only need to look at their new values (and
//          at their last value, which may have changed). So, we keep track of the statistics of all the values but the
//          last one (i.e. of the values that cannot change), so that we can carry on from there.
// Note #3: new values (e.g., all of them when plotting new data) get processed in a single pass, which uses Math.min()
//          and Math.max() since, in V8, they are several times faster than comparing values that have been checked to
//          be finite. However, they propagate NaN values and infinities, so if the minimum or maximum that we get is
//          not finite, then we determine them again, ignoring non-finite values. Also, our pass only uses local
//          variables since V8 cannot keep the variables of a closure in registers.

export interface IValuesStatistics {
  values: math.FloatArray; // The values for which we have statistics.
  prefixLength: number; // Number of values (i.e. all but the last one) covered by our prefix statistics.
  prefixMin: number; // Minimum of the finite values of our prefix (+Infinity if there are none).
  prefixMax: number; // Maximum of the finite values of our prefix (-Infinity if there are none).
  prefixSortedLength: number; // Number of leading values (within our prefix) that are sorted in increasing order.
  min: number; // Minimum of our finite values (+Infinity if there are none).
  max: number; // Maximum of our finite values (-Infinity if there are none).
  sorted: boolean; // Whether all of our values are sorted in increasing order (false if one of several values is NaN).
}

const scanValues = (
  values: math.FloatArray,
  start: number,
  end: number,
  sortedLength: number
): [min: number, max: number, sortedLength: number] => {
  // Return the minimum and maximum of the given (finite) values between the given start (included) and end (excluded),
  // and the number of leading values that are sorted in increasing order, given the number of leading values (before
  // our start) that we already know are sorted.
  // Note: we negate our comparison so that NaN values (for which all comparisons are false) mean unsorted values.

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let newSortedLength = sortedLength;
  let sorting = sortedLength === start;
  let previous = start > 0 ? (values[start - 1] as number) : Number.NaN;
  let i = start;

  if (i === 0 && i < end) {
    // Our first value is always sorted.

    previous = values[0] as number;
    min = previous;
    max = previous;

    if (sorting) {
      newSortedLength = 1;
    }

    ++i;
  }

  for (; i < end; ++i) {
    const value = values[i] as number;

    min = Math.min(min, value);
    max = Math.max(max, value);

    if (sorting) {
      if (value >= previous) {
        newSortedLength = i + 1;
      } else {
        sorting = false;
      }
    }

    previous = value;
  }

  // If our minimum or maximum is not finite, then some of our values are not finite, so determine our minimum and
  // maximum again, ignoring non-finite values.
  // Note: a NaN value makes both our minimum and maximum NaN.

  if (Number.isNaN(min) || min === Number.NEGATIVE_INFINITY || max === Number.POSITIVE_INFINITY) {
    min = Number.POSITIVE_INFINITY;
    max = Number.NEGATIVE_INFINITY;

    for (let j = start; j < end; ++j) {
      const value = values[j] as number;

      if (Number.isFinite(value)) {
        if (value < min) {
          min = value;
        }

        if (value > max) {
          max = value;
        }
      }
    }
  }

  return [min, max, newSortedLength];
};

export const valuesStatistics = (values: math.FloatArray, previous?: IValuesStatistics): IValuesStatistics => {
  // Return the statistics of the given values, given the statistics of their previous values, if any.

  const continuation = previous !== undefined && isContinuationOf(values, previous.values);
  const length = values.length;
  const prefixLength = Math.max(0, length - 1);
  const start = continuation ? previous.prefixLength : 0;
  let prefixMin = continuation ? previous.prefixMin : Number.POSITIVE_INFINITY;
  let prefixMax = continuation ? previous.prefixMax : Number.NEGATIVE_INFINITY;
  let prefixSortedLength = continuation ? previous.prefixSortedLength : 0;

  // Process the values of our prefix that we haven't already processed.

  if (start < prefixLength) {
    const [min, max, sortedLength] = scanValues(values, start, prefixLength, prefixSortedLength);

    prefixMin = Math.min(prefixMin, min);
    prefixMax = Math.max(prefixMax, max);
    prefixSortedLength = sortedLength;
  }

  // Take our last value into account.

  const [lastMin, lastMax, sortedLength] = scanValues(values, prefixLength, length, prefixSortedLength);

  return {
    values,
    prefixLength,
    prefixMin,
    prefixMax,
    prefixSortedLength,
    min: Math.min(prefixMin, lastMin),
    max: Math.max(prefixMax, lastMax),
    sorted: sortedLength === length
  };
};

// The base-10 logarithm of some values, i.e. what we plot along a logarithmic axis.
// Note #1: we keep the logarithm of some values in a buffer. If some values are a continuation of the previous ones,
//          then we only convert their last value onwards, in the same buffer, and we return a view of that buffer.
//          This means that the logarithm of some values is itself a continuation of the logarithm of their previous
//          values, so that their statistics (see valuesStatistics()) and our GPU plot renderer only need to process
//          their new values too.
// Note #2: we create a new buffer whenever some values are not a continuation of the previous ones, so that we never
//          present new values as a continuation of old ones. Also, a new buffer has the capacity of the buffer of the
//          values (e.g., live data, which buffer has room for all the data of a simulation run), so that it never needs
//          to grow (which would require all of our values to be processed again).
// Note #3: a non-positive value has no logarithm, so it becomes NaN (i.e. a gap in a trace).

export interface ILogValues {
  source: math.FloatArray; // The values of which we have the logarithm.
  buffer: Float64Array; // The buffer in which we keep the logarithm of our source values (and, later on, of new ones).
  values: math.FloatArray; // The logarithm of our source values, i.e. a view of our buffer.
}

export const logValues = (values: math.FloatArray, previous?: ILogValues): ILogValues => {
  // Return the logarithm of the given values, given the logarithm of their previous values, if any.

  const nbOfValues = values.length;
  let buffer: Float64Array;
  let start: number;

  if (previous && isContinuationOf(values, previous.source) && nbOfValues <= previous.buffer.length) {
    buffer = previous.buffer;
    start = Math.max(0, previous.source.length - 1);
  } else {
    buffer = new Float64Array(
      Math.max(nbOfValues, (values.buffer.byteLength - values.byteOffset) / Float64Array.BYTES_PER_ELEMENT)
    );
    start = 0;
  }

  for (let i = start; i < nbOfValues; ++i) {
    const value = values[i] as number;

    buffer[i] = value > 0 ? Math.log10(value) : Number.NaN;
  }

  return { source: values, buffer, values: buffer.subarray(0, nbOfValues) };
};
