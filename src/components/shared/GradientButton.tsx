import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

export interface GradientButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  rounded?: "full" | "xl" | "md"
}

const GradientButton = React.forwardRef<HTMLButtonElement, GradientButtonProps>(
  ({ className, asChild = false, rounded = "full", ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    
    return (
      <Comp
        className={cn(
          "relative inline-flex items-center justify-center font-medium text-white transition-all duration-300",
          "bg-primary-gradient hover:shadow-[0_4px_20px_rgba(139,92,246,0.4)] hover:scale-[1.02]",
          "disabled:opacity-50 disabled:pointer-events-none disabled:hover:scale-100 disabled:hover:shadow-none",
          {
            "rounded-full": rounded === "full",
            "rounded-xl": rounded === "xl",
            "rounded-md": rounded === "md",
          },
          "px-6 py-3",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
GradientButton.displayName = "GradientButton"

export { GradientButton }
