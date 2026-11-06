import type { FmClient } from "../client/client";
import type { FmChangeEntry } from "../core/schema";
import type { FmLabels } from "../react/labels";
import type { FmReviewProps } from "../react/plugins";
import { MultiFileDiff, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ChevronRightIcon, Columns2Icon, ExternalLinkIcon, Rows2Icon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { CHANGE_STYLE } from "../react/changes";
import { useDarkMode } from "../react/code-language";
import { IconButton } from "../react/icon-button";

type DiffStyle = "split" | "unified";

const STYLE_KEY = "fm:diff-style";
/** Larger texts are not compared in the browser. */
const MAX_DIFF_CHARS = 2 * 1024 * 1024;

function readStyle(): DiffStyle {
  return typeof localStorage !== "undefined" && localStorage.getItem(STYLE_KEY) === "unified"
    ? "unified"
    : "split";
}

/** Base and current text of a change; undefined when either side is too large or binary. */
function useDiffTexts(client: FmClient, mount: string, change: FmChangeEntry) {
  return useQuery({
    queryKey: [
      "fm",
      client.baseUrl,
      "diff",
      mount,
      change.path,
      change.status,
      change.additions,
      change.deletions,
    ],
    queryFn: async () => {
      const [base, current] = await Promise.all([
        change.status === "added" || change.status === "untracked"
          ? ""
          : client.baseText(mount, change.path).then(t => t ?? ""),
        change.status === "deleted"
          ? ""
          : client.readText(mount, change.path).then(r => r.text),
      ]);
      const comparable = (t: string) => t.length <= MAX_DIFF_CHARS && !t.includes("\0");
      return comparable(base) && comparable(current)
        ? { base, current }
        : undefined;
    },
    staleTime: 0,
  });
}

const DIFF_THEME = { light: "github-light-default", dark: "github-dark-default" } as const;

/** Read-only diff rendered by @pierre/diffs (shiki highlighting, split or unified, unchanged runs collapsed). */
function CodeDiff({ base, current, name, style }: { base: string; current: string; name: string; style: DiffStyle }) {
  const dark = useDarkMode();
  return (
    <MultiFileDiff
      oldFile={{ name, contents: base }}
      newFile={{ name, contents: current }}
      options={{
        diffStyle: style,
        diffIndicators: "bars",
        expandUnchanged: false,
        hunkSeparators: "line-info",
        overflow: "wrap",
        theme: DIFF_THEME,
        themeType: dark
          ? "dark"
          : "light",
        disableFileHeader: true,
      }}
    />
  );
}

/** One file's diff, loaded when shown. */
function FileDiff({ client, mount, change, style, labels }: { client: FmClient; mount: string; change: FmChangeEntry; style: DiffStyle; labels: FmLabels }) {
  const texts = useDiffTexts(client, mount, change);
  if (texts.isPending)
    return <div className="p-3 text-xs text-muted-foreground">{labels.loading}</div>;
  if (texts.isError)
    return <div className="p-3 text-xs text-destructive">{texts.error.message}</div>;
  if (!texts.data)
    return <div className="p-3 text-xs text-muted-foreground">{labels.diffUnavailable}</div>;
  return <CodeDiff base={texts.data.base} current={texts.data.current} name={change.path} style={style} />;
}

/** Status letter, path (and previous path) and line counts of a change. */
function ChangeTitle({ change }: { change: FmChangeEntry }) {
  const s = CHANGE_STYLE[change.status];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn("w-3 shrink-0 font-mono text-[11px] font-semibold", s.className)}>{s.letter}</span>
      <span className="truncate">{change.path.slice(1)}</span>
      {change.previousPath && <span className="truncate text-xs text-muted-foreground">{`← ${change.previousPath.slice(1)}`}</span>}
      {change.additions !== undefined && <span className="shrink-0 text-xs text-emerald-600 tabular-nums dark:text-emerald-400">{`+${change.additions}`}</span>}
      {change.deletions !== undefined && <span className="shrink-0 text-xs text-red-600 tabular-nums dark:text-red-400">{`−${change.deletions}`}</span>}
    </span>
  );
}

/**
 * Review view of the `fm-plugin-review` plugin: one file's diff, or every
 * change stacked (collapsible), side by side or inline, rendered with @pierre/diffs.
 */
export function ReviewPreview({ client, mount, labels, changes, path, actions, onOpenFile }: FmReviewProps) {
  const [style, setStyle] = useState<DiffStyle>(readStyle);
  const chooseStyle = (s: DiffStyle) => {
    setStyle(s);
    localStorage.setItem(STYLE_KEY, s);
  };
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const shown = path === undefined
    ? sorted
    : sorted.filter(c => c.path === path);

  const tools = (
    <>
      {path === undefined
        ? (
            <>
              <span className="text-xs text-muted-foreground">{labels.changeCounts(changes.length)}</span>
              <Button size="xs" variant="ghost" onClick={() => setCollapsed(new Set())}>{labels.expandAll}</Button>
              <Button size="xs" variant="ghost" onClick={() => setCollapsed(new Set(changes.map(c => c.path)))}>{labels.collapseAll}</Button>
            </>
          )
        : shown[0]?.status !== "deleted" && <IconButton label={labels.openFile} onClick={() => onOpenFile(path)}><ExternalLinkIcon /></IconButton>}
      <IconButton label={labels.diffSplit} aria-pressed={style === "split"} onClick={() => chooseStyle("split")}><Columns2Icon /></IconButton>
      <IconButton label={labels.diffUnified} aria-pressed={style === "unified"} onClick={() => chooseStyle("unified")}><Rows2Icon /></IconButton>
    </>
  );

  if (shown.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {actions && createPortal(tools, actions)}
        {labels.noChanges}
      </div>
    );
  }

  return (
    // The virtualizer renders only the visible lines of each diff, so long reviews stay cheap.
    <Virtualizer className="h-full overflow-y-auto overflow-x-hidden">
      {actions && createPortal(tools, actions)}
      <div className="flex flex-col">
        {shown.map((change) => {
          const open = path !== undefined || !collapsed.has(change.path);
          return (
            <section key={change.path} aria-label={change.path} data-fm-diff={change.path} className="border-b">
              <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-muted/80 px-2 py-1 text-sm backdrop-blur">
                {path === undefined && (
                  <IconButton
                    size="icon-xs"
                    label={change.path}
                    aria-expanded={open}
                    onClick={() => setCollapsed((s) => {
                      const next = new Set(s);
                      if (next.has(change.path))
                        next.delete(change.path);
                      else
                        next.add(change.path);
                      return next;
                    })}
                  >
                    <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
                  </IconButton>
                )}
                <ChangeTitle change={change} />
                {path === undefined && change.status !== "deleted" && (
                  <IconButton size="icon-xs" className="ml-auto" label={labels.openFile} onClick={() => onOpenFile(change.path)}><ExternalLinkIcon /></IconButton>
                )}
              </div>
              {open && <FileDiff client={client} mount={mount} change={change} style={style} labels={labels} />}
            </section>
          );
        })}
      </div>
    </Virtualizer>
  );
}
