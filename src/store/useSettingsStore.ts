import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  theme: 'dark' | 'system' | 'light'
  accentColor: 'purple' | 'blue' | 'green' | 'pink'
  fontSize: 'small' | 'medium' | 'large'
  defaultQuality: 'low' | 'medium' | 'high'
  defaultSize: 'original' | 'a4'
  defaultOrientation: 'portrait' | 'landscape'
  defaultRows: number
  defaultCols: number
  defaultAddSeparators: boolean
  defaultAddPageNumbers: boolean
  showTips: boolean
  
  setTheme: (theme: 'dark' | 'system' | 'light') => void
  setAccentColor: (color: 'purple' | 'blue' | 'green' | 'pink') => void
  setFontSize: (size: 'small' | 'medium' | 'large') => void
  setDefaultProcessingPref: (key: string, value: unknown) => void
  setShowTips: (show: boolean) => void
  resetAll: () => void
}

const initialState = {
  theme: 'dark' as const,
  accentColor: 'purple' as const,
  fontSize: 'medium' as const,
  defaultQuality: 'high' as const,
  defaultSize: 'original' as const,
  defaultOrientation: 'portrait' as const,
  defaultRows: 1,
  defaultCols: 1,
  defaultAddSeparators: false,
  defaultAddPageNumbers: false,
  showTips: true,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...initialState,
      setTheme: (theme) => set({ theme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setFontSize: (fontSize) => set({ fontSize }),
      setDefaultProcessingPref: (key, value) => set((state) => ({ ...state, [key]: value })),
      setShowTips: (showTips) => set({ showTips }),
      resetAll: () => {
        set(initialState)
        localStorage.removeItem('noteSprint_tgPromptDismissed')
      },
    }),
    {
      name: 'noteSprint-settings',
    }
  )
)
