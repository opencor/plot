export const cssColor = (color: string): string => {
  // Resolve the given colour if it is a CSS variable (e.g., "var(--p-surface-200)"), so that it can be used on a
  // canvas.
  // Note: this must only be called from our renderer since it uses the DOM.

  const cssVariable = /^var\((--[\w-]+)\)$/.exec(color)?.[1];

  return cssVariable ? getComputedStyle(document.documentElement).getPropertyValue(cssVariable).trim() || color : color;
};
