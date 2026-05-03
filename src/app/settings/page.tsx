"use client"

import { useState } from "react"
import { useSettingsStore } from "@/store/useSettingsStore"
import { Switch } from "@/components/ui/switch"
import { Card } from "@/components/ui/card"
import { Info, Monitor, Palette, Type, Layout, Settings2, Trash2, RotateCcw, MessageCircle, Bug, Share2 } from "lucide-react"

export default function SettingsPage() {
  const settings = useSettingsStore()
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 2000)
  }

  const handleReset = () => {
    settings.resetAll()
    showToast("All settings reset to default")
  }

  const handleClearCache = async () => {
    // Clear any local blobs or canvas data
    const dbs = await window.indexedDB.databases()
    dbs.forEach(db => { if (db.name) window.indexedDB.deleteDatabase(db.name) })
    showToast("Cached files cleared")
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-20">
      <div className="text-center md:text-left mb-2">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your preferences and defaults.</p>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-success/20 border border-success/30 text-success px-4 py-2 rounded-xl backdrop-blur-md animate-in slide-in-from-top-4 shadow-lg flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success"></div>
          <span className="text-sm font-medium">{toast}</span>
        </div>
      )}

      {/* A. Appearance */}
      <Card className="p-6 bg-card border-card-border/50">
        <div className="flex items-center gap-2 mb-6 text-primary">
          <Palette size={20} />
          <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        </div>
        
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-muted-foreground">Select your interface theme.</p>
            </div>
            <div className="flex gap-2 bg-background p-1 rounded-lg border border-border">
              {(['dark', 'system', 'light'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { settings.setTheme(t); showToast("Theme updated") }}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${
                    settings.theme === t ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="font-medium">Accent Color</p>
              <p className="text-sm text-muted-foreground">Customize the primary color.</p>
            </div>
            <div className="flex gap-3">
              {(['purple', 'blue', 'green', 'pink'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => { settings.setAccentColor(c); showToast("Color updated") }}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    settings.accentColor === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                  } ${
                    c === 'purple' ? 'bg-[#8B5CF6]' :
                    c === 'blue' ? 'bg-[#3B82F6]' :
                    c === 'green' ? 'bg-[#10B981]' :
                    'bg-[#EC4899]'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="font-medium">Font Size</p>
              <p className="text-sm text-muted-foreground">Base interface text size.</p>
            </div>
            <div className="flex gap-2 bg-background p-1 rounded-lg border border-border">
              {(['small', 'medium', 'large'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { settings.setFontSize(s); showToast("Font size updated") }}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${
                    settings.fontSize === s ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Type size={14} className={s === 'small' ? 'scale-75' : s === 'large' ? 'scale-125' : ''} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* B. Default Processing Preferences */}
      <Card className="p-6 bg-card border-card-border/50">
        <div className="flex items-center gap-2 mb-6 text-primary">
          <Settings2 size={20} />
          <h2 className="text-lg font-semibold text-foreground">Default Preferences</h2>
        </div>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <p className="text-sm font-medium">Output Quality</p>
              <select 
                value={settings.defaultQuality}
                onChange={(e) => { settings.setDefaultProcessingPref('defaultQuality', e.target.value); showToast("Preference saved") }}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Document Size</p>
              <div className="flex gap-2 bg-background p-1 rounded-lg border border-border">
                <button
                  onClick={() => { settings.setDefaultProcessingPref('defaultSize', 'original'); showToast("Preference saved") }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
                    settings.defaultSize === 'original' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                  }`}
                >
                  Original
                </button>
                <button
                  onClick={() => { settings.setDefaultProcessingPref('defaultSize', 'a4'); showToast("Preference saved") }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
                    settings.defaultSize === 'a4' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                  }`}
                >
                  A4
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Orientation</p>
              <div className="flex gap-2 bg-background p-1 rounded-lg border border-border">
                <button
                  onClick={() => { settings.setDefaultProcessingPref('defaultOrientation', 'portrait'); showToast("Preference saved") }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
                    settings.defaultOrientation === 'portrait' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                  }`}
                >
                  Portrait
                </button>
                <button
                  onClick={() => { settings.setDefaultProcessingPref('defaultOrientation', 'landscape'); showToast("Preference saved") }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
                    settings.defaultOrientation === 'landscape' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                  }`}
                >
                  Landscape
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Slides per Page</p>
              <div className="flex items-center gap-2">
                <select 
                  value={settings.defaultRows}
                  onChange={(e) => { settings.setDefaultProcessingPref('defaultRows', parseInt(e.target.value)); showToast("Preference saved") }}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none"
                >
                  {[1,2,3,4].map(n => <option key={`r${n}`} value={n}>{n} Rows</option>)}
                </select>
                <span className="text-muted-foreground">×</span>
                <select 
                  value={settings.defaultCols}
                  onChange={(e) => { settings.setDefaultProcessingPref('defaultCols', parseInt(e.target.value)); showToast("Preference saved") }}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none"
                >
                  {[1,2,3,4].map(n => <option key={`c${n}`} value={n}>{n} Cols</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Add Separation Lines</p>
                <p className="text-xs text-muted-foreground">Draw lines between slides.</p>
              </div>
              <Switch 
                checked={settings.defaultAddSeparators} 
                onCheckedChange={(c) => { settings.setDefaultProcessingPref('defaultAddSeparators', c); showToast("Preference saved") }} 
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Add Page Numbers</p>
                <p className="text-xs text-muted-foreground">Number the final output pages.</p>
              </div>
              <Switch 
                checked={settings.defaultAddPageNumbers} 
                onCheckedChange={(c) => { settings.setDefaultProcessingPref('defaultAddPageNumbers', c); showToast("Preference saved") }} 
              />
            </div>
          </div>
        </div>
      </Card>

      {/* C. Privacy & Data */}
      <Card className="p-6 bg-card border-card-border/50">
        <div className="flex items-center gap-2 mb-4 text-primary">
          <Monitor size={20} />
          <h2 className="text-lg font-semibold text-foreground">Privacy & Data</h2>
        </div>
        
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3 mb-6">
          <Info className="text-primary flex-shrink-0 mt-0.5" size={18} />
          <p className="text-sm text-foreground/80">
            All processing happens completely in your browser. No files are uploaded to any server. Your data remains private.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={handleClearCache}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-background border border-border rounded-xl text-sm font-medium hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
          >
            <Trash2 size={16} />
            Clear Cached Files
          </button>
          <button 
            onClick={handleReset}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-sm font-medium hover:bg-destructive/20 transition-colors"
          >
            <RotateCcw size={16} />
            Reset All Settings
          </button>
        </div>
      </Card>

      {/* D. Shortcuts & Tips */}
      <Card className="p-6 bg-card border-card-border/50">
        <div className="flex items-center gap-2 mb-6 text-primary">
          <Layout size={20} />
          <h2 className="text-lg font-semibold text-foreground">Shortcuts & Tips</h2>
        </div>

        <div className="flex items-center justify-between mb-6">
          <p className="font-medium text-sm">Show tips on wizard steps</p>
          <Switch 
            checked={settings.showTips} 
            onCheckedChange={(c) => { settings.setShowTips(c); showToast("Preference saved") }} 
          />
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">Upload Document</span>
            <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">Ctrl + O</kbd>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">Next Step</span>
            <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">→</kbd>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">Previous Step</span>
            <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">←</kbd>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted-foreground">Close Modals</span>
            <kbd className="px-2 py-1 bg-background border border-border rounded text-xs font-mono">Esc</kbd>
          </div>
        </div>
      </Card>

      {/* E. About & Community */}
      <div className="px-2 pb-4">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">About & Community</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">App Version</span>
            <span className="text-sm text-muted-foreground font-mono">v1.0.0</span>
          </div>
          <a href="https://t.me/trackingerweb" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2 text-sm hover:text-primary transition-colors">
            <MessageCircle size={18} className="text-muted-foreground" />
            <span>Join Telegram Channel</span>
          </a>
          <a href="mailto:support@notesprint.app" className="flex items-center gap-3 py-2 text-sm hover:text-primary transition-colors">
            <Bug size={18} className="text-muted-foreground" />
            <span>Report a Bug</span>
          </a>
          <button 
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: 'NoteSprint', url: window.location.origin })
              } else {
                navigator.clipboard.writeText(window.location.origin)
                showToast("Link copied to clipboard")
              }
            }}
            className="flex items-center gap-3 py-2 text-sm hover:text-primary transition-colors text-left"
          >
            <Share2 size={18} className="text-muted-foreground" />
            <span>Share NoteSprint</span>
          </button>
        </div>
      </div>
    </div>
  )
}
