import * as React from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface ToolCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  icon: React.ReactNode
}

export function ToolCard({ title, icon, className, ...props }: ToolCardProps) {
  return (
    <Card 
      className={cn(
        "flex flex-col items-center justify-center p-6 text-center cursor-pointer",
        "transition-all duration-200 hover:bg-white/5 border border-card-border rounded-xl",
        className
      )}
      {...props}
    >
      <div className="mb-4 text-primary bg-primary/10 p-4 rounded-2xl">
        {icon}
      </div>
      <h3 className="font-medium text-sm text-foreground/90">{title}</h3>
    </Card>
  )
}
