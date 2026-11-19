import type { PlotData, PlotTrace } from '../index';

// The kinds of data that our demo can plot, each of which tests a different aspect of our plot:
//  - smooth: sine waves, i.e. what level of detail must draw faithfully;
//  - noisy: sine waves with some noise, i.e. the worst case for drawing many points;
//  - steps: staircases, i.e. near-vertical edges;
//  - gaps: sine waves with some non-finite values, i.e. gaps that must be drawn as such (and which prevent level of
//    detail from being used for the visible points that contain them);
//  - unsorted: Lissajous curves, i.e. X values that are not sorted (so neither the culling of invisible points nor
//    level of detail can be used);
//  - largeOffsets: sine waves with timestamp-like X values and large Y values, i.e. values that WebGL (and its 32-bit
//    floats) cannot draw precisely once zoomed in a lot, in which case Canvas 2D gets used instead.

export type DataKind = 'smooth' | 'noisy' | 'steps' | 'gaps' | 'unsorted' | 'largeOffsets';

export const DATA_KINDS: Record<DataKind, string> = {
  smooth: 'Smooth',
  noisy: 'Noisy',
  steps: 'Steps',
  gaps: 'Gaps',
  unsorted: 'Unsorted X',
  largeOffsets: 'Large offsets'
};

const X_MAX = 10; // Last X value of our sorted data (whose first X value is 0), whatever our number of points.
const NB_OF_PERIODS = 5; // Number of periods of our curves, whatever our number of points.
const GAP_PERIOD = 0.1; // Fraction of our points between the start of two consecutive gaps.
const GAP_LENGTH = 0.01; // Fraction of our points that each gap spans.
const LARGE_X_OFFSET = 1e9; // First X value of our large-offset data, e.g. a number of seconds since 1970.
const LARGE_X_STEP = 1e-3; // Step between two X values of our large-offset data, e.g. one millisecond.
const LARGE_Y_OFFSET = 1e6; // Value around which the Y values of our large-offset data oscillate.
const NB_OF_SCALES = 4; // Number of scales of the Y values of our instances, i.e. 1, 10, 100, and 1,000.

const random = (seed: number): (() => number) => {
  // Return a seeded pseudo-random number generator (mulberry32), so that our data is the same every time.

  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const traceColor = (index: number): string => {
  // Return the colour of the given trace, i.e. one of Tableau 10's colours for our first ten traces, and then colours
  // that are spread around the colour wheel (using the golden angle).

  const TABLEAU_10 = [
    '#4e79a7',
    '#f28e2b',
    '#e15759',
    '#76b7b2',
    '#59a14f',
    '#edc948',
    '#b07aa1',
    '#ff9da7',
    '#9c755f',
    '#bab0ac'
  ];

  return TABLEAU_10[index] ?? `hsl(${Math.round((index * 137.508) % 360)} 60% 50%)`;
};

const xValues = (kind: DataKind, nbOfPoints: number): Float64Array => {
  // Return the X values of our (sorted) data.

  const res = new Float64Array(nbOfPoints);
  const step = kind === 'largeOffsets' ? LARGE_X_STEP : X_MAX / Math.max(1, nbOfPoints - 1);
  const offset = kind === 'largeOffsets' ? LARGE_X_OFFSET : 0;

  for (let i = 0; i < nbOfPoints; ++i) {
    res[i] = offset + i * step;
  }

  return res;
};

const yValues = (kind: DataKind, nbOfPoints: number, phase: number, seed: number, scale: number): Float64Array => {
  // Return the Y values of our (sorted) data, i.e. NB_OF_PERIODS periods of a curve (scaled by the given scale),
  // whatever our number of points.

  const res = new Float64Array(nbOfPoints);
  const angleStep = (2 * Math.PI * NB_OF_PERIODS) / Math.max(1, nbOfPoints - 1);
  const nextRandom = random(seed);

  for (let i = 0; i < nbOfPoints; ++i) {
    const value = Math.sin(i * angleStep + phase);

    if (kind === 'noisy') {
      res[i] = scale * (value + 0.3 * (nextRandom() - 0.5));
    } else if (kind === 'steps') {
      res[i] = (scale * Math.round(3 * value)) / 3;
    } else if (kind === 'largeOffsets') {
      res[i] = LARGE_Y_OFFSET + scale * value;
    } else {
      res[i] = scale * value;
    }
  }

  // Add some gaps, if needed, making sure that there is at least one of them.

  if (kind === 'gaps') {
    const gapPeriod = Math.max(2, Math.round(GAP_PERIOD * nbOfPoints));
    const gapLength = Math.max(1, Math.round(GAP_LENGTH * nbOfPoints));

    for (let gapStart = Math.floor(0.5 * gapPeriod); gapStart < nbOfPoints; gapStart += gapPeriod) {
      res.fill(Number.NaN, gapStart, Math.min(nbOfPoints, gapStart + gapLength));
    }
  }

  return res;
};

const lissajousValues = (nbOfPoints: number, phase: number, scale: number): [Float64Array, Float64Array] => {
  // Return the X and Y values of a Lissajous curve (with its Y values scaled by the given scale), i.e. a curve which X
  // values are not sorted.

  const x = new Float64Array(nbOfPoints);
  const y = new Float64Array(nbOfPoints);
  const angleStep = (2 * Math.PI) / Math.max(1, nbOfPoints - 1);

  for (let i = 0; i < nbOfPoints; ++i) {
    x[i] = Math.sin(3 * i * angleStep + phase);
    y[i] = scale * Math.sin(4 * i * angleStep);
  }

  return [x, y];
};

const AXIS_TITLES: Record<DataKind, [x: string, y: string]> = {
  smooth: ['Time (<i>s</i>)', 'Signal'],
  noisy: ['Time (<i>s</i>)', 'Signal'],
  steps: ['Time (<i>s</i>)', 'Level'],
  gaps: ['Time (<i>s</i>)', 'Signal'],
  unsorted: ['sin(3<i>t</i>)', 'sin(4<i>t</i>)'],
  largeOffsets: ['Time since 1970 (<i>s</i>)', 'Signal']
};

export const plotData = (kind: DataKind, nbOfTraces: number, nbOfPoints: number, instance: number): PlotData => {
  // Return the data of the given instance of our plot, which is different for each instance (since its curves have a
  // different phase and its noise a different seed). Also, the Y values of our instances have different scales (i.e.
  // 1, 10, 100, and 1,000, over and over), so that their Y tick labels have different widths and therefore their plots
  // have different natural margins (see our shared margins in App.vue).
  // Note: our traces share their X values, if possible, to save memory.

  const x = kind === 'unsorted' ? undefined : xValues(kind, nbOfPoints);
  const scale = 10 ** (instance % NB_OF_SCALES);
  const traces: PlotTrace[] = [];

  for (let i = 0; i < nbOfTraces; ++i) {
    const phase = (2 * Math.PI * i) / nbOfTraces + 0.37 * instance;
    const [traceX, traceY] = x
      ? [x, yValues(kind, nbOfPoints, phase, 1000 * instance + i, scale)]
      : lissajousValues(nbOfPoints, phase, scale);
    const name = `Trace #${i + 1}`;

    traces.push({ name, xValue: 'x', x: traceX, yValue: name, y: traceY, color: traceColor(i) });
  }

  const [xAxisTitle, yAxisTitle] = AXIS_TITLES[kind];

  return { xAxisTitle, yAxisTitle, traces };
};
