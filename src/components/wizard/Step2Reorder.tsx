"use client"

import { usePDFStore } from "@/store/usePDFStore"
import { GradientButton } from "@/components/shared/GradientButton"
import { Button } from "@/components/ui/button"
import { FileType, ArrowUp, ArrowDown, X, Plus } from "lucide-react"

export function Step2Reorder() {
  const { files, removeFile, reorderFiles, setStep } = usePDFStore()

  const moveUp = (index: number) => {
    if (index > 0) {
      reorderFiles(index, index - 1)
    }
  }

  const moveDown = (index: number) => {
    if (index < files.length - 1) {
      reorderFiles(index, index + 1)
    }
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px]">
        <p className="text-muted-foreground mb-4">No files uploaded yet.</p>
        <GradientButton onClick={() => setStep(1)}>Go Back to Upload</GradientButton>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-2xl font-bold mb-1 sm:mb-2">Reorder & Merge</h2>
        <p className="text-muted-foreground text-xs sm:text-sm">Arrange your PDFs in the desired order</p>
      </div>

      <div className="flex-1 space-y-3 mb-8 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
        {files.map((file, index) => (
          <div 
            key={file.id} 
            className="flex items-center gap-4 bg-card border border-card-border p-4 rounded-xl shadow-sm hover:border-primary/50 transition-colors"
          >
            <div className="flex flex-col gap-1">
              <button 
                onClick={() => moveUp(index)}
                disabled={index === 0}
                className="p-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowUp size={14} />
              </button>
              <button 
                onClick={() => moveDown(index)}
                disabled={index === files.length - 1}
                className="p-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowDown size={14} />
              </button>
            </div>
            
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
              <FileType size={20} />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            
            <button 
              onClick={() => removeFile(file.id)}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-card-border pt-4 sm:pt-6">
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={() => setStep(1)} className="flex-1 sm:flex-none h-10 px-3 text-xs sm:text-sm">
            Back
          </Button>
          <Button variant="ghost" className="flex-1 sm:flex-none text-primary hover:text-primary hover:bg-primary/10 h-10 px-3 text-xs sm:text-sm" onClick={() => setStep(1)}>
            <Plus size={14} className="mr-1 sm:mr-2" />
            <span>Add More</span>
          </Button>
        </div>
        
        <GradientButton onClick={() => setStep(3)} className="w-full sm:w-auto py-2.5 sm:py-3 text-sm sm:text-base">
          Continue to Preview
        </GradientButton>
      </div>
    </div>
  )
}
