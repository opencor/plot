export const cssColor = (color: string, element: Element): string => {
  // Resolve the given colour if it is a CSS variable (e.g., "var(--theme-grid-color)"), so that it can be used on a
  // canvas. The CSS variable is resolved for the given element, i.e. where it is defined or inherited.
  // Note: this must only be called from a browser since it uses the DOM.

  const cssVariable = /^var\((--[\w-]+)\)$/.exec(color)?.[1];

  return cssVariable ? getComputedStyle(element).getPropertyValue(cssVariable).trim() || color : color;
};
