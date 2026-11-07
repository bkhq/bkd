import type { FmTrashItem } from "../core/schema";
import type { FmChangeContext, FmDriver, FmDriverTrash } from "./driver";
import { FmError, isFmError } from "../core/errors";
import { assertName } from "../core/path";
import { readAll } from "./driver";

/** Hidden per-mount folder: `<id>/<name>` holds the entry, `<id>.json` its metadata. */
export const TRASH_DIR = "/.fm-trash";

type Meta = Omit<FmTrashItem, "id" | "expiresAt">;

const metaPath = (id: string) => `${TRASH_DIR}/${id}.json`;

function checkId(id: string) {
  assertName(id);
  if (!/^[\w-]+$/.test(id))
    throw new FmError("NOT_FOUND", "Trash item not found");
}

/** Path of the trashed entry itself. */
export function trashedPath(item: FmTrashItem): string {
  return `${TRASH_DIR}/${item.id}/${item.name}`;
}

/** Moves `path` into the trash and returns the trash id. */
export async function moveToTrash(d: FmDriver, path: string, ctx?: FmChangeContext): Promise<string> {
  const e = await d.stat(path);
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await d.move(path, `${TRASH_DIR}/${id}/${e.name}`, ctx);
  const meta: Meta = {
    path,
    name: e.name,
    kind: e.kind,
    size: e.kind === "file"
      ? e.size
      : 0,
    deletedAt: new Date().toISOString(),
  };
  await d.write(metaPath(id), new TextEncoder().encode(JSON.stringify(meta)));
  return id;
}

export async function getTrashItem(d: FmDriver, id: string): Promise<FmTrashItem> {
  checkId(id);
  try {
    const { body } = await d.read(metaPath(id));
    return {
      id,
      ...JSON.parse(new TextDecoder().decode(await readAll(body))) as Meta,
    };
  }
  catch (e) {
    if (isFmError(e) && e.code === "NOT_FOUND")
      throw new FmError("NOT_FOUND", "Trash item not found");
    throw e;
  }
}

/** Newest first; entries without readable metadata are skipped. */
export async function listTrash(d: FmDriver): Promise<FmTrashItem[]> {
  const children = await d.list(TRASH_DIR).catch((e: unknown) => {
    if (isFmError(e) && e.code === "NOT_FOUND")
      return [];
    throw e;
  });
  const items: FmTrashItem[] = [];
  for (const c of children) {
    if (c.kind !== "file" || !c.name.endsWith(".json"))
      continue;
    const item = await getTrashItem(d, c.name.slice(0, -5)).catch(() => undefined);
    if (item)
      items.push(item);
  }
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Removes the item folder (empty after a restore) and its metadata. */
export async function dropTrashItem(d: FmDriver, id: string, ctx?: FmChangeContext): Promise<void> {
  await d.remove(`${TRASH_DIR}/${id}`, ctx).catch(() => {});
  await d.remove(metaPath(id));
}

/** The router's trash for drivers without their own: entries move into `/.fm-trash`. */
export function folderTrash(d: FmDriver): FmDriverTrash {
  const toItem = (i: FmTrashItem) => ({
    id: i.id,
    path: i.path,
    name: i.name,
    kind: i.kind,
    size: i.size,
    deletedAt: Date.parse(i.deletedAt),
  });
  return {
    remove: (path, ctx) => moveToTrash(d, path, ctx),
    list: async () => (await listTrash(d)).map(toItem),
    get: async id => toItem(await getTrashItem(d, id)),
    async restore(id, to, ctx) {
      const item = await getTrashItem(d, id);
      const entry = await d.move(trashedPath(item), to, ctx);
      await dropTrashItem(d, id, ctx);
      return entry;
    },
    async purge(id, ctx) {
      await getTrashItem(d, id);
      await dropTrashItem(d, id, ctx);
    },
  };
}
