<template>
  <svg class="icon" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path v-for="(path, index) in ICONS[name]" :key="index" :d="path" />
  </svg>
</template>

<script setup lang="ts">
import { ICONS, type IconName } from '../../common/icons';

// An icon (see icons.ts), which takes the colour of its text (i.e. currentcolor) and whose size is that of its text,
// unless it is set by its parent (e.g., using a class).
// Note: our size is also set using attributes (rather than only using CSS), so that we always have an intrinsic size
//       (some browsers would otherwise give us no size in some cases, e.g. in a flex container).

defineProps<{
  name: IconName;
}>();
</script>

<style scoped>
  .icon {
    flex: none;
    fill: currentcolor;
  }
</style>
