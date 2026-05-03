"use client"

import { useEffect, useState } from "react"
import { usePDFStore } from "@/store/usePDFStore"
import { generateFinalPDF } from "@/lib/pdfExport"
import { GradientButton } from "@/components/shared/GradientButton"
import { CheckCircle2, FileDown, Download } from "lucide-react"

export function Step6Processing() {
  const { pages, filters, layout } = usePDFStore()
  const selectedPages = pages.filter(p => p.selected)
  
  const [progress, setProgress] = useState(0)
  const [isProcessing, setIsProcessing] = useState(true)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)

  useEffect(() => {
    let isMounted = true

    const processPDF = async () => {
      try {
        const state = usePDFStore.getState()
        const pagesToProcess = state.pages.filter(p => p.selected)
        
        const blob = await generateFinalPDF(
          pagesToProcess,
          state.filters,
          state.layout,
          (p) => {
            if (isMounted) setProgress(Math.round(p))
          }
        )
        
        if (isMounted) {
          const url = URL.createObjectURL(blob)
          setPdfUrl(url)
          setPdfBlob(blob)
          setIsProcessing(false)
        }
      } catch (err) {
        console.error("Failed to generate PDF:", err)
        if (isMounted) setIsProcessing(false)
      }
    }

    processPDF()

    return () => {
      isMounted = false
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, []) // Empty dependency array because we read state dynamically

  const handleDownload = () => {
    if (pdfUrl) {
      const a = document.createElement('a')
      a.href = pdfUrl
      a.download = `NoteSprint_${new Date().getTime()}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-in fade-in duration-300">
        <div className="w-32 h-32 relative mb-8">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
          <div 
            className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"
            style={{ animationDuration: '3s' }}
          ></div>
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold bg-clip-text text-transparent bg-primary-gradient shadow-primary">N</div>
        </div>
        
        <h2 className="text-2xl font-bold mb-4">Optimizing...</h2>
        
        <div className="w-full max-w-md bg-card border border-card-border rounded-full h-3 mb-2 overflow-hidden relative">
          <div 
            className="h-full bg-primary-gradient transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <p className="text-muted-foreground text-sm">{progress}% Complete</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-in zoom-in-95 duration-500">
      <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center mb-6 text-success shadow-[0_0_30px_rgba(34,197,94,0.3)]">
        <CheckCircle2 size={40} />
      </div>
      
      <h2 className="text-3xl font-bold mb-2">Success!</h2>
      <p className="text-muted-foreground mb-8">Your document is ready.</p>

      <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-8 text-center max-w-sm w-full">
        <p className="text-sm text-warning font-medium">Review the Notes Before Printing</p>
      </div>

      <div className="bg-card border border-card-border rounded-2xl p-6 flex flex-col items-center w-full max-w-sm mb-8">
        <FileDown size={48} className="text-primary mb-4 opacity-80" />
        <p className="font-semibold text-lg mb-1">Enhanced PDF</p>
        <p className="text-sm text-muted-foreground mb-4">
          {pdfBlob ? (pdfBlob.size / 1024 / 1024).toFixed(2) : "0"} MB • {Math.ceil(selectedPages.length / (layout.rows * layout.cols))} Pages
        </p>
        
        <div className="w-full mt-2">
          <GradientButton onClick={handleDownload} className="w-full">
            <Download size={18} className="mr-2" />
            Download PDF
          </GradientButton>
        </div>
        <div className="mt-4 text-xs font-medium text-success bg-success/10 px-3 py-1 rounded-full border border-success/20">
          100% FREE
        </div>
      </div>
      
      <button 
        onClick={() => window.location.href = '/'}
        className="text-sm text-muted-foreground hover:text-white transition-colors underline underline-offset-4"
      >
        Process Another File
      </button>
    </div>
  )
}
