<template>
  <Teleport v-if="levels.length" :to="appendTo ?? 'body'">
    <div ref="containerRef" class="opencor-plot-theme opencor-context-menu" :class="{ 'opencor-plot-dark-mode': darkMode }">
      <!--
      Note: our menu and its open submenu, if any, are our levels, which are shown next to one another (rather than
            nested), each of them being a list that can get the keyboard focus (see onKeyDown()), with its focused
            item being its active descendant.
      -->
      <ul v-for="(level, levelIndex) in levels" :key="levelIndex"
        :ref="(element) => setLevelElement(levelIndex, element)"
        class="context-menu-list"
        :class="{ 'context-menu-submenu': levelIndex > 0 }"
        role="menu"
        aria-orientation="vertical"
        tabindex="-1"
        :aria-activedescendant="level.focusedIndex >= 0 ? itemId(levelIndex, level.focusedIndex) : undefined"
        :style="{ left: `${level.left}px`, top: `${level.top}px` }"
        @keydown="onKeyDown($event, levelIndex)"
      >
        <template v-for="(item, index) in level.items" :key="index">
          <li v-if="isSeparator(item)" class="context-menu-separator" role="separator" />
          <li v-else :id="itemId(levelIndex, index)" class="context-menu-item"
            :class="{
              'context-menu-item-focused': level.focusedIndex === index,
              'context-menu-item-active': isSubmenuOpen(levelIndex, index)
            }"
            :role="item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
            :aria-checked="item.checked"
            :aria-haspopup="item.items ? 'menu' : undefined"
            :aria-expanded="item.items ? isSubmenuOpen(levelIndex, index) : undefined"
            @pointerenter="onItemPointerEnter(levelIndex, index)"
            @click="onItemClick(levelIndex, index)"
          >
            <span v-if="hasCheckColumn(level)" class="context-menu-item-check">
              <IconWidget v-if="item.checked" name="check" />
            </span>
            <IconWidget v-if="item.icon" :name="item.icon" class="context-menu-item-icon" />
            <span class="context-menu-item-label">{{ item.label }}</span>
            <IconWidget v-if="item.items" name="angle-right" class="context-menu-item-chevron" />
          </li>
        </template>
      </ul>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import * as vue from 'vue';

import type { IconName } from '../common/icons';

// A context menu, which looks like the context menus of OpenCOR (which are PrimeVue context menus) and behaves like
// them, i.e. it:
//  - is shown where it is requested, while remaining within the viewport, and so are its submenus;
//  - can be used with the mouse (hovering an item focuses it and opens its submenu, if any) and with the keyboard
//    (ArrowUp/ArrowDown/Home/End to focus an item, ArrowRight/Enter/Space to open the submenu of the focused item,
//    ArrowLeft to close a submenu, Enter/Space to select the focused item, typing the first letters of an item to
//    focus it, and Escape/Tab to hide our context menu); and
//  - gets hidden when an item is selected, when the user clicks outside of it, or when the window gets resized.
// Note #1: an item with a (boolean) checked property is a checkable item (e.g., to make an axis logarithmic), in which
//          case it has a check mark to the left of its icon when it is checked, and it is described as such to
//          assistive technologies. All the items of a menu (or submenu) that has a checked item have room for a check
//          mark, so that their icons and labels remain aligned, while the items of a menu that has no checked item
//          don't (so that no space is wasted).
// Note #2: only one context menu should be shown at any given time, so we let our other context menus know when we are
//          about to be shown, and we hide ourselves when another context menu is about to be shown.

export interface IContextMenuAction {
  label: string;
  icon?: IconName;
  checked?: boolean;
  command?: () => void;
  items?: IContextMenuItem[];
}

export interface IContextMenuSeparator {
  separator: true;
}

export type IContextMenuItem = IContextMenuAction | IContextMenuSeparator;

const props = defineProps<{
  items: IContextMenuItem[];
  appendTo?: HTMLElement | string;
  darkMode?: boolean;
}>();

const emit = defineEmits<{
  hide: [];
}>();

// Some constants (in CSS pixels, where relevant).

