"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

export function TelegramPopup() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    // Check if dismissed
    const isDismissed = localStorage.getItem("noteSprint_tgPromptDismissed")
    if (!isDismissed) {
      // Trigger after 2 seconds
      const timer = setTimeout(() => {
        setIsOpen(true)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleDismiss = () => {
    setIsOpen(false)
    localStorage.setItem("noteSprint_tgPromptDismissed", "true")
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-sm bg-surface border border-border rounded-2xl p-6 shadow-2xl animate-in zoom-in-95 duration-300">
        <button 
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-muted-foreground hover:text-white transition-colors p-1"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center pt-4 pb-2">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#2AABEE] to-[#229ED9] flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(42,171,238,0.4)]">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white fill-current">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.892-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          </div>
          
          <h2 className="text-xl font-bold mb-2">Join Our Telegram Channel</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Stay updated with the latest features, tips, and new tools.
          </p>

          <div className="w-full space-y-3">
            <a 
              href="https://t.me/trackingerweb" 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={handleDismiss}
              className="block w-full py-3 px-4 bg-gradient-to-r from-[#2AABEE] to-[#229ED9] text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
            >
              Join Channel
            </a>
            <button 
              onClick={handleDismiss}
              className="block w-full py-3 px-4 text-sm text-muted-foreground hover:text-white transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
