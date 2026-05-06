import * as React from "react"
import { motion } from "framer-motion"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepperProps {
  currentStep: number
  totalSteps: number
}

export function Stepper({ currentStep, totalSteps }: StepperProps) {
  return (
    <div className="flex items-center justify-between w-full mb-6 relative px-2">
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 sm:h-1 bg-card-border -z-10 rounded-full" />
      <div 
        className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 sm:h-1 bg-primary-gradient -z-10 rounded-full transition-all duration-500" 
        style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
      />
      
      {Array.from({ length: totalSteps }).map((_, i) => {
        const step = i + 1
        const isCompleted = step < currentStep
        const isCurrent = step === currentStep
        
        return (
          <div key={step} className="flex flex-col items-center">
            <motion.div 
              initial={false}
              animate={{
                backgroundColor: isCompleted ? "#22C55E" : isCurrent ? "#8B5CF6" : "#1A1A1A",
                borderColor: isCompleted ? "#22C55E" : isCurrent ? "#8B5CF6" : "#333",
              }}
              className={cn(
                "w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border sm:border-2 text-[10px] sm:text-sm font-bold transition-colors duration-300",
                isCompleted || isCurrent ? "text-white shadow-[0_0_10px_rgba(139,92,246,0.5)]" : "text-muted-foreground"
              )}
            >
              {isCompleted ? <Check size={12} className="sm:w-4 sm:h-4" strokeWidth={3} /> : step}
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}
