"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, ClipboardList, Wrench, Settings, Send, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"

export function Sidebar() {
  const pathname = usePathname()

  const navItems = [
    { icon: Home, label: "Home", href: "/" },
    { icon: Wrench, label: "Tools", href: "/tools" },
    { icon: Settings, label: "Settings", href: "/settings" },
  ]

  return (
    <div className="hidden md:flex flex-col w-64 h-screen border-r border-card-border bg-background/50 backdrop-blur-xl sticky top-0">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-gradient flex items-center justify-center rotate-45 shadow-[0_0_15px_rgba(139,92,246,0.6)]">
            <span className="text-white font-bold -rotate-45 text-xl">N</span>
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-primary-gradient">NoteSprint</span>
        </Link>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300",
                isActive 
                  ? "bg-primary/20 text-primary border border-primary/30 shadow-[inset_0_0_20px_rgba(139,92,246,0.1)]" 
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <Icon size={20} className={cn(isActive && "drop-shadow-[0_0_8px_rgba(139,92,246,0.8)]")} />
              <span className="font-medium">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 mt-auto">
        <div className="bg-gradient-to-b from-primary/10 to-primary/5 border border-primary/20 rounded-2xl p-4 shadow-[0_0_15px_rgba(139,92,246,0.05)]">
          <h3 className="text-xs font-semibold text-primary mb-3 uppercase tracking-wider px-1">Community</h3>
          <div className="space-y-2">
            <a 
              href="https://t.me/trackingerweb" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <Send size={16} className="text-[#2AABEE]" />
              <span>Telegram Channel</span>
            </a>
            <a 
              href="https://t.me/trackingerapp" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <Users size={16} className="text-[#2AABEE]" />
              <span>Telegram Group</span>
            </a>
            <a 
              href="https://discord.gg/Kv7xmf2zVC" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <MessageSquare size={16} className="text-[#5865F2]" />
              <span>Discord</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
