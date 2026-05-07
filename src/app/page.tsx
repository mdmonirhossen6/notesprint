import Link from "next/link"
import { ArrowRight, Layers, FileEdit, Crop, Image, Scissors, Hash, Copy, SunMedium, Eraser, Presentation, Trash2, Contrast } from "lucide-react"
import { GradientButton } from "@/components/shared/GradientButton"
import { StatPill } from "@/components/shared/StatPill"
import { ToolCard } from "@/components/shared/ToolCard"


export default function Home() {
  const tools = [
    { title: "Reorder", icon: <Layers size={24} /> },
    { title: "Edit Pages", icon: <FileEdit size={24} /> },
    { title: "Remove Logo", icon: <Crop size={24} /> },
    { title: "Grayscale", icon: <Image size={24} /> },
    { title: "Separators", icon: <Scissors size={24} /> },
    { title: "Page No", icon: <Hash size={24} /> },
    { title: "Merge PDFs", icon: <Copy size={24} /> },
    { title: "Invert Colors", icon: <SunMedium size={24} /> },
    { title: "Clear Background", icon: <Eraser size={24} /> },
    { title: "Multiple Slides", icon: <Presentation size={24} /> },
    { title: "Remove Slides", icon: <Trash2 size={24} /> },
    { title: "Black & White", icon: <Contrast size={24} /> },
  ]

  return (
    <div className="flex flex-col gap-10">
      {/* Hero Section */}
      <section className="text-center space-y-6 pt-4">
        <div className="flex flex-wrap justify-center gap-2 mb-4">
          <StatPill variant="success">Free Forever ♥</StatPill>
        </div>
        
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight">
          <span className="text-white block">Make Your Notes</span>
          <span className="text-gradient block">Printable</span>
        </h1>
        
        <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2 text-sm text-muted-foreground mt-6">
          <span>300k+ Files Processed</span>
          <span className="w-1 h-1 rounded-full bg-card-border" />
          <span>50k+ Students Helped</span>
          <span className="w-1 h-1 rounded-full bg-card-border" />
          <span>5k+ Thank You</span>
        </div>

        <div className="pt-6">
          <Link href="/process">
            <GradientButton className="text-lg px-8 py-6" rounded="full">
              Start Processing
              <ArrowRight className="ml-2" size={20} />
            </GradientButton>
          </Link>
        </div>
      </section>



      {/* Quick Tool Grid */}
      <section>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Quick Tools</h2>
          <Link href="/tools" className="text-primary text-sm font-medium hover:underline">View All</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {tools.map((tool, i) => (
            <Link href="/process" key={i}>
              <ToolCard title={tool.title} icon={tool.icon} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
