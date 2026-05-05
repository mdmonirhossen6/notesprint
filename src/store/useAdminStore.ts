import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Feedback {
  id: string;
  rating: number;
  comment: string;
  timestamp: string;
}

interface AdminState {
  isAuthenticated: boolean;
  feedbacks: Feedback[];
  login: (code: string) => boolean;
  logout: () => void;
  addFeedback: (feedback: Omit<Feedback, 'id' | 'timestamp'>) => void;
  clearFeedbacks: () => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      feedbacks: [],
      
      login: (code: string) => {
        if (code === '22803') {
          set({ isAuthenticated: true })
          return true
        }
        return false
      },
      
      logout: () => {
        set({ isAuthenticated: false })
      },
      
      addFeedback: (feedback) => {
        const newFeedback: Feedback = {
          ...feedback,
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toISOString(),
        }
        set((state) => ({
          feedbacks: [newFeedback, ...state.feedbacks],
        }))
      },
      
      clearFeedbacks: () => {
        set({ feedbacks: [] })
      }
    }),
    {
      name: 'notesprint-admin-storage',
    }
  )
)
