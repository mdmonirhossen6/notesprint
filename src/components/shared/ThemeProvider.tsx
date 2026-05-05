"use client"

import { useEffect, useState } from "react"
import { useSettingsStore } from "@/store/useSettingsStore"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, accentColor, fontSize } = useSettingsStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const root = document.documentElement
    
    // Reset all
    root.classList.remove('light', 'dark', 'theme-purple', 'theme-blue', 'theme-green', 'theme-pink', 'font-small', 'font-medium', 'font-large')

    // Apply Theme
    if (theme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.add(systemDark ? 'dark' : 'light')
    } else {
      root.classList.add(theme)
    }

    // Apply Accent Color
    root.classList.add(`theme-${accentColor}`)

    // Apply Font Size
    root.classList.add(`font-${fontSize}`)
    
  }, [theme, accentColor, fontSize, mounted])

  // Optional: Prevent hydration mismatch flash by rendering children only after mount, 
  // but to preserve SEO/SSR usually we just render children directly and let CSS handle the rest.
  return <>{children}</>
}