const LIST_PADDING = 4; // Padding of a list (see .context-menu-list).
const LIST_BORDER = 1; // Border of a list (see .context-menu-list).
const SUBMENU_GAP = 4; // Gap between a submenu and its parent item.
const SEARCH_TIMEOUT = 500; // Time after which our search string gets reset (in milliseconds, see searchItem()).

// Our levels, i.e. our menu and its open submenu, if any, as well as their focused item and position.

interface ILevel {
  items: IContextMenuItem[];
  parentIndex: number;
  focusedIndex: number;
  left: number;
  top: number;
}

const levels = vue.ref<ILevel[]>([]);
const containerRef = vue.shallowRef<HTMLElement | null>(null);
const levelElements: (HTMLElement | null)[] = [];
const uid = vue.useId();

const setLevelElement = (levelIndex: number, element: unknown): void => {
  levelElements[levelIndex] = element instanceof HTMLElement ? element : null;
};

const itemId = (levelIndex: number, index: number): string => {
  return `${uid}-${levelIndex}-${index}`;
};

const isSeparator = (item: IContextMenuItem): item is IContextMenuSeparator => {
  return 'separator' in item;
};

const actionAt = (levelIndex: number, index: number): IContextMenuAction | undefined => {
  const item = levels.value[levelIndex]?.items[index];

  return item && !isSeparator(item) ? item : undefined;
};

const hasCheckColumn = (level: ILevel): boolean => {
  return level.items.some((item: IContextMenuItem) => !isSeparator(item) && item.checked === true);
};

const isSubmenuOpen = (levelIndex: number, index: number): boolean => {
  return levels.value[levelIndex + 1]?.parentIndex === index;
};

// Positioning of a level, making sure that it remains within the viewport.
// Note: our menu is shown at the given position, unless it would go beyond the right (bottom) edge of the viewport, in
//       which case it is shown to the left of (above) that position, while a submenu is shown to the right of its
//       parent item, unless it would go beyond the right edge of the viewport, in which case it is shown to its left.

const positionLevel = (levelIndex: number, x: number, y: number): void => {
  const level = levels.value[levelIndex];
  const element = levelElements[levelIndex];

  if (!level || !element) {
    return;
  }

  const { width, height } = element.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  let left = x;
  let top = y;

  if (levelIndex === 0) {
    if (left + width > viewportWidth) {
      left -= width;
    }

    if (top + height > viewportHeight) {
      top -= height;
    }
  } else {
    const parentItemRect = document.getElementById(itemId(levelIndex - 1, level.parentIndex))?.getBoundingClientRect();

    if (!parentItemRect) {
      return;
    }

    left = parentItemRect.right + SUBMENU_GAP;
    top = parentItemRect.top - LIST_PADDING - LIST_BORDER;

    if (left + width > viewportWidth) {
      left = parentItemRect.left - SUBMENU_GAP - width;
    }

    if (top + height > viewportHeight) {
      top = viewportHeight - height;
    }
  }

  level.left = Math.max(0, left);
  level.top = Math.max(0, top);
};

const focusLevel = (levelIndex: number): void => {
  levelElements[levelIndex]?.focus({ preventScroll: true });
};

// Opening and closing of a submenu.

const closeLevelsAfter = (levelIndex: number): void => {
  if (levels.value.length > levelIndex + 1) {
    levels.value = levels.value.slice(0, levelIndex + 1);
  }
};

const openSubmenu = async (levelIndex: number, index: number, focusFirstItem: boolean): Promise<void> => {
  const item = actionAt(levelIndex, index);

  if (!item?.items) {
    return;
  }

  if (!isSubmenuOpen(levelIndex, index)) {
    levels.value = [
      ...levels.value.slice(0, levelIndex + 1),
      { items: item.items, parentIndex: index, focusedIndex: -1, left: 0, top: 0 }
    ];

    await vue.nextTick();

    positionLevel(levelIndex + 1, 0, 0);
  }

  const submenu = levels.value[levelIndex + 1];

  if (focusFirstItem && submenu) {
    submenu.focusedIndex = nextItemIndex(submenu, -1, 1);

    focusLevel(levelIndex + 1);
  }
};

// Navigation within a level.

