"use client"

import { usePDFStore } from "@/store/usePDFStore"
import { Stepper } from "@/components/wizard/Stepper"
import { Step1Upload } from "@/components/wizard/Step1Upload"
// We will import other steps as we create them
import { Step2Reorder } from "@/components/wizard/Step2Reorder"
import { Step3Preview } from "@/components/wizard/Step3Preview"
import { Step4Enhance } from "@/components/wizard/Step4Enhance"
import { Step5Layout } from "@/components/wizard/Step5Layout"
import { Step6Processing } from "@/components/wizard/Step6Processing"

const TOTAL_STEPS = 6

export default function ProcessPage() {
  const currentStep = usePDFStore((state) => state.currentStep)

  return (
    <div className="flex flex-col gap-3 max-w-3xl mx-auto w-full pt-2 px-2 sm:px-4">
      <div className="text-center mb-1">
        <h1 className="text-xl sm:text-3xl font-bold mb-1">Process Document</h1>
        <p className="text-muted-foreground text-xs sm:text-base">Follow the steps to convert your notes into a clean PDF</p>
      </div>

      <Stepper currentStep={currentStep} totalSteps={TOTAL_STEPS} />

      <div className="bg-card/30 border border-card-border rounded-xl sm:rounded-3xl p-3 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute inset-0 bg-primary-gradient opacity-5 blur-3xl pointer-events-none"></div>
        <div className="relative z-10 min-h-[400px] flex flex-col">
          {currentStep === 1 && <Step1Upload />}
          {currentStep === 2 && <Step2Reorder />}
          {currentStep === 3 && <Step3Preview />}
          {currentStep === 4 && <Step4Enhance />}
          {currentStep === 5 && <Step5Layout />}
          {currentStep === 6 && <Step6Processing />}
        </div>
      </div>
    </div>
  )
}
