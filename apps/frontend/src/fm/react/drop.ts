import type { FileWithPath } from "react-dropzone";
import type { FmClient } from "../client/client";
import type { FmUploadFile } from "../client/upload";
import type { FmEntry } from "../core/schema";

/** Files from react-dropzone; dropped folders keep their path below the drop ("docs/a.txt"). */
export function filesFromDropzone(files: readonly (File & Partial<Pick<FileWithPath, "path" | "relativePath">>)[]): FmUploadFile[] {
  return files.map(file => ({
    file,
    relativePath: (file.relativePath || file.path || file.name).replace(/^\.?\//, ""),
  }));
}

export function filesFromInput(list: FileList): FmUploadFile[] {
  return [...list].map(file => ({ file, relativePath: file.webkitRelativePath || file.name }));
}

/**
 * `DownloadURL` drag data for a file (`mime:name:absolute url`): Chromium saves it when the
 * row is dropped on the desktop or a file browser; other browsers ignore it.
 */
export function setDownloadUrl(dt: DataTransfer, client: FmClient, entry: FmEntry) {
  if (entry.kind !== "file")
    return;
  const href = new URL(client.readUrl(entry.mount, entry.path, { download: true }), location.href).href;
  dt.setData("DownloadURL", `${entry.mime || "application/octet-stream"}:${entry.name}:${href}`);
}
