"use client"

import { useEffect, useState } from "react"
import { usePDFStore } from "@/store/usePDFStore"
import { extractPDFPages } from "@/lib/pdfProcessing"
import { GradientButton } from "@/components/shared/GradientButton"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle, FilePlus2, CheckCircle2, Circle } from "lucide-react"

export function Step3Preview() {
  const { files, pages, setPages, togglePageSelection, setStep } = usePDFStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Only extract if we haven't already or if files changed
    // For simplicity here, we re-extract if pages is empty
    if (pages.length === 0 && files.length > 0) {
      const loadPages = async () => {
        setLoading(true)
        setError(null)
        try {
          const allPages = []
          for (const file of files) {
            const filePages = await extractPDFPages(file.file, file.id)
            allPages.push(...filePages)
          }
          setPages(allPages)
        } catch (err) {
          console.error("Error loading PDF:", err)
          setError("Failed to parse PDF files. They might be corrupted or protected.")
        } finally {
          setLoading(false)
        }
      }
      loadPages()
    }
  }, [files, pages.length, setPages])

  const selectedCount = pages.filter(p => p.selected).length

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
        <div className="w-16 h-16 relative">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin-slow"></div>
          <div className="absolute inset-0 flex items-center justify-center text-primary font-bold">N</div>
        </div>
        <p className="mt-6 text-lg font-medium text-gradient">Extracting Pages...</p>
        <p className="text-muted-foreground text-sm mt-2">This happens locally in your browser</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
        <AlertTriangle size={48} className="text-destructive mb-4" />
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" onClick={() => setStep(1)}>Go Back</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Preview and Edit Pages</h2>
        <p className="text-muted-foreground text-sm">Select the pages you want to keep</p>
      </div>

      <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-6 flex items-start gap-3">
        <AlertTriangle className="text-warning flex-shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-warning/90">
          We display low quality images for a smooth experience. Final output PDF will be in high quality.
        </p>
      </div>

      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {pages.map((page, index) => (
          <div 
            key={page.id} 
            onClick={() => togglePageSelection(page.id)}
            className={`relative group cursor-pointer rounded-xl border-2 transition-all duration-200 overflow-hidden bg-card ${
              page.selected ? 'border-primary shadow-[0_0_15px_rgba(139,92,246,0.3)]' : 'border-card-border hover:border-primary/50'
            }`}
          >
            <div className="absolute top-2 right-2 z-10">
              {page.selected ? (
                <CheckCircle2 className="text-primary bg-background rounded-full" size={24} />
              ) : (
                <Circle className="text-muted-foreground/50 bg-background/50 rounded-full group-hover:text-primary/50" size={24} />
              )}
            </div>
            
            <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur px-2 py-0.5 rounded-md text-xs font-medium">
              {index + 1}
            </div>

            <div 
              className={`w-full flex items-center justify-center p-2 ${!page.selected && 'opacity-50 grayscale'}`}
              style={{ height: '300px' }}
            >
              <img 
                src={page.thumbnailUrl} 
                alt={`Page ${page.pageNumber}`} 
                className="w-full h-full object-contain shadow-sm border border-card-border bg-white"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-card-border pt-6 mt-auto">
        <div className="flex flex-col gap-1">
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/10">
              <FilePlus2 size={16} className="mr-2" />
              Add Blank Slide
            </Button>
          </div>
          <span className="text-xs text-muted-foreground ml-2 mt-2">
            {selectedCount} of {pages.length} pages selected
          </span>
        </div>
        
        <GradientButton 
          onClick={() => setStep(4)}
          disabled={selectedCount === 0}
        >
          Enhance Document
        </GradientButton>
      </div>
    </div>
  )
}
