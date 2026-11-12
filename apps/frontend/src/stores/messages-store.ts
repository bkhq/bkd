import { create } from 'zustand'
import type { DrawerState } from '@/lib/drawer-store'
import { attachDrawerResize, drawerState } from '@/lib/drawer-store'

const config = { minWidth: 420, defaultRatio: 0.4, maxRatio: 0.65 }

export const MESSAGES_MIN_WIDTH = config.minWidth
export const MESSAGES_MAX_WIDTH_RATIO = config.maxRatio

export const useMessagesStore = create<DrawerState>(set => drawerState(set, config))

attachDrawerResize(useMessagesStore.getState, config, import.meta.hot)
