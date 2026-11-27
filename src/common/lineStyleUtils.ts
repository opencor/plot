// The line style and line width of our traces (see linearPaths() in PlotWidget.vue). OpenCOR's plotting is based on
// SED-ML, so our line styles are the line types of SED-ML's Line (see
// https://identifiers.org/combine.specifications/sed-ml.level-1.version-4), except for its none line type (since a
// trace without a line would be invisible, unless it has markers) and, like Plotly, our dash patterns scale with our
// line width, so that a thick line looks right.
// Note: our dash patterns are in the same unit as our line width (e.g., CSS pixels), and like Plotly, the length of a
//       dot is our line width, but at least MIN_DOT_LENGTH, so that our dots can be told apart from our dashes.

export type LineStyle = 'solid' | 'dash' | 'dot' | 'dashDot' | 'dashDotDot';

const MIN_DOT_LENGTH = 3; // Like Plotly, the minimum length of a dot (in CSS pixels).

// Like Plotly, the dash pattern of our line styles, in dot lengths.

const DASH_PATTERNS: Record<LineStyle, number[]> = {
  solid: [],
  dash: [3, 3],
  dot: [1, 1],
  dashDot: [3, 1, 1, 1],
  dashDotDot: [3, 1, 1, 1, 1, 1]
};

export const validLineWidth = (lineWidth: number | undefined, defaultLineWidth: number): number => {
  // Return the given line width, if it is valid (i.e. finite and positive), or the given default line width otherwise.

  return lineWidth !== undefined && Number.isFinite(lineWidth) && lineWidth > 0 ? lineWidth : defaultLineWidth;
};

export const dotLength = (lineWidth: number): number => {
  // Return the length of a dot for a line of the given width.

  return Math.max(lineWidth, MIN_DOT_LENGTH);
};

export const lineDash = (lineStyle: LineStyle | undefined, dotLength: number): number[] => {
  // Return the dash pattern of the given line style (or of a solid line if it is not a line style that we know about,
  // e.g., SED-ML's none line type), i.e. the lengths of its dashes and gaps, for the given length of a dot.

  const pattern = lineStyle && Object.hasOwn(DASH_PATTERNS, lineStyle) ? DASH_PATTERNS[lineStyle] : [];

  return pattern.map((length: number) => length * dotLength);
};

export const dashGradient = (dash: number[]): string => {
  // Return a CSS gradient that draws the given dash pattern (in CSS pixels) from left to right, using the current
  // colour, or an empty string for a solid line.

  if (!dash.length) {
    return '';
  }

  const res: string[] = [];
  let position = 0;

  dash.forEach((length: number, index: number) => {
    res.push(`${index % 2 ? 'transparent' : 'currentcolor'} ${position}px ${position + length}px`);

    position += length;
  });

  return `repeating-linear-gradient(to right, ${res.join(', ')})`;
};
