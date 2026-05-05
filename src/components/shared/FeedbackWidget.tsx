"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, X, CheckCircle2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAdminStore } from "@/store/useAdminStore"

type FeedbackState = "idle" | "rating" | "comment" | "success"

export function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("rating")
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const addFeedback = useAdminStore((state) => state.addFeedback)

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

  const handleSubmit = () => {
    if (rating === null) return
    
    // Save to the admin store
    addFeedback({
      rating,
      comment
    })
    
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
                    className="flex flex-col gap-3"
                  >
                    <Textarea
                      placeholder="Tell us more (optional)..."
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      className="min-h-[80px] resize-none text-sm"
                      autoFocus
                    />
                    <div className="flex justify-between">
                      <Button variant="ghost" size="sm" onClick={() => setFeedbackState("rating")}>
                        Back
                      </Button>
                      <Button size="sm" onClick={handleSubmit} className="gap-2">
                        Submit <Send className="h-3 w-3" />
                      </Button>
                    </div>
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
