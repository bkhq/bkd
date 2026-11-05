import { createContext, use, useRef, useState } from "react";

/**
 * Change notes sent with every change (`X-Fm-Message`), e.g. commit messages.
 * - `mode`: the manager asks before each change ("required" needs text).
 * - `get`: the host owns the field; `onUsed` runs after a change succeeded (to clear it).
 */
export type FmChangeMessageOptions
  = | { mode: "optional" | "required"; placeholder?: string }
    | { get: () => string | undefined; onUsed?: () => void };

export interface FmChangeMessage {
  /** The note for the next change: text, undefined for none, or null when the user cancelled. */
  ask: () => Promise<string | undefined | null>;
  /** A change went through. */
  used: () => void;
}

export const ChangeMessageContext = createContext<FmChangeMessage>({
  ask: async () => undefined,
  used: () => {},
});

/** In previews and views: `ask` before a change, pass the note to the request, `used` after it succeeded. */
export function useChangeMessage(): FmChangeMessage {
  return use(ChangeMessageContext);
}

/** An open prompt: the dialog settles it. */
export interface FmChangeMessageAsk {
  required: boolean;
  placeholder: string | undefined;
  settle: (note: string | undefined | null) => void;
}

/** The manager's change-message state: `value` for the context, `asking` for `ChangeMessageDialog`. */
export function useChangeMessageState(options: FmChangeMessageOptions | undefined) {
  const [asking, setAsking] = useState<FmChangeMessageAsk>();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [value] = useState<FmChangeMessage>(() => ({
    ask: () => {
      const o = optionsRef.current;
      if (!o || !("mode" in o))
        return Promise.resolve(undefined);
      return new Promise((resolve) => {
        setAsking({
          required: o.mode === "required",
          placeholder: o.placeholder,
          settle: (note) => {
            setAsking(undefined);
            resolve(note);
          },
        });
      });
    },
    used: () => {
      const o = optionsRef.current;
      if (o && "get" in o)
        o.onUsed?.();
    },
  }));
  return { value, asking };
}
