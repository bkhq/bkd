import type { FmErrorCode } from "../core/errors";
import type { FmDriver } from "./driver";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isFmError } from "../core/errors";
import { readAll } from "./driver";

export interface FmDriverFixture {
  driver: FmDriver;
  cleanup?: () => Promise<void> | void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function text(driver: FmDriver, path: string, range?: { start: number; end: number }): Promise<string> {
  const res = await driver.read(path, range);
  return dec.decode(await readAll(res.body));
}

async function expectCode(promise: Promise<unknown>, code: FmErrorCode): Promise<void> {
  let err: unknown;
  try {
    await promise;
  }
  catch (e) {
    err = e;
  }
  expect(isFmError(err)
    ? err.code
    : err).toBe(code);
}

async function putPart(d: FmDriver, path: string, id: string, n: number, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const mp = d.multipart!;
  if (mp.uploadPart) {
    await mp.uploadPart(path, id, n, bytes, bytes.byteLength);
    return;
  }
  const url = await mp.presignPart!(path, id, n, 600);
  const res = await fetch(url, { method: "PUT", body: bytes });
  expect(res.ok).toBe(true);
}

function concat(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** What a driver's storage model does not support; the matching cases are skipped or adjusted. */
export interface FmDriverContractOptions {
  /** Paths a fresh driver already holds (e.g. a required `SKILL.md`); ignored in listings. */
  seeded?: string[];
  /** Empty directories exist on their own (default true). False for storages whose folders are implied by file paths. */
  emptyDirs?: boolean;
  /** `copy` copies directories (default true). */
  copyDirs?: boolean;
}

/** Behavioural contract every driver must pass. Run it from a `*.test.ts` file. */
export function runDriverContract(label: string, make: () => Promise<FmDriverFixture>, opts: FmDriverContractOptions = {}): void {
  const seeded = new Set(opts.seeded ?? []);
  const names = async (driver: FmDriver, path: string) => (await driver.list(path))
    .filter(e => !seeded.has(e.path))
    .map(e => e.name)
    .sort();
  const itEmptyDirs = opts.emptyDirs === false
    ? it.skip
    : it;
  const itCopyDirs = opts.copyDirs === false
    ? it.skip
    : it;
  describe(`driver contract: ${label}`, () => {
    let fx: FmDriverFixture;
    let d: FmDriver;

    beforeEach(async () => {
      fx = await make();
      d = fx.driver;
    });
    afterEach(async () => {
      await fx.cleanup?.();
    });

    it("stats the root as a directory", async () => {
      expect((await d.stat("/")).kind).toBe("dir");
    });

    it("writes, creating parents, then stats, lists and reads", async () => {
      const e = await d.write("/a/b/hello.txt", enc.encode("hello world"));
      expect(e).toMatchObject({
        path: "/a/b/hello.txt",
        name: "hello.txt",
        kind: "file",
        size: 11,
      });
      expect((await d.stat("/a")).kind).toBe("dir");
      expect(await names(d, "/a/b")).toEqual(["hello.txt"]);
      expect(await names(d, "/")).toEqual(["a"]);
      expect(await text(d, "/a/b/hello.txt")).toBe("hello world");
    });

    it("accepts a stream body", async () => {
      const body = new Response("streamed").body!;
      await d.write("/s.txt", body);
      expect(await text(d, "/s.txt")).toBe("streamed");
    });

    it("reads a byte range", async () => {
      await d.write("/r.txt", enc.encode("0123456789"));
      const res = await d.read("/r.txt", { start: 2, end: 5 });
      expect(res.size).toBe(10);
      expect(dec.decode(await readAll(res.body))).toBe("2345");
    });

    it("changes the etag on overwrite and honours ifMatch", async () => {
      const first = await d.write("/e.txt", enc.encode("one"));
      const second = await d.write("/e.txt", enc.encode("three"), { ifMatch: first.etag });
      expect(second.etag).not.toBe(first.etag);
      await expectCode(d.write("/e.txt", enc.encode("x"), { ifMatch: first.etag }), "ETAG_MISMATCH");
      expect(await text(d, "/e.txt")).toBe("three");
    });

    it("refuses exclusive writes over existing files", async () => {
      await d.write("/x.txt", enc.encode("1"));
      await expectCode(d.write("/x.txt", enc.encode("2"), { exclusive: true }), "EXISTS");
    });

    it("lets exactly one of concurrent exclusive writes win", async () => {
      const results = await Promise.allSettled([0, 1, 2, 3, 4].map(i =>
        d.write("/race.txt", enc.encode(`w${i}`), { exclusive: true })));
      const won = results.flatMap((r, i) => r.status === "fulfilled"
        ? [i]
        : []);
      expect(won).toHaveLength(1);
      expect(results.flatMap(r => r.status === "rejected"
        ? [
            isFmError(r.reason)
              ? r.reason.code
              : r.reason,
          ]
        : [])).toEqual(["EXISTS", "EXISTS", "EXISTS", "EXISTS"]);
      expect(await text(d, "/race.txt")).toBe(`w${won[0]}`);
    });

    itEmptyDirs("creates empty directories that show up in listings", async () => {
      const e = await d.mkdir("/empty");
      expect(e.kind).toBe("dir");
      expect(await names(d, "/")).toEqual(["empty"]);
      expect(await d.list("/empty")).toEqual([]);
      await expectCode(d.mkdir("/empty"), "EXISTS");
    });

    it("reports missing paths", async () => {
      await expectCode(d.stat("/nope"), "NOT_FOUND");
      await expectCode(d.read("/nope"), "NOT_FOUND");
    });

    it("moves files and directories", async () => {
      await d.write("/src/f.txt", enc.encode("f"));
      await d.write("/src/sub/g.txt", enc.encode("g"));
      const moved = await d.move("/src", "/dst");
      expect(moved).toMatchObject({ path: "/dst", kind: "dir" });
      await expectCode(d.stat("/src"), "NOT_FOUND");
      expect(await text(d, "/dst/sub/g.txt")).toBe("g");
      await d.move("/dst/f.txt", "/f2.txt");
      expect(await text(d, "/f2.txt")).toBe("f");
      await d.move("/f2.txt", "/deep/er/f3.txt");
      expect(await text(d, "/deep/er/f3.txt")).toBe("f");
    });

    itCopyDirs("copies directories and keeps the source", async () => {
      await d.write("/c/a.txt", enc.encode("a"));
      await d.write("/c/d/b.txt", enc.encode("b"));
      await d.copy("/c", "/c2");
      expect(await text(d, "/c/d/b.txt")).toBe("b");
      expect(await text(d, "/c2/d/b.txt")).toBe("b");
      expect(await names(d, "/c2")).toEqual(["a.txt", "d"]);
    });

    it("guards move and copy targets", async () => {
      await d.write("/m/a.txt", enc.encode("a"));
      await d.write("/b.txt", enc.encode("b"));
      await expectCode(d.move("/b.txt", "/m/a.txt"), "EXISTS");
      await expectCode(d.copy("/missing", "/z"), "NOT_FOUND");
      await expectCode(d.move("/m", "/m/inner"), "INVALID");
    });

    it("removes files and directories recursively", async () => {
      await d.write("/r/a.txt", enc.encode("a"));
      await d.write("/r/s/b.txt", enc.encode("b"));
      await d.write("/keep.txt", enc.encode("k"));
      await d.remove("/r");
      await expectCode(d.stat("/r"), "NOT_FOUND");
      await expectCode(d.stat("/r/s/b.txt"), "NOT_FOUND");
      expect(await names(d, "/")).toEqual(["keep.txt"]);
      await d.remove("/keep.txt");
      expect(await names(d, "/")).toEqual([]);
    });

    const itTrash = (name: string, fn: () => Promise<void>) => it(name, async () => {
      if (d.trash)
        await fn();
    });

    itTrash("trash: removes into it, lists, gets, restores and purges", async () => {
      const t = d.trash!;
      await d.write("/bin/a.txt", enc.encode("a"));
      await d.write("/bin/dir/b.txt", enc.encode("b"));
      const a = await t.remove("/bin/a.txt");
      const dir = await t.remove("/bin/dir");
      await expect(d.stat("/bin/a.txt")).rejects.toThrow();
      expect(await names(d, "/bin")).toEqual([]);
      const listed = await t.list();
      expect(listed.map(i => i.id).sort()).toEqual([a, dir].sort());
      expect(await t.get(dir)).toMatchObject({
        id: dir,
        path: "/bin/dir",
        name: "dir",
        kind: "dir",
      });
      expect(await t.get(a)).toMatchObject({
        path: "/bin/a.txt",
        name: "a.txt",
        kind: "file",
        size: 1,
      });
      expect((await t.restore(dir, "/bin/dir")).kind).toBe("dir");
      expect(dec.decode(await readAll((await d.read("/bin/dir/b.txt")).body))).toBe("b");
      // Restoring next to a new file of the same name goes where the router says.
      await d.write("/bin/a.txt", enc.encode("new"));
      expect((await t.restore(a, "/bin/a (1).txt")).path).toBe("/bin/a (1).txt");
      expect(await t.list()).toEqual([]);
      const gone = await t.remove("/bin/a.txt");
      await t.purge(gone);
      expect(await t.list()).toEqual([]);
    });

    itTrash("trash: unknown ids are NOT_FOUND", async () => {
      await expect(d.trash!.get("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(d.trash!.purge("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("reports subfolder hints that match the children, when it gives them", async () => {
      await d.write("/hint/files/a.txt", enc.encode("a"));
      await d.write("/hint/nested/deep/b.txt", enc.encode("b"));
      const by = Object.fromEntries((await d.list("/hint")).map(e => [e.name, e.hasSubfolders]));
      expect(by.files === undefined || by.files === false).toBe(true);
      expect(by.nested === undefined || by.nested === true).toBe(true);
    });

    it("rejects reading a directory as a file", async () => {
      await d.write("/dir/f.txt", enc.encode("f"));
      await expectCode(d.read("/dir"), "IS_A_DIR");
    });

    describe("multipart", () => {
      const partSize = () => Math.max(d.multipart?.minPartSize ?? 1, 5);
      const fill = (size: number, k: number) => new Uint8Array(size).fill(k);

      it("assembles parts into the target, creating parents", async () => {
        const mp = d.multipart;
        if (!mp)
          return;
        const path = "/mp/deep/file.bin";
        const size = partSize();
        const chunks = [
          fill(size, 1),
          fill(size, 2),
          fill(3, 3),
        ];
        const id = await mp.begin(path);
        for (const [i, c] of chunks.entries())
          await putPart(d, path, id, i + 1, c);
        const parts = await mp.listParts(path, id);
        expect(parts.map(p => [p.n, p.size])).toEqual([
          [1, size],
          [2, size],
          [3, 3],
        ]);
        const e = await mp.complete(path, id, parts);
        expect(e).toMatchObject({ path, kind: "file", size: size * 2 + 3 });
        expect((await d.stat(path)).size).toBe(size * 2 + 3);
        expect(await readAll((await d.read(path)).body)).toEqual(concat(...chunks));
        await expectCode(mp.listParts(path, id), "NOT_FOUND");
      });

      it("replaces a re-uploaded part", async () => {
        const mp = d.multipart;
        if (!mp)
          return;
        const size = partSize();
        const id = await mp.begin("/re.bin");
        await putPart(d, "/re.bin", id, 1, fill(size, 1));
        await putPart(d, "/re.bin", id, 1, fill(2, 9));
        const parts = await mp.listParts("/re.bin", id);
        expect(parts.map(p => [p.n, p.size])).toEqual([
          [1, 2],
        ]);
        await mp.complete("/re.bin", id, parts);
        expect(await readAll((await d.read("/re.bin")).body)).toEqual(fill(2, 9));
      });

      it("rejects completing with a gap", async () => {
        const mp = d.multipart;
        if (!mp)
          return;
        const size = partSize();
        const id = await mp.begin("/gap.bin");
        await putPart(d, "/gap.bin", id, 1, fill(size, 1));
        await putPart(d, "/gap.bin", id, 3, fill(2, 3));
        await expectCode(mp.complete("/gap.bin", id, await mp.listParts("/gap.bin", id)), "INVALID");
        await mp.abort("/gap.bin", id);
      });

      it("aborts idempotently", async () => {
        const mp = d.multipart;
        if (!mp)
          return;
        const id = await mp.begin("/ab.bin");
        await putPart(d, "/ab.bin", id, 1, fill(2, 1));
        await mp.abort("/ab.bin", id);
        await expectCode(mp.listParts("/ab.bin", id), "NOT_FOUND");
        await mp.abort("/ab.bin", id);
        await expectCode(d.stat("/ab.bin"), "NOT_FOUND");
      });

      it("honours exclusive on complete", async () => {
        const mp = d.multipart;
        if (!mp)
          return;
        await d.write("/ex.bin", enc.encode("keep"));
        const id = await mp.begin("/ex.bin");
        await putPart(d, "/ex.bin", id, 1, fill(2, 1));
        await expectCode(mp.complete("/ex.bin", id, await mp.listParts("/ex.bin", id), { exclusive: true }), "EXISTS");
        expect(await text(d, "/ex.bin")).toBe("keep");
        await mp.abort("/ex.bin", id);
      });
    });
  });
}
