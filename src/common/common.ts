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
// axis in a UI JSON file, or the description of an issue), so that it can be rendered as HTML (e.g., using v-html).
// Note #1: only a few formatting elements are kept (e.g., "<i>I<sub>K,r</sub></i>"), without any of their attributes,
//          except for the class of a PrimeIcons icon (e.g., <i class="pi pi-cog"></i>). Any other element is replaced
//          with its contents, unless its contents are not meant to be shown as text (e.g., a script), in which case it
//          is removed altogether.
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
const SANITISE_HTML_ICON_CLASS_REGEX = /^\s*pi(\s+pi-[a-z0-9-]+)+\s*$/;
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
        const elementClass = element.getAttribute('class');

        if (elementName === 'i' && elementClass && SANITISE_HTML_ICON_CLASS_REGEX.test(elementClass)) {
          sanitisedElement.setAttribute('class', elementClass.trim());
        }

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

// Some constants related to simulation data values.

export const EMPTY_FLOAT64_ARRAY = Object.freeze(new Float64Array(0));
