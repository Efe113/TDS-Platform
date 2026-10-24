import { create } from 'zustand'
import type { HotKeyEvent, OverlayState, StrategyIr, ValidationReport } from '@tds/shared'

export interface ImportOutcome {
  origin: 'link' | 'file' | 'paste'
  ir: StrategyIr | null
  report: ValidationReport | null
  sourceLabel?: string
  code?: string
  message?: string
}

export interface ActiveStrategy {
  /** Which row the overlay is tracking, so a detail page can tell "this run" from "another run". */
  strategyId: string
  name: string
  stepIndex: number
  totalSteps: number
}

interface AppState {
  overlayVisible: boolean
  activeStrategy: ActiveStrategy | null
  /** The full overlay payload, so the run rail can show the current and upcoming step cards. */
  overlayState: OverlayState | null
  recentKeys: HotKeyEvent[]
  importOutcome: ImportOutcome | null
  setOverlayVisible: (visible: boolean) => void
  applyOverlayState: (state: OverlayState | null) => void
  clearActiveStrategy: () => void
  recordKey: (event: HotKeyEvent) => void
  setImportOutcome: (outcome: ImportOutcome) => void
  clearImportOutcome: () => void
}

export const useAppStore = create<AppState>((set) => ({
  overlayVisible: false,
  activeStrategy: null,
  overlayState: null,
  recentKeys: [],
  importOutcome: null,
  setOverlayVisible: (visible) => set({ overlayVisible: visible }),
  applyOverlayState: (state) =>
    set({
      overlayState: state,
      activeStrategy: state
        ? { strategyId: state.strategyId, name: state.strategyName, stepIndex: state.stepIndex, totalSteps: state.totalSteps }
        : null
    }),
  clearActiveStrategy: () => set({ activeStrategy: null }),
  recordKey: (event) => set((current) => ({ recentKeys: [event, ...current.recentKeys].slice(0, 6) })),
  setImportOutcome: (outcome) => set({ importOutcome: outcome }),
  clearImportOutcome: () => set({ importOutcome: null })
}))
