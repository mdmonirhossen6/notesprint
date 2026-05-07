"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, X, CheckCircle2, Send } from "lucide-react"
import { useAdminStore } from "@/store/useAdminStore"
import { supabase } from "@/lib/supabase"

type FeedbackState = "idle" | "rating" | "comment" | "success"

export function FeedbackWidget({ autoOpen = false }: { autoOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(false)
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("rating")
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const addFeedback = useAdminStore((state) => state.addFeedback)

  // Handle autoOpen prop
  useEffect(() => {
    if (autoOpen) {
      const timer = setTimeout(() => setIsOpen(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [autoOpen])

  // Auto-reset when closed
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setFeedbackState("rating")
        setRating(null)
        setComment("")
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const emojis = [
    { value: 1, emoji: "😞", label: "Terrible" },
    { value: 2, emoji: "😕", label: "Bad" },
    { value: 3, emoji: "😐", label: "Okay" },
    { value: 4, emoji: "🙂", label: "Good" },
    { value: 5, emoji: "🤩", label: "Excellent" },
  ]

  const handleRating = (value: number) => {
    setRating(value)
    setFeedbackState("comment")
  }

  const handleSubmit = async () => {
    if (rating === null) return
    
    // Save to Supabase
    try {
      const { error } = await supabase
        .from('feedbacks')
        .insert([
          { 
            rating, 
            comment
          }
        ])

      // Send to Telegram via our secure API route
      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment })
      }).catch(err => console.error('Telegram notification failed:', err))

      // Also save to the local admin store for immediate UI update if needed
      addFeedback({
        rating,
        comment
      })
    } catch (error: any) {
      console.error('Error submitting feedback to Supabase:', error)
      alert(`Note: Feedback saved locally but failed to reach Supabase: ${error.message || 'Unknown error'}`)
      
      // Fallback to local store if Supabase fails
      addFeedback({
        rating,
        comment
      })
    }
    
    setFeedbackState("success")
    
    // Auto close after 3 seconds
    setTimeout(() => {
      setIsOpen(false)
    }, 3000)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="mb-4 w-[320px] rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {feedbackState === "rating" && "How was your experience?"}
                {feedbackState === "comment" && rating && rating >= 4 ? "Glad you liked it! What worked well?" : ""}
                {feedbackState === "comment" && rating && rating < 4 ? "We're sorry! How can we improve?" : ""}
                {feedbackState === "success" && "Thank you!"}
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-[100px]">
              <AnimatePresence mode="wait">
                {feedbackState === "rating" && (
                  <motion.div
                    key="rating"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex justify-between gap-1 py-4"
                  >
                    {emojis.map((item) => (
                      <button
                        key={item.value}
                        onClick={() => handleRating(item.value)}
                        className="group flex flex-col items-center gap-2 rounded-xl p-2 transition-all hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        title={item.label}
                      >
                        <span className="text-2xl transition-transform group-hover:scale-125">
                          {item.emoji}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}

                {feedbackState === "comment" && (
                  <motion.div
                    key="comment"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col gap-4 py-2"
                  >
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                      We'd love to hear more from you! Please fill out our feedback form to help us improve.
                    </p>
                    <a
                      href="https://docs.google.com/forms/d/e/1FAIpQLScuqaXlXgGZexpIO7ri02yAtwdfxCeQxkCdCI7WO8zNM2tErg/viewform?usp=sharing&ouid=107285934840557712909"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        handleSubmit();
                      }}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary-gradient text-white text-sm font-semibold shadow-lg hover:shadow-primary/30 transition-all active:scale-95"
                    >
                      Fill Feedback Form <Send className="h-4 w-4" />
                    </a>
                    <button 
                      onClick={() => setFeedbackState("rating")}
                      className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                    >
                      Change rating
                    </button>
                  </motion.div>
                )}

                {feedbackState === "success" && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center py-6 text-center"
                  >
                    <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-500" />
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      Your feedback helps us make NoteSprint better.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <MessageSquare className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
