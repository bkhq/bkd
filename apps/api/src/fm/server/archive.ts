import type { FmDriver } from "./driver";
import { Zip, ZipPassThrough } from "fflate";
import { FmError } from "../core/errors";
import { basename } from "../core/path";

export interface FmArchiveLimits {
  maxEntries: number;
  maxBytes: number;
}

interface Item {
  path: string;
  /** Name inside the zip; directories end with `/`. */
  name: string;
  dir: boolean;
  mtime: number;
}

/** Walks `paths` and fails before any byte is sent when the archive would exceed the limits. */
export async function collect(driver: FmDriver, paths: string[], limits: FmArchiveLimits, skip: (path: string) => boolean): Promise<Item[]> {
  const items: Item[] = [];
  let bytes = 0;
  const visit = async (path: string, name: string): Promise<void> => {
    const e = await driver.stat(path);
    if (items.length >= limits.maxEntries)
      throw new FmError("TOO_LARGE", `Archive exceeds ${limits.maxEntries} entries`);
    if (e.kind === "file") {
      bytes += e.size;
      if (bytes > limits.maxBytes)
        throw new FmError("TOO_LARGE", `Archive exceeds ${limits.maxBytes} bytes`);
      items.push({
        path,
        name,
        dir: false,
        mtime: e.mtime,
      });
      return;
    }
    items.push({
      path,
      name: `${name}/`,
      dir: true,
      mtime: e.mtime,
    });
    for (const child of await driver.list(path)) {
      if (!skip(child.path))
        await visit(child.path, `${name}/${child.name}`);
    }
  };
  for (const p of paths)
    await visit(p, basename(p) || "root");
  return items;
}

/** Streams an uncompressed zip of `paths`; reads one file at a time with backpressure. */
export async function zipStream(driver: FmDriver, paths: string[], limits: FmArchiveLimits, skip: (path: string) => boolean = () => false): Promise<ReadableStream<Uint8Array>> {
  const items = await collect(driver, paths, limits, skip);
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let current: ZipPassThrough | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array>;
  let produced = 0;
  let finished = false;

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      controllerRef.error(err);
      return;
    }
    produced++;
    controllerRef.enqueue(chunk);
    if (final)
      controllerRef.close();
  });

  const open = (item: Item): ZipPassThrough => {
    const entry = new ZipPassThrough(item.name);
    if (item.mtime > 0)
      entry.mtime = item.mtime;
    zip.add(entry);
    return entry;
  };

  /** Feeds one step into the zip; returns false when nothing is left. */
  const step = async (): Promise<boolean> => {
    if (reader && current) {
      const { done, value } = await reader.read();
      if (!done) {
        current.push(value);
        return true;
      }
      current.push(new Uint8Array(), true);
      reader = undefined;
      current = undefined;
    }
    const item = items[index++];
    if (!item) {
      zip.end();
      return false;
    }
    const entry = open(item);
    if (item.dir) {
      entry.push(new Uint8Array(), true);
    }
    else {
      [current, reader] = [
        entry,
        (await driver.read(item.path)).body.getReader(),
      ];
    }
    return true;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    // A pull must enqueue something, or the stream stalls.
    async pull() {
      const before = produced;
      const idle = () => !finished && produced === before;
      while (idle())
        finished = !await step();
    },
    async cancel() {
      await reader?.cancel();
      zip.terminate();
    },
  });
}
