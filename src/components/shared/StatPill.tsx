import * as React from "react"
import { cn } from "@/lib/utils"

interface StatPillProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  variant?: "success" | "default" | "primary"
}

export function StatPill({ children, variant = "default", className, ...props }: StatPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
        {
          "bg-success/10 text-success border-success/20": variant === "success",
          "bg-primary/10 text-primary border-primary/20": variant === "primary",
          "bg-card text-muted-foreground border-card-border": variant === "default",
        },
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
