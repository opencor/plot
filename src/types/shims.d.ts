// TypeScript shims for Vite-style imports.
// Note: `vue-tsc` needs to know how to treat `.vue` files and CSS imports.

declare module '*.vue' {
  const component: import('vue').DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;

  export default component;
}

declare module '*.css';
