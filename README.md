# OpenCOR Plot

`@opencor/plot` is a [Vue 3](https://vuejs.org/) component for plotting data. It is used by [OpenCOR](https://opencor.ws/), but it can be used by any Vue 3 application.

Key characteristics:
- Built as a [Vue 3](https://vuejs.org/) component using the [Composition API](https://vuejs.org/guide/extras/composition-api-faq).
- Uses [uPlot](https://github.com/leeoniya/uPlot) under the hood with [WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API) for rendering traces (and a fallback when WebGL is not available).
- It does not rely on any UI framework (e.g., [PrimeVue](https://www.primefaces.org/primevue/)) or CSS framework (e.g., [Tailwind CSS](https://tailwindcss.com/)).

## Development

[Bun](https://bun.sh/) is required.

```bash
bun install          # Install the dependencies.
bun run build        # Build the library.
bun dev              # Run the demo app.
bun build:demo       # Build the demo app.
bun format           # Format the code.
bun format:check     # Check the code formatting (without fixing it).
bun lint             # Lint the code.
bun lint:check       # Lint the code (without fixing it).
bun typecheck        # Type check the code.
bun clean            # Remove all generated files.
```

```bash
bun dependencies:update  # Check for and update outdated dependencies.
bun version:new          # Bump the version number.
```

## License

[Apache License 2.0](LICENSE.txt).
