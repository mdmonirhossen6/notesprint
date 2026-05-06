"use client"

import { usePDFStore } from "@/store/usePDFStore"
import { GradientButton } from "@/components/shared/GradientButton"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { LayoutDashboard } from "lucide-react"

export function Step5Layout() {
  const { layout, setLayout, setStep } = usePDFStore()

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-2xl font-bold mb-1 sm:mb-2">Layout Settings</h2>
        <p className="text-muted-foreground text-xs sm:text-sm">Configure how your final PDF will look</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 flex-1 mb-8">
        <div className="flex-1 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Output Quality</h3>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map(q => (
                <button
                  key={q}
                  onClick={() => setLayout('quality', q)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium capitalize border transition-all ${
                    layout.quality === q 
                      ? 'bg-primary/20 border-primary text-primary shadow-[inset_0_0_10px_rgba(139,92,246,0.2)]' 
                      : 'bg-card border-card-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Document Size</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setLayout('size', 'original')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all ${
                  layout.size === 'original'
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-card border-card-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                Original
              </button>
              <button
                onClick={() => setLayout('size', 'a4')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all ${
                  layout.size === 'a4'
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-card border-card-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                A4 Page
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Slides per Page</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1 flex items-center gap-2 bg-card border border-card-border rounded-lg p-1">
                <span className="text-xs text-muted-foreground pl-2">Rows:</span>
                <select 
                  className="bg-transparent text-sm w-full outline-none py-1"
                  value={layout.rows}
                  onChange={(e) => setLayout('rows', parseInt(e.target.value))}
                >
                  {[1,2,3,4].map(n => <option key={n} value={n} className="bg-background">{n}</option>)}
                </select>
              </div>
              <span className="text-muted-foreground">×</span>
              <div className="flex-1 flex items-center gap-2 bg-card border border-card-border rounded-lg p-1">
                <span className="text-xs text-muted-foreground pl-2">Cols:</span>
                <select 
                  className="bg-transparent text-sm w-full outline-none py-1"
                  value={layout.cols}
                  onChange={(e) => setLayout('cols', parseInt(e.target.value))}
                >
                  {[1,2,3,4].map(n => <option key={n} value={n} className="bg-background">{n}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-card-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Add Separation Lines</span>
              <Switch 
                checked={layout.addSeparators}
                onCheckedChange={(c) => setLayout('addSeparators', c)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Add Page Numbers</span>
              <Switch 
                checked={layout.addPageNumbers}
                onCheckedChange={(c) => setLayout('addPageNumbers', c)}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center">
          <div 
            className="w-full max-w-[250px] bg-white rounded-md p-2 shadow-xl border border-card-border relative flex flex-col items-center justify-center"
            style={{ height: '350px' }}
          >
            {/* Visual preview of N-up layout */}
            <div 
              className="w-full h-full border border-dashed border-gray-300 grid gap-1 p-1"
              style={{
                gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
                gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`
              }}
            >
              {Array.from({ length: layout.rows * layout.cols }).map((_, i) => (
                <div key={i} className="bg-gray-100 border border-gray-200 rounded flex items-center justify-center relative">
                  <LayoutDashboard className="text-gray-300 w-1/3 h-1/3" />
                  {layout.addPageNumbers && i === layout.rows * layout.cols - 1 && (
                    <span className="absolute bottom-0 right-1 text-[8px] text-gray-400">1</span>
                  )}
                </div>
              ))}
            </div>
            {layout.addSeparators && layout.rows > 1 && (
              <div className="absolute inset-x-2 top-1/2 border-t border-dashed border-gray-400"></div>
            )}
            {layout.addSeparators && layout.cols > 1 && (
              <div className="absolute inset-y-2 left-1/2 border-l border-dashed border-gray-400"></div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-4">Layout Preview</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-card-border pt-4 sm:pt-6">
        <Button variant="outline" onClick={() => setStep(4)} className="w-full sm:w-auto h-10 px-4 text-xs sm:text-sm">
          Back
        </Button>
        <GradientButton onClick={() => setStep(6)} className="w-full sm:w-auto py-2.5 sm:py-3 text-sm sm:text-base">
          Process File ☁↑
        </GradientButton>
      </div>
    </div>
  )
}
