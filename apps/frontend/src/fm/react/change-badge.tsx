import type { FmChangeEntry } from "../core/schema";
import { cn } from "cn";
import { CHANGE_STYLE } from "./changes";

/** Status letter of a changed file, or a dot for a folder holding changes. */
export function ChangeBadge({ change, dir }: { change?: FmChangeEntry | undefined; dir?: boolean | undefined }) {
  if (change) {
    const s = CHANGE_STYLE[change.status];
    return <span data-fm-change={change.status} title={change.status} className={cn("ml-auto shrink-0 pl-2 font-mono text-[10px] font-semibold", s.className)}>{s.letter}</span>;
  }
  if (dir)
    return <span data-fm-change="dir" className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500/80" />;
  return null;
}
