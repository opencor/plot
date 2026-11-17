// Access to the WebGL context of our GPU plot renderer, so that we can simulate its loss (e.g., when the GPU gets
// reset) and its restoration.
// Note #1: our GPU plot renderer creates its WebGL context privately, so we get hold of it by wrapping
//          HTMLCanvasElement.prototype.getContext(), which works since our GPU plot renderer is the only one to create
//          a WebGL 2 context in our demo.
// Note #2: we get the WEBGL_lose_context extension as soon as our WebGL context gets created since getExtension()
//          returns null once our WebGL context is lost.

type GetContext = (this: HTMLCanvasElement, contextId: string, options?: unknown) => RenderingContext | null;

const getContext = HTMLCanvasElement.prototype.getContext as unknown as GetContext;
let loseContextExtension: WEBGL_lose_context | null = null; // Extension of our WebGL context, if it has been created.
let contextLost = false; // Whether we have lost our WebGL context.

HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  contextId: string,
  options?: unknown
): RenderingContext | null {
  const res = getContext.call(this, contextId, options);

  if (contextId === 'webgl2' && res) {
    loseContextExtension ??= (res as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
  }

  return res;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

export const loseWebGlContext = (): boolean => {
  // Lose our WebGL context, if it has been created and is not already lost, and return whether we did.

  if (!loseContextExtension || contextLost) {
    return false;
  }

  loseContextExtension.loseContext();

  contextLost = true;

  return true;
};

export const restoreWebGlContext = (): void => {
  // Restore our WebGL context, if we lost it.

  if (!loseContextExtension || !contextLost) {
    return;
  }

  loseContextExtension.restoreContext();

  contextLost = false;
};
