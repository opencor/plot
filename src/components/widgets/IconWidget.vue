<template>
  <svg class="icon" width="1em" height="1em" viewBox="3 3 18 18" aria-hidden="true" focusable="false">
    <path v-for="(path, index) in ICONS[name]" :key="index" :d="path" />
  </svg>
</template>

<script setup lang="ts">
import { ICONS, type IconName } from '../../common/icons';

// An icon (see icons.ts), which takes the colour of its text (i.e. currentcolor) and whose size is that of its text,
// unless it is set by its parent (e.g., using a class).
// Note #1: our size is also set using attributes (rather than only using CSS), so that we always have an intrinsic
//          size (some browsers would otherwise give us no size in some cases, e.g. in a flex container).
// Note #2: our view box leaves out the 3-unit margin that PrimeIcons' SVG files have on each side (i.e. we only use the
//          18x18 box in which their icons are drawn), so that we look like PrimeIcons' font, which glyphs fill their
//          whole em box (i.e. a 14px icon is as big as a 14px PrimeIcons glyph).

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
