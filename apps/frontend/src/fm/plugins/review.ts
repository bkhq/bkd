import type { FmPlugin } from "../react/plugins";
import { lazy } from "react";

const ReviewPreview = lazy(() => import("./review-view").then(m => ({ default: m.ReviewPreview })));

/**
 * Diffs for mounts whose driver reports changes (e.g. `localDriver({ gitChanges: true })`):
 * a changed file opens as a side-by-side or inline diff, and "Review all changes"
 * stacks every diff. CodeMirror's merge view loads only when a diff is opened.
 */
export function reviewPlugin(): FmPlugin {
  return {
    id: "review",
    review: ReviewPreview,
  };
}
