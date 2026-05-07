"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Lock, LogOut, Users, MessageSquare, Star, Trash2, FileDown } from "lucide-react"
import { useAdminStore, Feedback } from "@/store/useAdminStore"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"

export default function AdminPage() {
  const [mounted, setMounted] = useState(false)
  const [passcode, setPasscode] = useState("")
  const [error, setError] = useState(false)
  const [dbFeedbacks, setDbFeedbacks] = useState<Feedback[]>([])
  const [pdfFiles, setPdfFiles] = useState<any[]>([])
  const [pdfCount, setPdfCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  
  const { isAuthenticated, login, logout, feedbacks, clearFeedbacks } = useAdminStore()

  // Fetch feedbacks and PDF count from Supabase
  const fetchData = async () => {
    try {
      setLoading(true)
      
      // Fetch feedbacks
      const { data: feedbackData, error: feedbackError } = await supabase
        .from('feedbacks')
        .select('*')
        .order('timestamp', { ascending: false })

      if (feedbackError) throw feedbackError
      if (feedbackData) setDbFeedbacks(feedbackData)

      // Fetch PDF files from storage
      const { data: storageData, error: storageError } = await supabase
        .storage
        .from('pdfs')
        .list('', {
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' }
        })

      if (!storageError && storageData) {
        const actualFiles = storageData.filter(file => file.name !== '.emptyFolderPlaceholder')
        setPdfFiles(actualFiles)
        setPdfCount(actualFiles.length)
      } else if (storageError) {
        console.error('Storage error:', storageError)
      }
    } catch (err: any) {
      console.error('Error fetching data:', err)
      setFetchError(err.message || 'Failed to connect to Supabase. Check your table and bucket settings.')
    } finally {
      setLoading(false)
    }
  }

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
    if (isAuthenticated) {
      fetchData()
    }
  }, [isAuthenticated])

  if (!mounted) return null

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    const success = login(passcode)
    if (!success) {
      setError(true)
      setTimeout(() => setError(false), 2000)
    }
  }

  // Mock data for current users
  const activeUsers = Math.floor(Math.random() * 50) + 12

  // Calculate stats
  const displayFeedbacks = dbFeedbacks.length > 0 ? dbFeedbacks : feedbacks
  const totalFeedbacks = displayFeedbacks.length
  const averageRating = totalFeedbacks > 0 
    ? (displayFeedbacks.reduce((acc, curr) => acc + curr.rating, 0) / totalFeedbacks).toFixed(1)
    : "0.0"

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  const getPdfUrl = (fileName: string) => {
    const { data } = supabase.storage.from('pdfs').getPublicUrl(fileName)
    return data.publicUrl
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getEmojiForRating = (rating: number) => {
    const emojis: Record<number, string> = {
      1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "🤩"
    }
    return emojis[rating] || "😐"
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-[80vh] w-full flex-col items-center justify-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900">
              <Lock className="h-6 w-6 text-neutral-600 dark:text-neutral-400" />
            </div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Admin Access</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Enter your passcode to continue</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <input
                type="password"
                placeholder="Passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className={`w-full rounded-lg border bg-transparent px-4 py-3 text-center text-lg tracking-widest outline-none transition-colors focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100 ${
                  error ? "border-red-500 ring-1 ring-red-500" : "border-neutral-200 dark:border-neutral-800"
                }`}
                autoFocus
              />
              {error && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-center text-xs text-red-500">
                  Incorrect passcode
                </motion.p>
              )}
            </div>
            <Button type="submit" className="w-full py-6 text-lg">
              Unlock
            </Button>
          </form>
        </motion.div>
      </div>
    )
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full space-y-8 pb-10"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Admin Dashboard</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Overview and user feedback</p>
        </div>
        <Button variant="outline" onClick={logout} className="gap-2">
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Metric Cards */}
        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <FileDown className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Collected PDFs</p>
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">{pdfCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Total Feedbacks</p>
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">{totalFeedbacks}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <Star className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Avg Rating</p>
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">{averageRating}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h2 className="font-semibold text-neutral-900 dark:text-white">Recent Feedback</h2>
          {feedbacks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFeedbacks} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
              <Trash2 className="mr-2 h-4 w-4" />
              Clear All
            </Button>
          )}
        </div>
        
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 dark:text-neutral-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
              <p className="mt-4">Loading feedbacks...</p>
            </div>
          ) : displayFeedbacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 dark:text-neutral-400">
              <MessageSquare className="mb-2 h-8 w-8 opacity-20" />
              <p>No feedback received yet.</p>
              {fetchError && <p className="mt-2 text-xs text-red-500 font-mono">{fetchError}</p>}
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Rating</th>
                  <th className="px-6 py-3 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {displayFeedbacks.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
                    <td className="whitespace-nowrap px-6 py-4 text-neutral-500 dark:text-neutral-400">
                      {formatDate(item.timestamp || (item as any).created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getEmojiForRating(item.rating)}</span>
                        <span className="font-medium text-neutral-900 dark:text-neutral-200">{item.rating}/5</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">
                      {item.comment || <span className="text-neutral-400 italic">No comment provided</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h2 className="font-semibold text-neutral-900 dark:text-white">Collected Documents</h2>
          <span className="text-xs font-medium bg-neutral-100 text-neutral-600 px-2 py-1 rounded-full dark:bg-neutral-900 dark:text-neutral-400">
            Recent {pdfFiles.length} files
          </span>
        </div>
        
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 dark:text-neutral-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
              <p className="mt-4">Loading documents...</p>
            </div>
          ) : pdfFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 dark:text-neutral-400">
              <FileDown className="mb-2 h-8 w-8 opacity-20" />
              <p>No documents collected yet.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-6 py-3 font-medium">File Name</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Size</th>
                  <th className="px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {pdfFiles.map((file) => (
                  <tr key={file.id} className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
                    <td className="px-6 py-4 font-medium text-neutral-900 dark:text-neutral-200">
                      {file.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-neutral-500 dark:text-neutral-400">
                      {formatDate(file.created_at)}
                    </td>
                    <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400">
                      {formatFileSize(file.metadata?.size || 0)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        asChild
                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <a href={getPdfUrl(file.name)} target="_blank" rel="noopener noreferrer">
                          <FileDown className="mr-2 h-4 w-4" />
                          Download
                        </a>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </motion.div>
  )
}
