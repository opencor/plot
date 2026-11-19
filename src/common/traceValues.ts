// Incremental processing of the values of our traces (see PlotWidget.vue and gpuPlotRenderer.ts).
// Note: our data gets may get updated often (e.g., many times a second while a simulation is running), and typically
//       with a few more values each time. So, rather than process all of our values every time, we check whether they
//       are a continuation of the values we processed before (i.e. a view of the same buffer, from the same offset, and
//       at least as long), in which case we assume that only their last value onwards may have changed (e.g., live data
//       that gets appended to, with its last value retrieved again). This means that processing N new values costs
//       O(N) rather than O(number of values).

export const isContinuationOf = (values: Float64Array, previousValues: Float64Array | undefined): boolean => {
  return (
    previousValues !== undefined &&
    values.buffer === previousValues.buffer &&
    values.byteOffset === previousValues.byteOffset &&
    values.length >= previousValues.length
  );
};

// The statistics of some values, i.e. the range of their finite values.
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

export interface ValuesStatistics {
  values: Float64Array; // The values for which we have statistics.
  prefixLength: number; // Number of values (i.e. all but the last one) covered by our prefix statistics.
  prefixMin: number; // Minimum of the finite values of our prefix (+Infinity if there are none).
  prefixMax: number; // Maximum of the finite values of our prefix (-Infinity if there are none).
  min: number; // Minimum of our finite values (+Infinity if there are none).
  max: number; // Maximum of our finite values (-Infinity if there are none).
}

const scanValues = (values: Float64Array, start: number, end: number): [min: number, max: number] => {
  // Return the minimum and maximum of the given (finite) values between the given start (included) and end (excluded).

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = start; i < end; ++i) {
    const value = values[i] as number;

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  // If our minimum or maximum is not finite, then some of our values are not finite, so determine our minimum and
  // maximum again, ignoring non-finite values.
  // Note: a NaN value makes both our minimum and maximum NaN.

  if (Number.isNaN(min) || min === Number.NEGATIVE_INFINITY || max === Number.POSITIVE_INFINITY) {
    min = Number.POSITIVE_INFINITY;
    max = Number.NEGATIVE_INFINITY;

    for (let i = start; i < end; ++i) {
      const value = values[i] as number;

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

  return [min, max];
};

export const valuesStatistics = (values: Float64Array, previous?: ValuesStatistics): ValuesStatistics => {
  // Return the statistics of the given values, given the statistics of their previous values, if any.

  const continuation = previous !== undefined && isContinuationOf(values, previous.values);
  const length = values.length;
  const prefixLength = Math.max(0, length - 1);
  const start = continuation ? previous.prefixLength : 0;
  let prefixMin = continuation ? previous.prefixMin : Number.POSITIVE_INFINITY;
  let prefixMax = continuation ? previous.prefixMax : Number.NEGATIVE_INFINITY;

  // Process the values of our prefix that we haven't already processed.

  if (start < prefixLength) {
    const [min, max] = scanValues(values, start, prefixLength);

    prefixMin = Math.min(prefixMin, min);
    prefixMax = Math.max(prefixMax, max);
  }

  // Take our last value into account.

  const [lastMin, lastMax] = scanValues(values, prefixLength, length);

  return {
    values,
    prefixLength,
    prefixMin,
    prefixMax,
    min: Math.min(prefixMin, lastMin),
    max: Math.max(prefixMax, lastMax)
  };
};

// The base-10 logarithm of some values, i.e. what we plot along a logarithmic axis.
// Note #1: we keep the logarithm of some values in a buffer. If some values are a continuation of the previous ones,
//          then we only convert their last value onwards, in the same buffer, and we return a view of that buffer.
//          This means that the logarithm of some values is itself a continuation of the logarithm of their previous
//          values, so that their statistics (see valuesStatistics()) and our GPU plot renderer only need to process
//          their new values too.
// Note #2: we create a new buffer whenever some values are not a continuation of the previous ones, so that we never
//          present new values as a continuation of old ones. Also, a new buffer has room for twice as many values as we
//          have (but no more than what is left of the buffer of our values, e.g. live data, which buffer has room for
//          all the data of a simulation run), and it doubles in size when it needs to grow. Growing our buffer means
//          that our logarithm is not a continuation of the previous one anymore (so that whatever uses it has to
//          process all of it again, see Note #1), but this only happens a few times (e.g., during a simulation run) and
//          it avoids allocating much more memory than needed if the buffer of our values is shared (e.g., if the values
//          of all of our traces are views of one big buffer).
// Note #3: a non-positive value has no logarithm, so it becomes NaN (i.e. a gap in a trace).

export interface LogValues {
  source: Float64Array; // The values of which we have the logarithm.
  buffer: Float64Array; // The buffer in which we keep the logarithm of our source values (and, later on, of new ones).
  values: Float64Array; // The logarithm of our source values, i.e. a view of our buffer.
}

export const logValues = (values: Float64Array, previous?: LogValues): LogValues => {
  // Return the logarithm of the given values, given the logarithm of their previous values, if any.

  const nbOfValues = values.length;
  let buffer: Float64Array;
  let start: number;

  const maxCapacity = (values.buffer.byteLength - values.byteOffset) / Float64Array.BYTES_PER_ELEMENT;

  if (previous && isContinuationOf(values, previous.source)) {
    // Our values are a continuation of the previous ones, so only convert their last value onwards, in a bigger buffer
    // if needed (with what we have already converted).

    start = Math.max(0, previous.source.length - 1);

    if (nbOfValues <= previous.buffer.length) {
      buffer = previous.buffer;
    } else {
      buffer = new Float64Array(Math.min(maxCapacity, Math.max(nbOfValues, 2 * previous.buffer.length)));

      buffer.set(previous.buffer.subarray(0, start));
    }
  } else {
    buffer = new Float64Array(Math.min(maxCapacity, Math.max(1, 2 * nbOfValues)));
    start = 0;
  }

  for (let i = start; i < nbOfValues; ++i) {
    const value = values[i] as number;

    buffer[i] = value > 0 ? Math.log10(value) : Number.NaN;
  }

  return { source: values, buffer, values: buffer.subarray(0, nbOfValues) };
};