const nextItemIndex = (level: ILevel, fromIndex: number, step: 1 | -1): number => {
  // Return the index of the next (previous) item that is not a separator, starting from the given index, or the given
  // index if there is none (i.e. we don't wrap around, like PrimeVue).

  for (let index = fromIndex + step; index >= 0 && index < level.items.length; index += step) {
    const item = level.items[index];

    if (item && !isSeparator(item)) {
      return index;
    }
  }

  return fromIndex;
};

const focusItem = (levelIndex: number, index: number): void => {
  const level = levels.value[levelIndex];

  if (!level || index < 0) {
    return;
  }

  level.focusedIndex = index;

  closeLevelsAfter(levelIndex);
};

let searchString = '';
let searchTimeout: ReturnType<typeof setTimeout> | undefined;

const searchItem = (levelIndex: number, character: string): void => {
  // Focus the next item (starting from the focused one, and wrapping around) which label starts with what has been
  // typed so far.

  const level = levels.value[levelIndex];

  if (!level) {
    return;
  }

  clearTimeout(searchTimeout);

  searchString += character.toLocaleLowerCase();
  searchTimeout = setTimeout(() => {
    searchString = '';
  }, SEARCH_TIMEOUT);

  const nbOfItems = level.items.length;

  for (let i = 1; i <= nbOfItems; ++i) {
    const index = (level.focusedIndex + i + nbOfItems) % nbOfItems;
    const item = level.items[index];

    if (item && !isSeparator(item) && item.label.toLocaleLowerCase().startsWith(searchString)) {
      focusItem(levelIndex, index);

      return;
    }
  }
};

// Selection of an item, i.e. running its command and hiding our context menu, or opening its submenu.

const selectItem = (levelIndex: number, index: number, usingKeyboard: boolean): void => {
  const item = actionAt(levelIndex, index);

  if (!item) {
    return;
  }

  if (item.items) {
    void openSubmenu(levelIndex, index, usingKeyboard);

    return;
  }

  item.command?.();

  hide();
};

// Mouse and keyboard handling.

const onItemPointerEnter = (levelIndex: number, index: number): void => {
  focusItem(levelIndex, index);
  focusLevel(levelIndex);

  void openSubmenu(levelIndex, index, false);
};

const onItemClick = (levelIndex: number, index: number): void => {
  selectItem(levelIndex, index, false);
};

const onKeyDown = (event: KeyboardEvent, levelIndex: number): void => {
  const level = levels.value[levelIndex];

  if (!level) {
    return;
  }

  const focusedIndex = level.focusedIndex;

  switch (event.key) {
    case 'ArrowDown':
      focusItem(levelIndex, nextItemIndex(level, focusedIndex, 1));

      break;
    case 'ArrowUp':
      focusItem(levelIndex, nextItemIndex(level, focusedIndex === -1 ? level.items.length : focusedIndex, -1));

      break;
    case 'Home':
      focusItem(levelIndex, nextItemIndex(level, -1, 1));

      break;
    case 'End':
      focusItem(levelIndex, nextItemIndex(level, level.items.length, -1));

      break;
    case 'ArrowRight':
      void openSubmenu(levelIndex, focusedIndex, true);

      break;
    case 'ArrowLeft':
      if (levelIndex > 0) {
        closeLevelsAfter(levelIndex - 1);
        focusLevel(levelIndex - 1);
      }

      break;
    case 'Enter':
    case ' ':
      selectItem(levelIndex, focusedIndex, true);

      break;
    case 'Escape':
    case 'Tab':
      hide();

      break;
    default:
      if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        searchItem(levelIndex, event.key);

        break;
      }

      return;
  }

  event.preventDefault();
  event.stopPropagation();
};

const onWindowPointerDown = (event: PointerEvent): void => {
  if (!(event.target instanceof Node) || !containerRef.value?.contains(event.target)) {
    hide();
  }
};

// Note: our window gets blurred when switching to another tab or application, in which case we want to hide our context
//       menu, just like a native context menu would.

const onWindowBlurOrResize = (): void => {
  hide();
};

// Showing and hiding of our context menu.

const CONTEXT_MENU_SHOW_EVENT = 'opencor-context-menu-show';

const contextMenuId = Symbol('ContextMenuWidget');

