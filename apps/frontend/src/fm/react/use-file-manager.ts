import type { FileManagerProps } from "./file-manager";
import { createMenus } from "./manager-menus";
import { useChanges } from "./use-changes";
import { useCommands } from "./use-commands";
import { useListingState } from "./use-listing-state";
import { useViewState } from "./use-view-state";

/** State and commands of a file manager, shared by its shells; `drive` serves `DriveManager`. */
export function useFileManager(props: FileManagerProps, mode: "workspace" | "drive" = "workspace") {
  const view = useViewState(props, mode);
  const listing = useListingState(props, view);
  const changes = useChanges(props, view, listing);
  const commands = useCommands(props, view, listing, changes);
  const menus = createMenus(props, view, listing, changes, commands);
  return {
    ...view,
    ...listing,
    ...changes,
    ...commands,
    ...menus,
  };
}

export type FmController = ReturnType<typeof useFileManager>;
