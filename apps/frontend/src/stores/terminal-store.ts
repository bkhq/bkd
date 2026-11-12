import { create } from 'zustand'
import type { DrawerState } from '@/lib/drawer-store'
import { attachDrawerResize, drawerState } from '@/lib/drawer-store'

const config = { minWidth: 320, defaultRatio: 0.4, maxRatio: 0.65 }

export const TERMINAL_MIN_WIDTH = config.minWidth
export const TERMINAL_MAX_WIDTH_RATIO = config.maxRatio

export const useTerminalStore = create<DrawerState>(set => drawerState(set, config))

attachDrawerResize(useTerminalStore.getState, config, import.meta.hot)
