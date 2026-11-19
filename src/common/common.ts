// A method to format an error into a string.

export const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

// A method to trigger a browser download for a file.

const DOWNLOAD_OBJECT_URL_LIFETIME = 60000; // 60 seconds.

export const downloadFile = (filename: string, content: string | Blob, type: string): void => {
  const link = document.createElement('a');
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  // Revoke our object URL, but only once the download has started.
  // Note: some browsers start the download asynchronously, so revoking our object URL straight away may cancel it. In
  //       Safari, this may even be once the user has allowed downloads from our site (it asks the first time a site
  //       downloads a file), so we give the user plenty of time to do so (like FileSaver.js does).

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, DOWNLOAD_OBJECT_URL_LIFETIME);
};

// A method to sanitise some HTML that may come from an untrusted source (e.g., the name of a trace or the title of an
// axis), so that it can be rendered as HTML (e.g., using v-html).
// Note #1: only a few formatting elements are kept (e.g., "<i>I<sub>K,r</sub></i>"), without any of their attributes.
//          Any other element is replaced with its contents, unless its contents are not meant to be shown as text
//          (e.g., a script), in which case it is removed altogether.
// Note #2: our HTML is parsed in a separate document, so that nothing in it gets loaded or run (e.g., an image).
// Note #3: the same HTML tends to be sanitised over and over again (e.g., the name of a trace each time the legend of a
//          plot is rendered), so we cache our results.

const SANITISE_HTML_ALLOWED_ELEMENTS = new Set<string>(['b', 'br', 'code', 'em', 'i', 'strong', 'sub', 'sup']);
const SANITISE_HTML_REMOVED_ELEMENTS = new Set<string>([
  'embed',
  'iframe',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'template',
  'textarea',
  'title'
]);
const SANITISE_HTML_CACHE_SIZE = 256;

const sanitiseHtmlCache = new Map<string, string>();

const sanitiseHtmlNode = (node: Node, parent: Node, document: Document): void => {
  for (const childNode of Array.from(node.childNodes)) {
    if (childNode.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(childNode.textContent ?? ''));
    } else if (childNode.nodeType === Node.ELEMENT_NODE) {
      const element = childNode as Element;
      const elementName = element.localName;

      if (SANITISE_HTML_ALLOWED_ELEMENTS.has(elementName)) {
        const sanitisedElement = document.createElement(elementName);

        sanitiseHtmlNode(element, sanitisedElement, document);

        parent.appendChild(sanitisedElement);
      } else if (!SANITISE_HTML_REMOVED_ELEMENTS.has(elementName)) {
        sanitiseHtmlNode(element, parent, document);
      }
    }
  }
};

export const sanitiseHtml = (html: string | undefined): string => {
  // Some text without any markup or character reference is already safe.

  if (!html || !/[<&]/.test(html)) {
    return html ?? '';
  }

  const cachedSanitisedHtml = sanitiseHtmlCache.get(html);

  if (cachedSanitisedHtml !== undefined) {
    return cachedSanitisedHtml;
  }

  const document = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');

  sanitiseHtmlNode(document.body, container, document);

  const res = container.innerHTML;

  if (sanitiseHtmlCache.size >= SANITISE_HTML_CACHE_SIZE) {
    sanitiseHtmlCache.clear();
  }

  sanitiseHtmlCache.set(html, res);

  return res;
};

// A method to sleep for a number of milliseconds.
// Note: sleeping for NO_DELAY milliseconds lets the browser handle whatever it has to (e.g., events) before we resume.

export const NO_DELAY: number = 0;

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

// A method to wait for our UI to be painted.
// Note #1: we wait for two animation frames since the first one is just before the next paint while the second one is
//          after it (i.e. just before the following paint).
// Note #2: there is no need to wait for vue.nextTick() first since Vue updates the DOM in a microtask, i.e. before the
//          next animation frame.
// Note #3: no animation frames are run while our document is hidden (e.g., when our window is minimised), in which case
//          there is nothing to paint for people to see, so we don't wait (or stop waiting) for our UI to be painted.
//          Otherwise, we would wait until our document is visible again (e.g., a simulation run would only finish
//          once our window is restored).

