// We dynamically import pdfjs-dist to avoid SSR issues like DOMMatrix not defined
let pdfjsLib: any = null;

export async function extractPDFPages(file: File, pdfId: string): Promise<Array<{
  id: string
  pageNumber: number
  pdfId: string
  thumbnailUrl: string
  selected: boolean
}>> {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;
  }
  
  console.log("Starting PDF extraction for:", file.name, "pdfjs version:", pdfjsLib.version)
  try {
    const arrayBuffer = await file.arrayBuffer()
    console.log("Array buffer loaded, size:", arrayBuffer.byteLength)
    const pdf = await pdfjsLib.getDocument({ 
      data: arrayBuffer,
      standardFontDataUrl: `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
      cMapUrl: `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    }).promise
    console.log("PDF Document loaded, numPages:", pdf.numPages)
  
    const pages = []
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      
      // Scale down for thumbnail (increased to 1.5 for clearer preview)
      const viewport = page.getViewport({ scale: 1.5 })
      
      // Create canvas
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      canvas.height = viewport.height
      canvas.width = viewport.width
      
      if (context) {
        // Fill canvas with white first, because PDFs often have transparent backgrounds
        // which turn black when converted to JPEG, making black text invisible in dark mode.
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise
        
        console.log("Rendered page", i)
        const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8)
        
        pages.push({
          id: `${pdfId}-page-${i}`,
          pageNumber: i,
          pdfId,
          thumbnailUrl,
          selected: true // By default, select all pages
        })
      }
    }
    
    console.log("Finished extracting", pages.length, "pages")
    return pages
  } catch (error) {
    console.error("Critical error inside extractPDFPages:", error)
    throw error
  }
}
