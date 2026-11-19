<template>
  <canvas v-show="visible && rect" ref="canvasRef" class="plot-live-points"
    :style="rect && {
      left: `${rect.left - MARGIN}px`,
      top: `${rect.top - MARGIN}px`,
      width: `${rect.width + 2 * MARGIN}px`,
      height: `${rect.height + 2 * MARGIN}px`
    }"
  />
</template>

<script setup lang="ts">
import * as vue from 'vue';

import * as common from '../common/common';

// The last point of the visible traces of a plot when its data is live (e.g., while a simulation is running), so that
// their latest value can easily be identified (see PlotWidget.vue). The last point of a trace is shown as a target,
// i.e. (from the inside out) a disc of its colour, a gap of the background colour, a ring of the text colour (i.e. near
// black in light mode and near white in dark mode), and a halo of the background colour. Being a high-contrast shape
// that is not otherwise found in our plots, it stands out even where a trace overlaps itself (e.g., in a phase plot),
// while its disc still shows which trace it belongs to.
// Note #1: we are an overlay, so that we can be shown and hidden without our plot having to be redrawn.
// Note #2: we are a canvas (rather than, say, an SVG element) and our points are not a property but are drawn using
//          setPoints(). Indeed, our points are updated whenever our plot gets drawn (e.g., many times a second while a
//          simulation is running), and both updating some SVG elements and re-rendering the (big) template of our plot
//          take about a millisecond, while drawing a few circles on a canvas takes next to nothing.
// Note #3: a target is drawn as a disc and three annuli, so that each pixel is only painted once, which matters if its
//          trace is faded (i.e. if another trace is highlighted).
// Note #4: our plotting area is given to setPoints() (rather than being a property), so that our canvas always has the
//          size of the plotting area for which our points were determined (e.g., when our plot gets resized).
// Note #5: our canvas extends beyond our plotting area by MARGIN pixels on each side, so that a target on the edge of
//          our plotting area doesn't get clipped. However, a target is only drawn if its point is within our plotting
//          area (e.g., not if we are zoomed in and the last point of its trace is not visible).

export interface IPlotLivePoint {
  x: number; // In CSS pixels, relative to our plotting area.
  y: number; // In CSS pixels, relative to our plotting area.
  color: string;
  alpha: number;
}

export interface IPlotLivePointsRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const props = defineProps<{
  backgroundColor: string;
  textColor: string;
}>();

const RADIUS = 3; // Radius of the disc of a target.
const GAP = 1.5; // Gap between the disc of a target and its ring.
const RING_WIDTH = 1.5; // Width of the ring of a target.
const HALO_WIDTH = 1; // Width of the halo around the ring of a target.
const MARGIN = Math.ceil(RADIUS + GAP + RING_WIDTH + HALO_WIDTH) + 1; // Plus a pixel for antialiasing (see Note #5).

const canvasRef = vue.useTemplateRef<HTMLCanvasElement>('canvasRef');
const visible = vue.ref<boolean>(false);
const rect = vue.shallowRef<IPlotLivePointsRect | undefined>();

const setPoints = (plotRect: IPlotLivePointsRect | undefined, points: IPlotLivePoint[]): void => {
  // Draw the given points, if any, for the given plotting area (in CSS pixels, relative to our plot).

  const canvas = canvasRef.value;

  visible.value = points.length > 0;

  if (
    plotRect?.left !== rect.value?.left ||
    plotRect?.top !== rect.value?.top ||
    plotRect?.width !== rect.value?.width ||
    plotRect?.height !== rect.value?.height
  ) {
    rect.value = plotRect && { ...plotRect };
  }

  if (!canvas || !plotRect || !points.length) {
    return;
  }

  // Get our canvas context.

  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  // Draw our targets, after making sure that our canvas has the size of our plotting area (in device pixels), which
  // also clears it, or clearing it.

  const pxRatio = window.devicePixelRatio || 1;
  const width = Math.round((plotRect.width + 2 * MARGIN) * pxRatio);
  const height = Math.round((plotRect.height + 2 * MARGIN) * pxRatio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  } else {
    context.clearRect(0, 0, width, height);
  }

  const discRadius = RADIUS * pxRatio;
  const gapRadius = discRadius + GAP * pxRatio;
  const ringRadius = gapRadius + RING_WIDTH * pxRatio;
  const haloRadius = ringRadius + HALO_WIDTH * pxRatio;
  const backgroundColor = common.cssColor(props.backgroundColor, canvas);
  const textColor = common.cssColor(props.textColor, canvas);

  for (const point of points) {
    if (point.x < 0 || point.x > plotRect.width || point.y < 0 || point.y > plotRect.height) {
      continue;
    }

    const x = (point.x + MARGIN) * pxRatio;
    const y = (point.y + MARGIN) * pxRatio;

    context.globalAlpha = point.alpha;

    for (const [innerRadius, outerRadius, color] of [
      [0, discRadius, common.cssColor(point.color, canvas)],
      [discRadius, gapRadius, backgroundColor],
      [gapRadius, ringRadius, textColor],
      [ringRadius, haloRadius, backgroundColor]
    ] as const) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, outerRadius, 0, 2 * Math.PI);

      if (innerRadius > 0) {
        context.moveTo(x + innerRadius, y);
        context.arc(x, y, innerRadius, 0, 2 * Math.PI);
      }

      context.fill('evenodd');
    }
  }

  context.globalAlpha = 1;
};

defineExpose({ setPoints });
</script>

<style scoped>
  .plot-live-points {
    position: absolute;
    z-index: 1;
    pointer-events: none;
  }
</style>
