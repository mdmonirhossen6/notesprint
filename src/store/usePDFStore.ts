import { create } from 'zustand'

export interface PDFFile {
  id: string
  file: File
  name: string
  size: number
}

export interface PageThumbnail {
  id: string
  pageNumber: number
  pdfId: string
  thumbnailUrl: string
  selected: boolean
}

interface LayoutSettings {
  quality: 'low' | 'medium' | 'high'
  size: 'original' | 'a4'
  orientation: 'portrait' | 'landscape'
  rows: number
  cols: number
  addSeparators: boolean
  addPageNumbers: boolean
}

interface Filters {
  invert: boolean
  clearBg: boolean
  grayscale: boolean
  blackAndWhite: boolean
  removeLogo: boolean
}

interface PDFStore {
  currentStep: number
  setStep: (step: number) => void
  
  files: PDFFile[]
  addFiles: (newFiles: File[]) => void
  removeFile: (id: string) => void
  reorderFiles: (startIndex: number, endIndex: number) => void
  applyDefaults: (defaults: any) => void
  
  pages: PageThumbnail[]
  setPages: (pages: PageThumbnail[]) => void
  togglePageSelection: (id: string) => void
  
  filters: Filters
  setFilter: (key: keyof Filters, value: boolean) => void
  
  layout: LayoutSettings
  setLayout: (key: keyof LayoutSettings, value: any) => void
}

export const usePDFStore = create<PDFStore>((set) => ({
  currentStep: 1,
  setStep: (step) => set({ currentStep: step }),

  files: [],
  addFiles: (newFiles) => set((state) => ({
    files: [
      ...state.files,
      ...newFiles.map(f => ({
        id: Math.random().toString(36).substring(7),
        file: f,
        name: f.name,
        size: f.size
      }))
    ]
  })),
  removeFile: (id) => set((state) => ({
    files: state.files.filter(f => f.id !== id),
    pages: state.pages.filter(p => p.pdfId !== id)
  })),
  reorderFiles: (startIndex, endIndex) => set((state) => {
    const result = Array.from(state.files)
    const [removed] = result.splice(startIndex, 1)
    result.splice(endIndex, 0, removed)
    return { files: result }
  }),
  applyDefaults: (defaults) => set((state) => ({
    layout: {
      ...state.layout,
      quality: defaults.defaultQuality || 'high',
      size: defaults.defaultSize || 'original',
      orientation: defaults.defaultOrientation || 'portrait',
      rows: defaults.defaultRows || 1,
      cols: defaults.defaultCols || 1,
      addSeparators: defaults.defaultAddSeparators || false,
      addPageNumbers: defaults.defaultAddPageNumbers || false,
    }
  })),

  pages: [],
  setPages: (pages) => set({ pages }),
  togglePageSelection: (id) => set((state) => ({
    pages: state.pages.map(p => p.id === id ? { ...p, selected: !p.selected } : p)
  })),

  filters: {
    invert: false,
    clearBg: false,
    grayscale: false,
    blackAndWhite: false,
    removeLogo: false,
  },
  setFilter: (key, value) => set((state) => ({
    filters: { ...state.filters, [key]: value }
  })),

  layout: {
    quality: 'high',
    size: 'original',
    orientation: 'portrait',
    rows: 1,
    cols: 1,
    addSeparators: false,
    addPageNumbers: false,
  },
  setLayout: (key, value) => set((state) => ({
    layout: { ...state.layout, [key]: value }
  }))
}))
