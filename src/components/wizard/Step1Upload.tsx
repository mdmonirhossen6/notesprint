"use client"

import { useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { UploadCloud, FileType, CheckCircle2 } from "lucide-react"
import { usePDFStore } from "@/store/usePDFStore"
import { useSettingsStore } from "@/store/useSettingsStore"
import { GradientButton } from "@/components/shared/GradientButton"

export function Step1Upload() {
  const { files, addFiles, setStep, applyDefaults } = usePDFStore()
  const settings = useSettingsStore()

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Filter only PDFs
    const pdfs = acceptedFiles.filter(file => file.type === "application/pdf")
    if (pdfs.length > 0) {
      applyDefaults(settings)
      addFiles(pdfs)
    }
  }, [addFiles, applyDefaults, settings])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true
  })

  return (
    <div className="flex flex-col h-full flex-1 animate-in fade-in zoom-in-95 duration-300">
      <div className="text-center mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-2xl font-bold mb-1 sm:mb-2">Upload Files</h2>
        <p className="text-muted-foreground text-xs sm:text-sm">Drag and drop your PDF notes here</p>
      </div>

      <div 
        {...getRootProps()} 
        className={`flex-1 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-10 transition-all duration-300 cursor-pointer min-h-[300px]
          ${isDragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-card-border hover:border-primary/50 hover:bg-white/5'}`}
      >
        <input {...getInputProps()} />
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6 text-primary">
          <UploadCloud size={40} />
        </div>
        <p className="text-lg font-medium mb-2">
          {isDragActive ? "Drop your PDFs here!" : "Drag & drop PDF files"}
        </p>
        <p className="text-sm text-muted-foreground mb-8">or click to browse from your device</p>
        
        <GradientButton type="button" onClick={(e) => e.preventDefault()}>
          Select PDF(s)
        </GradientButton>
      </div>

      {files.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="text-success" size={18} />
              {files.length} File{files.length !== 1 ? 's' : ''} Ready
            </h3>
          </div>
          
          <div className="flex flex-wrap gap-3 mb-6 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
            {files.map((file) => (
              <div key={file.id} className="flex items-center gap-2 bg-card border border-card-border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] max-w-xs">
                <FileType size={16} className="text-primary flex-shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-4">
            <GradientButton onClick={() => setStep(2)} className="w-full sm:w-auto py-2.5 sm:py-3 text-sm sm:text-base">
              Continue to Reorder
            </GradientButton>
          </div>
        </div>
      )}
      
      {files.length === 0 && (
        <div className="mt-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-4 border-t border-card-border pt-6">
          <span>Upload</span>
          <span className="w-1 h-1 rounded-full bg-card-border" />
          <span>Process</span>
          <span className="w-1 h-1 rounded-full bg-card-border" />
          <span>Download</span>
        </div>
      )}
    </div>
  )
}
