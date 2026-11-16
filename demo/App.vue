<template>
  <div class="demo">
    <header class="demo-header">
      <h1>OpenCOR Plot</h1>
    </header>
    <main class="demo-main">
      <div class="demo-plot">
        <OpenCORPlot />
      </div>
    </main>
  </div>
</template>

<style scoped>
  .demo {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .demo-header {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--demo-border);
  }

  .demo-header h1 {
    margin: 0;
    font-size: 1.25rem;
  }

  .demo-main {
    flex-grow: 1;
    min-height: 0;
    padding: 1rem;
  }

  .demo-plot {
    height: 100%;
    border: 1px solid var(--demo-border);
  }
</style>
