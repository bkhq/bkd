import type { FmLabels } from "./labels";

/** Sections of the shortcuts dialog, in display order. */
export const FM_SHORTCUT_GROUPS = [
  "general",
  "selection",
  "tree",
  "preview",
  "image",
  "editor",
  "trash",
  "quickOpen",
] as const;
export type FmShortcutGroup = (typeof FM_SHORTCUT_GROUPS)[number];

export interface FmShortcut {
  id: string;
  /** Alternative combos, e.g. `"Mod+Shift+Alt+C"`; `Mod` is ⌘ on Mac and Ctrl elsewhere. */
  keys: readonly string[];
  group: FmShortcutGroup;
  label: keyof FmLabels["shortcutLabels"];
}

function entry<const I extends string>(id: I, group: FmShortcutGroup, label: FmShortcut["label"], ...keys: string[]) {
  return { id, keys, group, label } satisfies FmShortcut;
}

/**
 * The keyboard bindings of the manager, for display only: the handlers
 * (use-commands, file-tree, preview-dialog, media-stage, text-preview,
 * trash-view, quick-open) do their own matching.
 */
export const FM_SHORTCUTS = [
  entry("quickOpen", "general", "quickOpen", "Mod+P"),
  entry("shortcuts", "general", "showShortcuts", "?"),
  entry("open", "general", "open", "Enter"),
  entry("parent", "general", "parentFolder", "Backspace"),
  entry("rename", "general", "rename", "F2"),
  entry("delete", "general", "delete", "Delete"),
  entry("copy", "general", "copy", "Mod+C"),
  entry("cut", "general", "cut", "Mod+X"),
  entry("paste", "general", "paste", "Mod+V"),
  entry("copyPath", "general", "copyPath", "Mod+Alt+C"),
  entry("copyRelativePath", "general", "copyRelativePath", "Mod+Shift+Alt+C"),
  entry("moveSelection", "selection", "moveSelection", "ArrowUp", "ArrowDown"),
  entry("extendSelection", "selection", "extendSelection", "Shift+ArrowUp", "Shift+ArrowDown"),
  entry("selectAll", "selection", "selectAll", "Mod+A"),
  entry("clearSelection", "selection", "clearSelection", "Escape"),
  entry("tree.move", "tree", "moveFocus", "ArrowUp", "ArrowDown"),
  entry("tree.ends", "tree", "firstLast", "Home", "End"),
  entry("tree.expand", "tree", "expand", "ArrowRight"),
  entry("tree.collapse", "tree", "collapse", "ArrowLeft"),
  entry("preview.previous", "preview", "previousFile", "ArrowLeft"),
  entry("preview.next", "preview", "nextFile", "ArrowRight"),
  entry("image.zoomIn", "image", "zoomIn", "+"),
  entry("image.zoomOut", "image", "zoomOut", "-"),
  entry("image.fit", "image", "fit", "0"),
  entry("image.rotateRight", "image", "rotateRight", "R"),
  entry("image.rotateLeft", "image", "rotateLeft", "Shift+R"),
  entry("image.flip", "image", "flip", "F"),
  entry("editor.save", "editor", "save", "Mod+S"),
  entry("trash.selectAll", "trash", "selectAll", "Mod+A"),
  entry("trash.delete", "trash", "deletePermanently", "Delete", "Backspace"),
  entry("trash.clear", "trash", "clearSelection", "Escape"),
  entry("quickOpen.move", "quickOpen", "moveFocus", "ArrowUp", "ArrowDown"),
  entry("quickOpen.open", "quickOpen", "open", "Enter"),
] as const;

export type FmShortcutId = (typeof FM_SHORTCUTS)[number]["id"];

const MODIFIERS = {
  Shift: ["⇧", "Shift"],
  Alt: ["⌥", "Alt"],
  Mod: ["⌘", "Ctrl"],
} as const;
type Modifier = keyof typeof MODIFIERS;
// Mac lists modifiers as ⇧⌥⌘, others as Ctrl+Shift+Alt.
const MAC_ORDER: Modifier[] = ["Shift", "Alt", "Mod"];
const OTHER_ORDER: Modifier[] = ["Mod", "Shift", "Alt"];

const KEY_NAMES: Record<string, readonly [mac: string, other: string]> = {
  Enter: ["↩", "Enter"],
  Delete: ["⌦", "Del"],
  Backspace: ["⌫", "Backspace"],
  Escape: ["Esc", "Esc"],
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
};

/** Display text of one combo such as `"Mod+Alt+C"`: `⌥⌘C` on Mac, `Ctrl+Alt+C` elsewhere. */
export function formatKeys(combo: string, mac: boolean): string {
  // A `+` that ends the combo is the key itself.
  const parts = combo.split(/\+(?=.)/);
  const key = parts.pop()!;
  const mods = (mac ? MAC_ORDER : OTHER_ORDER).filter(m => parts.includes(m)).map(m => MODIFIERS[m][mac ? 0 : 1]);
  const name = KEY_NAMES[key]?.[mac ? 0 : 1] ?? key;
  return mac
    ? mods.join("") + name
    : [...mods, name].join("+");
}

/** Display text of a shortcut's first combo, as shown in menus. */
export function shortcutText(id: FmShortcutId, mac: boolean): string {
  return formatKeys(FM_SHORTCUTS.find(s => s.id === id)!.keys[0]!, mac);
}

/**
 * Whether a keydown should open the shortcuts dialog: `?` without Ctrl / ⌘ / Alt,
 * not typed into a text field, and `busy` (another dialog, preview or quick open) false.
 */
export function opensShortcuts(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null }, busy: boolean): boolean {
  return e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !busy
    && !(e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
}
