import Link from "next/link"
import { Download } from "lucide-react"

export function TopNav() {
  return (
    <div className="flex md:hidden items-center justify-between p-4 bg-background/80 backdrop-blur-xl sticky top-0 z-40 border-b border-card-border">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary-gradient flex items-center justify-center rotate-45 shadow-[0_0_15px_rgba(139,92,246,0.6)]">
          <span className="text-white font-bold -rotate-45 text-xl">N</span>
        </div>
        <span className="text-xl font-bold bg-clip-text text-transparent bg-primary-gradient">NoteSprint</span>
      </Link>
      
      <button className="p-2 rounded-full bg-card border border-card-border hover:bg-card-border transition-colors">
        <Download size={20} className="text-primary" />
      </button>
    </div>
  )
}
