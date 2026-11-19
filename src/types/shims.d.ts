// TypeScript shim for our CSS side-effect imports (e.g., `import '../assets/theme.css';`).
// Note: `vue-tsc` knows how to treat `.vue` files, but not CSS files.

declare module '*.css';
