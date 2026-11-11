/** How long a drag rests on a folder before it springs open (ms). */
export const FM_SPRING_DELAY = 700;

/** Opens a drag target after the drag rests on it (spring-loaded folders). */
export interface FmSpringLoader {
  /** The drag is over `key`: starts its timer unless it is already running or fired for `key`. */
  enter: (key: string, open: () => void) => void;
  /** The drag left `key`; a leave of any other target is ignored. */
  leave: (key: string) => void;
  /** Drop or drag end: stops any pending timer. */
  cancel: () => void;
}

export interface FmSpringLoaderOptions {
  delay?: number | undefined;
  /** Timer functions, injectable for tests. */
  schedule?: ((fn: () => void, ms: number) => unknown) | undefined;
  cancel?: ((id: unknown) => void) | undefined;
}

export function createSpringLoader({
  delay = FM_SPRING_DELAY,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = id => clearTimeout(id as ReturnType<typeof setTimeout>),
}: FmSpringLoaderOptions = {}): FmSpringLoader {
  let current: string | undefined;
  let timer: unknown;
  const stop = () => {
    if (timer !== undefined)
      cancel(timer);
    timer = undefined;
    current = undefined;
  };
  return {
    enter(key, open) {
      if (key === current)
        return;
      stop();
      current = key;
      timer = schedule(() => {
        timer = undefined;
        open();
      }, delay);
    },
    leave(key) {
      if (key === current)
        stop();
    },
    cancel: stop,
  };
}

/** Spring-loading key of a folder: `mount:path`. */
export function springKey(mount: string, path: string) {
  return `${mount}:${path}`;
}

/** Spring-loading of the manager's folders: what is being dragged, and one timer for every target. */
export function createSpringDrag(loader: FmSpringLoader = createSpringLoader()) {
  /** Keys of the manager entries being dragged: a folder never springs open under itself. */
  let dragged: ReadonlySet<string> = new Set();
  return {
    /** A drag of manager entries started; `keys` are what it carries. */
    start(keys: string[]) {
      dragged = new Set(keys);
    },
    /** The drag dropped or ended: nothing springs open any more. */
    end() {
      dragged = new Set();
      loader.cancel();
    },
    /**
     * A drag is over the folder `key`; `types` are its data types. Manager entries
     * (`internalType`) and OS files spring it open after a rest.
     */
    over(types: readonly string[], internalType: string, key: string, open: () => void) {
      if (types.includes(internalType)
        ? !dragged.has(key)
        : types.includes("Files")) {
        loader.enter(key, open);
      }
    },
    /** The drag left the folder `key` (or its element went away). */
    leave(key: string) {
      loader.leave(key);
    },
  };
}

/** The manager's shared spring-loading: one drag at a time. */
export const springDrag = createSpringDrag();