const waitForNextAnimationFrameUnlessHidden = (): Promise<void> => {
  return new Promise((resolve) => {
    if (document.visibilityState === 'hidden') {
      resolve();

      return;
    }

    const onDone = (): void => {
      cancelAnimationFrame(frame);

      document.removeEventListener('visibilitychange', onVisibilityChange);

      resolve();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        onDone();
      }
    };

    const frame = requestAnimationFrame(onDone);

    document.addEventListener('visibilitychange', onVisibilityChange);
  });
};

export const waitForNextPaint = async (): Promise<void> => {
  await waitForNextAnimationFrameUnlessHidden();
  await waitForNextAnimationFrameUnlessHidden();
};

// Some methods to request (and cancel) a call to a callback before the next repaint, like requestAnimationFrame() (and
// cancelAnimationFrame()), except that all of our callbacks get called from the same animation frame callback.
// Note #1: this means that the microtasks that our callbacks queue (e.g., to redraw a plot, which uPlot does in a
//          microtask) only get run once all of our callbacks have been called, rather than after each of them, so that
//          the work that gets done in those microtasks can be batched (e.g., our GPU plot renderer only waits for the
//          GPU once for all of our plots, see Note #8 of gpuPlotRenderer.ts).
// Note #2: like with requestAnimationFrame(), a callback that gets requested while our callbacks are being called gets
//          called before the following repaint, a callback that gets cancelled while our callbacks are being called
//          doesn't get called (if it hasn't been called yet), and an error thrown by a callback doesn't prevent our
//          other callbacks from being called (it gets reported once they have been called).

let frameCallbacks = new Map<number, FrameRequestCallback>();
let calledFrameCallbacks: Map<number, FrameRequestCallback> | null = null;
let lastFrameCallbackId = 0;
let frameRequested = false;

const callFrameCallbacks = (time: number): void => {
  calledFrameCallbacks = frameCallbacks;
  frameCallbacks = new Map();
  frameRequested = false;

  for (const callback of calledFrameCallbacks.values()) {
    try {
      callback(time);
    } catch (error: unknown) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }

  calledFrameCallbacks = null;
};

export const requestFrame = (callback: FrameRequestCallback): number => {
  const id = ++lastFrameCallbackId;

  frameCallbacks.set(id, callback);

  if (!frameRequested) {
    frameRequested = true;

    requestAnimationFrame(callFrameCallbacks);
  }

  return id;
};

export const cancelFrame = (id: number): void => {
  frameCallbacks.delete(id);
  calledFrameCallbacks?.delete(id);
};

// A method to observe the size of an element, i.e. to call a callback whenever the size of the element changes, and
// to return a method to stop observing it.
// Note: we use a ResizeObserver that is shared by all the elements that we observe (e.g., those of all of our plots),
//       rather than one per element. Indeed, a browser calls the callback of each ResizeObserver in turn, running
//       microtasks in between. So, with one ResizeObserver per plot, the changes that a plot makes in a microtask
//       (e.g., Vue updating its legend) would get applied before the next plot gets to read its size, which would force
//       the browser to lay out our page again, for every plot. With a shared ResizeObserver, all of our callbacks get
//       called before any of those changes get applied.

let sizeObserver: ResizeObserver | null = null;
const sizeCallbacks = new Map<Element, () => void>();

export const observeSize = (element: Element, callback: () => void): (() => void) => {
  sizeObserver ??= new ResizeObserver((entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      try {
        sizeCallbacks.get(entry.target)?.();
      } catch (error: unknown) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  });

  sizeCallbacks.set(element, callback);
  sizeObserver.observe(element, { box: 'border-box' });

  return () => {
    sizeCallbacks.delete(element);
    sizeObserver?.unobserve(element);
  };
};

// A method to resolve a colour if it is a CSS variable (e.g., "var(--theme-grid-color)"), so that it can be used on a
// canvas. The CSS variable is resolved for the given element, i.e. where it is defined or inherited.
// Note: this must only be called from a browser since it uses the DOM.

export const cssColor = (color: string, element: Element): string => {
  const cssVariable = /^var\((--[\w-]+)\)$/.exec(color)?.[1];

  return cssVariable ? getComputedStyle(element).getPropertyValue(cssVariable).trim() || color : color;
};

// An empty array of values (e.g., for a plot without any trace).

export const EMPTY_FLOAT64_ARRAY = Object.freeze(new Float64Array(0));
