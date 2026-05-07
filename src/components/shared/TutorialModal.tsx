"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Play, X } from "lucide-react"

export function TutorialModal() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Floating Button or Trigger */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary-gradient text-white shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-all hover:shadow-[0_0_30px_rgba(139,92,246,0.6)]"
        title="Watch Tutorial"
      >
        <Play className="h-5 w-5 fill-current ml-0.5" />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black"
            >
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors border border-white/10"
              >
                <X className="h-5 w-5" />
              </button>
              
              <iframe
                src="https://www.youtube.com/embed/QiPac7tY7Vw?autoplay=1"
                title="NoteSprint Tutorial"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