const show = async (event: MouseEvent): Promise<void> => {
  window.dispatchEvent(
    new CustomEvent(CONTEXT_MENU_SHOW_EVENT, {
      detail: {
        sourceId: contextMenuId
      }
    })
  );

  if (!levels.value.length) {
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('blur', onWindowBlurOrResize);
    window.addEventListener('resize', onWindowBlurOrResize);
  }

  levels.value = [{ items: props.items, parentIndex: -1, focusedIndex: -1, left: event.clientX, top: event.clientY }];

  await vue.nextTick();

  positionLevel(0, event.clientX, event.clientY);
  focusLevel(0);
};

const hide = (): void => {
  if (!levels.value.length) {
    return;
  }

  window.removeEventListener('pointerdown', onWindowPointerDown, true);
  window.removeEventListener('blur', onWindowBlurOrResize);
  window.removeEventListener('resize', onWindowBlurOrResize);

  clearTimeout(searchTimeout);

  searchString = '';
  levels.value = [];

  emit('hide');
};

const onContextMenuShow = (event: Event): void => {
  if ((event as CustomEvent<{ sourceId?: symbol }>).detail?.sourceId !== contextMenuId) {
    hide();
  }
};

vue.onMounted(() => {
  window.addEventListener(CONTEXT_MENU_SHOW_EVENT, onContextMenuShow);
});

vue.onUnmounted(() => {
  window.removeEventListener(CONTEXT_MENU_SHOW_EVENT, onContextMenuShow);

  hide();
});

defineExpose({ hide, show });
</script>

<style scoped>
  /**
   * Note #1: our context menu looks like OpenCOR's context menus, i.e. PrimeVue's (Aura) context menus with OpenCOR's
   *          customisations. Our hover tooltip is shown below it (see .hover-tooltip in PlotWidget.vue).
   * Note #2: our elements are sized using their border box, whatever the consumer's styles are (e.g., the width of our
   *          chevron includes its padding).
   */

  .context-menu-list,
  .context-menu-list * {
    box-sizing: border-box;
  }

  .context-menu-list {
    position: fixed;
    z-index: 1000;
    min-width: 12rem;
    margin: 0;
    padding: 0.25rem;
    border: 1px solid var(--theme-overlay-border-color);
    border-radius: 0.5rem;
    background-color: var(--theme-overlay-background);
    box-shadow: var(--theme-overlay-shadow);
    color: var(--theme-overlay-text-color);
    font-size: 0.875rem;
    list-style: none;
    outline: none;
    user-select: none;
  }

  .context-menu-submenu {
    min-width: 9rem;
  }

  .context-menu-separator {
    margin: 0.125rem 0.5rem;
    border-top: 1px solid var(--theme-overlay-border-color);
  }

  .context-menu-item {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.375rem 0.5rem;
    border-radius: var(--theme-border-radius);
    cursor: pointer;
  }

  .context-menu-item-focused,
  .context-menu-item-active {
    background-color: var(--theme-hover-background);
  }

  /**
   * Show our focus ring around the item that has the keyboard focus, as for OpenCOR's context menus.
   */

  .context-menu-list:focus-visible .context-menu-item-focused {
    outline: var(--theme-focus-ring-width) solid var(--theme-focus-ring-color);
    outline-offset: calc(-1 * var(--theme-focus-ring-width));
  }

  .context-menu-item-check {
    display: flex;
    flex: none;
    justify-content: center;
    width: 1rem;
    color: var(--theme-muted-text-color);
  }

  .context-menu-item-check .icon {
    width: 0.75rem;
    height: 0.75rem;
  }

  .context-menu-item-icon {
    width: 1rem;
    height: 0.875rem;
    color: var(--theme-muted-text-color);
  }

  .context-menu-item-label {
    white-space: nowrap;
  }

  .context-menu-item-chevron {
    width: 2.25rem;
    height: 0.75rem;
    margin-left: auto;
    padding-left: 1.5rem;
    color: var(--theme-muted-text-color);
  }

  .context-menu-item-focused .context-menu-item-check,
  .context-menu-item-focused .context-menu-item-icon,
  .context-menu-item-focused .context-menu-item-chevron,
  .context-menu-item-active .context-menu-item-check,
  .context-menu-item-active .context-menu-item-icon,
  .context-menu-item-active .context-menu-item-chevron {
    color: var(--theme-text-color);
  }
</style>
