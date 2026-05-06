"use client"

import { useEffect, useRef, useState } from "react"
import { usePDFStore } from "@/store/usePDFStore"
import { GradientButton } from "@/components/shared/GradientButton"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { applyFiltersToCanvas } from "@/lib/imageFilters"
import { SunMedium, Eraser, Image as ImageIcon, Contrast, Crop, ArrowLeft, ArrowRight } from "lucide-react"

export function Step4Enhance() {
  const { pages, filters, setFilter, setStep } = usePDFStore()
  const selectedPages = pages.filter(p => p.selected)
  
  const [previewIndex, setPreviewIndex] = useState(0)
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null)
  const targetCanvasRef = useRef<HTMLCanvasElement>(null)

  const currentPage = selectedPages[previewIndex]

  // Load the original image into the source canvas
  useEffect(() => {
    if (!currentPage) return
    
    const img = new Image()
    img.onload = () => {
      const sourceCanvas = sourceCanvasRef.current
      if (sourceCanvas) {
        sourceCanvas.width = img.width
        sourceCanvas.height = img.height
        const ctx = sourceCanvas.getContext('2d')
        ctx?.drawImage(img, 0, 0)
        applyFilters()
      }
    }
    img.src = currentPage.thumbnailUrl
  }, [currentPage])

  // Apply filters whenever filters state changes
  useEffect(() => {
    applyFilters()
  }, [filters])

  const applyFilters = () => {
    if (sourceCanvasRef.current && targetCanvasRef.current) {
      applyFiltersToCanvas(sourceCanvasRef.current, targetCanvasRef.current, filters)
    }
  }

  const handleNextPreview = () => {
    if (previewIndex < selectedPages.length - 1) {
      setPreviewIndex(prev => prev + 1)
    }
  }

  const handlePrevPreview = () => {
    if (previewIndex > 0) {
      setPreviewIndex(prev => prev - 1)
    }
  }

  if (selectedPages.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="mb-4">No pages selected.</p>
        <Button onClick={() => setStep(3)}>Go back and select pages</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-2xl font-bold mb-1 sm:mb-2">Enhance Document</h2>
        <p className="text-muted-foreground text-xs sm:text-sm">Apply AI-inspired filters to clean up your notes</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 flex-1 mb-8">
        {/* Filter Controls */}
        <div className="flex-1 space-y-4">
          <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">Filters</h3>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SunMedium size={18} className="text-primary" />
                <div>
                  <p className="font-medium text-sm">Invert Colors</p>
                  <p className="text-xs text-muted-foreground">Dark mode to light mode</p>
                </div>
              </div>
              <Switch 
                checked={filters.invert} 
                onCheckedChange={(c) => setFilter('invert', c)} 
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Eraser size={18} className="text-primary" />
                <div>
                  <p className="font-medium text-sm">Clear Background</p>
                  <p className="text-xs text-muted-foreground">Remove paper texture/noise</p>
                </div>
              </div>
              <Switch 
                checked={filters.clearBg} 
                onCheckedChange={(c) => setFilter('clearBg', c)} 
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ImageIcon size={18} className="text-primary" />
                <div>
                  <p className="font-medium text-sm">Grayscale</p>
                  <p className="text-xs text-muted-foreground">Remove all colors</p>
                </div>
              </div>
              <Switch 
                checked={filters.grayscale} 
                onCheckedChange={(c) => {
                  setFilter('grayscale', c)
                  if (c && filters.blackAndWhite) setFilter('blackAndWhite', false)
                }} 
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Contrast size={18} className="text-primary" />
                <div>
                  <p className="font-medium text-sm">Black & White</p>
                  <p className="text-xs text-muted-foreground">High contrast for printing</p>
                </div>
              </div>
              <Switch 
                checked={filters.blackAndWhite} 
                onCheckedChange={(c) => {
                  setFilter('blackAndWhite', c)
                  if (c && filters.grayscale) setFilter('grayscale', false)
                }} 
              />
            </div>

            <div className="flex items-center justify-between opacity-50 pointer-events-none">
              <div className="flex items-center gap-3">
                <Crop size={18} className="text-primary" />
                <div>
                  <p className="font-medium text-sm">Remove Logo</p>
                  <p className="text-xs text-muted-foreground">Select area to erase (Pro)</p>
                </div>
              </div>
              <Switch checked={false} disabled />
            </div>
          </div>

          <div className="flex justify-between text-sm text-muted-foreground px-2">
            <span>Pages: {selectedPages.length}</span>
            <span>Removed: {pages.length - selectedPages.length}</span>
          </div>
        </div>

        {/* Live Preview */}
        <div className="flex-1 flex flex-col items-center">
          <div 
            className="relative w-full max-w-[280px] bg-white rounded-xl overflow-hidden shadow-lg border border-card-border mb-4"
            style={{ height: '400px' }}
          >
            <canvas ref={sourceCanvasRef} className="hidden" />
            <canvas ref={targetCanvasRef} className="w-full h-full object-contain" />
          </div>
          
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handlePrevPreview}
              disabled={previewIndex === 0}
            >
              <ArrowLeft size={16} />
            </Button>
            <span className="text-sm font-medium">
              Page {currentPage?.pageNumber} ({previewIndex + 1} of {selectedPages.length})
            </span>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleNextPreview}
              disabled={previewIndex === selectedPages.length - 1}
            >
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-card-border pt-4 sm:pt-6">
        <Button variant="outline" onClick={() => setStep(3)} className="w-full sm:w-auto h-10 px-4 text-xs sm:text-sm">
          Back
        </Button>
        <GradientButton onClick={() => setStep(5)} className="w-full sm:w-auto py-2.5 sm:py-3 text-sm sm:text-base">
          Continue to Layout
        </GradientButton>
      </div>
    </div>
  )
}
