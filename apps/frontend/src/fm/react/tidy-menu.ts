import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { ContextMenuSeparator } from "@/components/ui/context-menu";

export type FmMenuItems = ReadonlyArray<ReactNode | FmMenuItems>;

/** Menu items without the separators hidden items leave at either end or side by side. */
export function tidyMenu(items: FmMenuItems): ReactElement[] {
  const isSeparator = (item: ReactElement | undefined) => item?.type === ContextMenuSeparator;
  const out: ReactElement[] = [];
  const add = (list: FmMenuItems) => {
    for (const item of list) {
      if (Array.isArray(item))
        add(item);
      else if (isValidElement(item) && !(isSeparator(item) && (out.length === 0 || isSeparator(out.at(-1)))))
        out.push(item);
    }
  };
  add(items);
  if (isSeparator(out.at(-1)))
    out.pop();
  return out;
}
