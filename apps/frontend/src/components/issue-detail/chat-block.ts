import { cva } from 'class-variance-authority'

/**
 * The one shape every chat block shares: one radius and a background colour
 * for role or state. Only tool groups and command output have an outline.
 */
export const chatBlock = cva('rounded-lg', {
  variants: {
    tone: {
      user: 'bg-primary/[0.06]',
      // Replies sit on the chat background itself
      assistant: '',
      pending: 'bg-amber-500/[0.08]',
      done: 'bg-emerald-500/[0.08]',
      // A follow-up sent by another issue's agent
      agent: 'bg-sky-500/[0.06]',
      // Tool groups and command output keep an outline; messages do not
      neutral: 'border border-border bg-muted/30',
      thinking: 'bg-violet-500/[0.05]',
      error: 'bg-destructive/[0.06] text-destructive',
      warning: 'bg-amber-500/[0.06] text-amber-600 dark:text-amber-400',
    },
  },
})

/** Padding of a block's content, and of the summary row of a collapsible block. */
export const CHAT_BLOCK_BODY = 'px-3 py-2'
export const CHAT_BLOCK_SUMMARY = 'px-3 py-1.5'
/** Vertical rhythm around every block. */
export const CHAT_BLOCK_ROW = 'py-1.5'
