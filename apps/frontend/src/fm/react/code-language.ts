import type { Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { useEffect, useState, useSyncExternalStore } from "react";

/** CodeMirror language support for a file name, loaded on demand (none while loading or unknown). */
export function useLanguage(name: string): Extension[] {
  const [ext, setExt] = useState<Extension[]>([]);
  useEffect(() => {
    let alive = true;
    const desc = LanguageDescription.matchFilename(languages, name);
    void desc?.load().then(support => alive && setExt([support]));
    return () => {
      alive = false;
    };
  }, [name]);
  return ext;
}

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Follows the host's `.dark` class on <html>, so the editor switches with the page theme. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** Whether the page is dark (the host's `.dark` class on <html>), live. */
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribeTheme, isDark, () => false);
}
