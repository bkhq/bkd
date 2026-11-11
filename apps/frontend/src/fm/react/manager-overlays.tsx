import type { FmUploadFile } from "../client/upload";
import type { FmEntry } from "../core/schema";

import type { FmController } from "./use-file-manager";

import {
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { basename, dirname, joinPath } from "../core/path";
import { ChangeMessageDialog } from "./change-message-dialog";
import { ConfirmDeleteDialog, ManageDrivesDialog, NameDialog, UploadConflictDialog } from "./dialogs";
import { clearDraft } from "./drafts";
import { maskEntry } from "./features";
import { IconButton } from "./icon-button";
import { MAC, topName } from "./manager-shared";
import { visibleMounts } from "./mount-visibility";
import { PreviewDialog } from "./preview-dialog";
import { DiscardChangesDialog } from "./preview-pane";
import { QuickOpen } from "./quick-open";
import { ReviewDialog } from "./review-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { UploadPanel } from "./upload-panel";

export function ManagerOverlays({ fm }: { fm: FmController }) {
  const {
    client,
    userHidden,
    setUserHidden,
    preview,
    setPreview,
    dialog,
    setDialog,
    quickOpen,
    setQuickOpen,
    setError,
    notice,
    setNotice,
    pendingNav,
    setPendingNav,
    ask,
    used,
    path,
    labels,
    changeMessage,
    mounts,
    pluginPreviewers,
    features,
    hostHidden,
    mount,
    filter,
    paneDirtyRef,
    fileInputRef,
    folderInputRef,
    addPendingFolder,
    openFile,
    entries,
    byPath,
    explorer,
    paneFile,
    review,
    setReview,
    reviewer,
    changeMounts,
    changeQueries,
    queue,
    mutations,
    refreshMount,
    trashItems,
    failedMessage,
    runOps,
    reveal,
    pickQuickOpen,
    canQuickOpen,
    download,
    onPick,
  } = fm;
  return (
    <>
      <input ref={fileInputRef} type="file" multiple hidden onChange={onPick} />
      <input ref={folderInputRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={onPick} />

      <UploadPanel queue={queue} labels={labels} />

      {notice && (
        <div role="status" className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-lg">
          <span>{notice.message}</span>
          {notice.undo && (
            <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={notice.undo}>
              {labels.undo}
            </Button>
          )}
          <IconButton size="icon-xs" label={labels.close} className="text-background hover:bg-background/15 hover:text-background" onClick={() => setNotice(undefined)}><XIcon /></IconButton>
        </div>
      )}

      {review && reviewer && !explorer && (
        <ReviewDialog
          reviewer={reviewer}
          client={client}
          mount={review.mount}
          labels={labels}
          title={review.path ?? labels.changes}
          changes={changeQueries[changeMounts.indexOf(review.mount)]?.data ?? []}
          path={review.path}
          onClose={() => setReview(undefined)}
          onOpenFile={(p) => {
            setReview(undefined);
            void client.stat(review.mount, p).then(e => setPreview(maskEntry(e, features)), () => {});
          }}
        />
      )}

      {preview && (
        <PreviewDialog
          // The listing's copy carries the latest etag after a save from the preview.
          entry={(preview.mount === mount && byPath.get(preview.path)) || preview}
          // Opened from outside the current folder (recent, starred): no stepping.
          siblings={preview.mount === mount && byPath.has(preview.path)
            ? entries.filter(e => e.kind === "file")
            : [preview]}
          client={client}
          labels={labels}
          editable={features.edit}
          previewers={pluginPreviewers}
          onNavigate={setPreview}
          {...(features.download
            ? {
                onDownload: (e: FmEntry) => download([e]),
              }
            : {})}
          onClose={() => setPreview(undefined)}
        />
      )}

      {pendingNav && (
        <DiscardChangesDialog
          labels={labels}
          onCancel={() => setPendingNav(undefined)}
          onDiscard={() => {
            paneDirtyRef.current = false;
            setPendingNav(undefined);
            pendingNav();
            // After the editor's unmount flush, so the draft does not come back.
            if (paneFile)
              setTimeout(clearDraft, 0, paneFile.mount, paneFile.path);
          }}
        />
      )}

      {canQuickOpen && mount && (
        <QuickOpen
          client={client}
          mount={mount}
          labels={labels}
          open={quickOpen}
          onOpenChange={setQuickOpen}
          onPick={pickQuickOpen}
          filter={filter}
        />
      )}

      {dialog?.kind === "mkdir" && mount && (
        <NameDialog
          title={labels.newFolder}
          initial={labels.newFolder}
          submitLabel={labels.create}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            const to = dialog.to ?? { mount, path };
            void ask().then((message) => {
              if (message === null)
                return;
              client.mkdir(to.mount, joinPath(to.path, name), { message }).then(() => {
                used();
                addPendingFolder(to.mount, joinPath(to.path, name));
                void refreshMount(to.mount);
              }, (e: Error) => setError(e.message));
            });
          }}
        />
      )}
      {dialog?.kind === "newFile" && mount && (
        <NameDialog
          title={labels.newFile}
          initial={labels.untitled}
          submitLabel={labels.create}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            const to = dialog.to ?? { mount, path };
            void ask().then((message) => {
              if (message === null)
                return;
              client.write(to.mount, joinPath(to.path, name), "", { conflict: "fail", message }).then((e) => {
                used();
                void refreshMount(to.mount);
                setPreview(e);
              }, (e: Error) => setError(e.message));
            });
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title={labels.rename}
          initial={dialog.entry.name}
          submitLabel={labels.rename}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            if (name === basename(dialog.entry.path))
              return;
            const renamed = dialog.entry;
            runOps({ op: "rename", path: renamed.path, name }, () => {
              // Keep showing a renamed open file under its new name.
              if (renamed.kind === "file" && renamed.mount === openFile?.mount && renamed.path === openFile.path) {
                reveal({
                  ...renamed,
                  name,
                  path: joinPath(dirname(renamed.path), name),
                });
              }
            }, renamed.mount);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          count={dialog.paths.length}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onConfirm={() => {
            setDialog(undefined);
            runOps({ op: "delete", paths: dialog.paths }, dialog.after, dialog.mount);
          }}
        />
      )}
      {dialog?.kind === "emptyTrash" && mount && (
        <ConfirmDeleteDialog
          count={trashItems.length}
          title={labels.confirmEmptyTrash}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onConfirm={() => {
            setDialog(undefined);
            void ask().then((message) => {
              if (message === null)
                return;
              mutations.purge.mutate({ message }, {
                onSuccess: (res) => {
                  used();
                  setError(failedMessage(res.results));
                },
                onError: e => setError(e.message),
              });
            });
          }}
        />
      )}
      {dialog?.kind === "manageDrives" && mounts.data && (
        <ManageDrivesDialog
          mounts={visibleMounts(mounts.data, hostHidden, [], undefined)}
          hidden={userHidden}
          current={mount}
          labels={labels}
          onChange={setUserHidden}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "uploadConflict" && (
        <UploadConflictDialog
          count={dialog.clashes.size}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onChoose={(choice) => {
            const { files, clashes } = dialog;
            setDialog(undefined);
            const clash = (f: FmUploadFile) => clashes.has(topName(f)) && !(f.relativePath ?? "").includes("/");
            queue.getState().enqueue(dialog.to.mount, dialog.to.path, choice === "skip"
              ? files.filter(f => !clash(f))
              : files.map(f => (clash(f)
                  ? { ...f, conflict: choice }
                  : f)));
          }}
        />
      )}
      {dialog?.kind === "shortcuts" && <ShortcutsDialog labels={labels} mac={MAC} onClose={() => setDialog(undefined)} />}
      {changeMessage.asking && <ChangeMessageDialog asking={changeMessage.asking} labels={labels} />}
    </>
  );
}
