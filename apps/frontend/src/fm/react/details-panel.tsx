import type { ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmColumn, FmDetailTab } from "./columns";
import type { FmLabels } from "./labels";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CopyIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmKeys, useUsage } from "../client/hooks";
import { dirname } from "../core/path";
import { columnContent } from "./columns";
import { EntryIcon } from "./file-list";
import { IconButton } from "./icon-button";
import { formatSize } from "./state";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}

/** Side panel with the properties of one entry; folders show their total size. */
export function DetailsPanel({ entry, mountLabel, client, labels, overlay, onClose, columns, tabs }: {
  entry: FmEntry;
  mountLabel: string;
  client: FmClient;
  labels: FmLabels;
  /** Float above the list (narrow layouts) instead of taking a column. */
  overlay?: boolean;
  onClose: () => void;
  /** Host columns, one row each. */
  columns?: readonly FmColumn[] | undefined;
  /** Host tabs next to the details. */
  tabs?: readonly FmDetailTab[] | undefined;
}) {
  const isDir = entry.kind === "dir";
  const usage = useUsage(client, entry.mount, entry.path, isDir);
  const [copied, setCopied] = useState(false);
  const parent = dirname(entry.path);
  const location = entry.path === "/" || parent === "/"
    ? mountLabel
    : `${mountLabel}${parent}`;

  const qc = useQueryClient();
  const shownTabs = (tabs ?? []).filter(t => !t.when || t.when(entry));
  const [tabId, setTabId] = useState("details");
  const tab = shownTabs.find(t => t.id === tabId);
  const refresh = () => qc.invalidateQueries({
    queryKey: fmKeys.all(client),
  });

  const copyPath = () => {
    void navigator.clipboard?.writeText(entry.path).then(() => setCopied(true));
  };

  return (
    <aside
      className={cn("flex flex-col bg-background", overlay
        ? "absolute inset-y-0 right-0 z-20 w-72 max-w-[85%] border-l shadow-lg"
        : "h-full")}
      aria-label={labels.details}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <EntryIcon entry={entry} className="size-5" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {entry.path === "/"
            ? mountLabel
            : entry.name}
        </span>
        <IconButton size="icon-xs" label={labels.close} onClick={onClose}><XIcon /></IconButton>
      </div>
      {shownTabs.length > 0 && (
        <div role="tablist" aria-label={labels.details} className="flex gap-1 border-b px-2 py-1">
          {[
            { id: "details", label: labels.details },
            ...shownTabs,
          ].map(t => (
            <Button
              key={t.id}
              size="xs"
              role="tab"
              aria-selected={(tab?.id ?? "details") === t.id}
              variant={(tab?.id ?? "details") === t.id
                ? "secondary"
                : "ghost"}
              onClick={() => setTabId(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {tab
          ? <div role="tabpanel" aria-label={tab.label} className="p-3 text-sm">{tab.render(entry, { client, refresh })}</div>
          : (
              <dl className="grid gap-3 p-3">
                <Field label={labels.type}>
                  {isDir
                    ? labels.folder
                    : (entry.mime ?? "—")}
                </Field>
                <Field label={labels.size}>
                  {isDir
                    ? (usage.data
                        ? (
                            <>
                              {formatSize(usage.data.bytes)}
                              {usage.data.truncated && "+"}
                              <span className="block text-xs text-muted-foreground">{labels.contains(usage.data.files, usage.data.dirs)}</span>
                            </>
                          )
                        : labels.loading)
                    : formatSize(entry.size)}
                </Field>
                <Field label={labels.modified}>{new Date(entry.mtime).toLocaleString()}</Field>
                <Field label={labels.location}>{location}</Field>
                {columns?.map(c => <Field key={c.id} label={c.label}>{columnContent(c, entry) || "—"}</Field>)}
                <div>
                  <Button size="sm" variant="outline" onClick={copyPath}>
                    <CopyIcon />
                    {copied
                      ? labels.copied
                      : labels.copyPath}
                  </Button>
                </div>
              </dl>
            )}
      </ScrollArea>
    </aside>
  );
}
