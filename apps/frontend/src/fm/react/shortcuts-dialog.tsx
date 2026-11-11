import type { FmLabels } from "./labels";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FM_SHORTCUT_GROUPS, FM_SHORTCUTS, formatKeys } from "./shortcuts";

/** Lists the keyboard shortcuts by group; opened with `?`. */
export function ShortcutsDialog({ labels, mac, onClose }: {
  labels: FmLabels;
  /** Show Mac key symbols (⌘ ⌥ ⇧) instead of Ctrl / Alt / Shift. */
  mac: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.keyboardShortcuts}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {FM_SHORTCUT_GROUPS.map(group => (
            <table key={group} className="w-full text-sm">
              <caption className="pb-1 text-left text-xs font-medium text-muted-foreground">{labels.shortcutGroups[group]}</caption>
              <tbody>
                {FM_SHORTCUTS.filter(s => s.group === group).map(s => (
                  <tr key={s.id} className="border-t first:border-t-0">
                    <td className="py-1.5 pr-4">{labels.shortcutLabels[s.label]}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {s.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="px-1 text-muted-foreground">/</span>}
                          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{formatKeys(k, mac)}</kbd>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
