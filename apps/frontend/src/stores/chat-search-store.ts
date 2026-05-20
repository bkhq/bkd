import { create } from 'zustand'

/**
 * Coordinates "jump to a message" requests from the in-chat search bar
 * (SEARCH-001) to the message list, which owns the virtualizer and is the
 * only component that can scroll a virtualized row into view.
 *
 * Flow:
 *   ChatSearchBar.jumpTo(logId)
 *     → ensures the log is loaded into the stream (loadLogWindow)
 *     → requestJump(logId)
 *   SessionMessages subscribes to `jumpNonce`; on change it finds the
 *   message index by `messageId`, scrolls it into view (virtualizer
 *   scrollToIndex or native scrollIntoView), and flashes a highlight.
 */
interface ChatSearchStore {
  /** Bumped on every jump request so subscribers re-run even for the same id. */
  jumpNonce: number
  /** messageId (DB log id) the list should scroll to. */
  jumpMessageId: string | null
  requestJump: (messageId: string) => void
}

export const useChatSearchStore = create<ChatSearchStore>(set => ({
  jumpNonce: 0,
  jumpMessageId: null,
  requestJump: messageId =>
    set(s => ({ jumpNonce: s.jumpNonce + 1, jumpMessageId: messageId })),
}))
