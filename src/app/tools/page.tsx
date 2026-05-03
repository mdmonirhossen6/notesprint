import Link from "next/link"
import { Layers, FileEdit, Crop, Image, Scissors, Hash, Copy, SunMedium, Eraser, Presentation, Trash2, Contrast } from "lucide-react"
import { ToolCard } from "@/components/shared/ToolCard"

export default function ToolsPage() {
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
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">All Tools</h1>
        <p className="text-muted-foreground">Select a tool to process your document.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {tools.map((tool, i) => (
          <Link href="/process" key={i}>
            <ToolCard title={tool.title} icon={tool.icon} className="h-full" />
          </Link>
        ))}
      </div>
    </div>
  )
}
