/**
 * Whether a keydown belongs to an IME composition. With a Chinese or
 * Japanese IME the Enter that confirms a candidate arrives as a plain
 * `keydown Enter`; submitting on it saves half-typed text. Safari fires the
 * same key with `keyCode` 229 right after composition ends.
 */
export function isImeComposing(e: { keyCode?: number, nativeEvent: { isComposing?: boolean } }): boolean {
  return e.nativeEvent.isComposing === true || e.keyCode === 229
}
