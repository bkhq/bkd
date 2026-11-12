import { create } from 'zustand'
import type { DrawerState } from '@/lib/drawer-store'
import { attachDrawerResize, drawerState } from '@/lib/drawer-store'

const config = { minWidth: 320, defaultRatio: 0.35, maxRatio: 0.6 }

export const PROCESS_MANAGER_MIN_WIDTH = config.minWidth
export const PROCESS_MANAGER_MAX_WIDTH_RATIO = config.maxRatio

export const useProcessManagerStore = create<DrawerState>(set => drawerState(set, config))

attachDrawerResize(useProcessManagerStore.getState, config, import.meta.hot)
