import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { applyFiltersToCanvas, FilterOptions } from './imageFilters'
import { PageThumbnail, PDFFile, LayoutSettings } from '@/store/usePDFStore'

// We dynamically import pdfjs-dist to avoid SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null;

export async function generateFinalPDF(
  pages: PageThumbnail[], // Selected page metadata
  files: PDFFile[], // Original PDF files
  filters: FilterOptions,
  layout: LayoutSettings, // layout settings
  onProgress: (progress: number) => void
): Promise<Blob> {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;
  }

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  
  // Quality mapping
  const qualityMap = {
    low: { scale: 1.0, quality: 0.6 },
    medium: { scale: 1.8, quality: 0.8 },
    high: { scale: 2.5, quality: 0.92 }
  }
  const q = qualityMap[layout.quality as keyof typeof qualityMap] || qualityMap.high
  
  // Calculate layout parameters
  const isA4 = layout.size === 'a4'
  let pageWidth = isA4 ? 595.28 : 0
  let pageHeight = isA4 ? 841.89 : 0
  
  if (layout.orientation === 'landscape' && isA4) {
    [pageWidth, pageHeight] = [pageHeight, pageWidth]
  }

  const rows = layout.rows
  const cols = layout.cols
  const itemsPerPage = rows * cols
  const numOutputPages = Math.ceil(pages.length / itemsPerPage)

  const margin = 20

  // Pre-load PDF documents to avoid repeated parsing
  const pdfDocsMap = new Map();
  const getPdfDoc = async (pdfId: string) => {
    if (pdfDocsMap.has(pdfId)) return pdfDocsMap.get(pdfId);
    const fileObj = files.find(f => f.id === pdfId);
    if (!fileObj) throw new Error(`File not found for ID: ${pdfId}`);
    
    const arrayBuffer = await fileObj.file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ 
      data: arrayBuffer,
      standardFontDataUrl: `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
      cMapUrl: `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    }).promise;
    pdfDocsMap.set(pdfId, pdf);
    return pdf;
  };

  for (let i = 0; i < numOutputPages; i++) {
    onProgress((i / numOutputPages) * 100)
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfPage: any
    if (isA4) {
      pdfPage = pdfDoc.addPage([pageWidth, pageHeight])
    }

    for (let j = 0; j < itemsPerPage; j++) {
      const pageIndex = i * itemsPerPage + j
      if (pageIndex >= pages.length) break
      
      const sourcePageMeta = pages[pageIndex]
      
      // Re-extract high-res image
      const pdf = await getPdfDoc(sourcePageMeta.pdfId);
      const page = await pdf.getPage(sourcePageMeta.pageNumber);
      const viewport = page.getViewport({ scale: q.scale });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      if (context) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        
        // Apply filters
        const targetCanvas = document.createElement('canvas');
        applyFiltersToCanvas(canvas, targetCanvas, filters);
        const imgData = targetCanvas.toDataURL('image/jpeg', q.quality);
        
        const image = await pdfDoc.embedJpg(imgData)
        const imgDims = image.scale(1)

        if (!isA4 && j === 0) {
          pageWidth = imgDims.width * cols + margin * 2
          pageHeight = imgDims.height * rows + margin * 2
          pdfPage = pdfDoc.addPage([pageWidth, pageHeight])
        }

        if (!pdfPage) continue

        const cellWidth = (pageWidth - margin * 2) / cols
        const cellHeight = (pageHeight - margin * 2) / rows
        const colIdx = j % cols
        const rowIdx = Math.floor(j / cols)

        const x = margin + colIdx * cellWidth
        const y = pageHeight - margin - (rowIdx + 1) * cellHeight

        const scale = Math.min(cellWidth / imgDims.width, cellHeight / imgDims.height) * 0.95
        const finalWidth = imgDims.width * scale
        const finalHeight = imgDims.height * scale
        
        const finalX = x + (cellWidth - finalWidth) / 2
        const finalY = y + (cellHeight - finalHeight) / 2

        pdfPage.drawImage(image, {
          x: finalX,
          y: finalY,
          width: finalWidth,
          height: finalHeight,
        })

        if (layout.addSeparators) {
          if (colIdx < cols - 1) {
            pdfPage.drawLine({
              start: { x: x + cellWidth, y: y },
              end: { x: x + cellWidth, y: y + cellHeight },
              thickness: 1,
              color: rgb(0.8, 0.8, 0.8),
            })
          }
          if (rowIdx < rows - 1) {
             pdfPage.drawLine({
              start: { x: x, y: y },
              end: { x: x + cellWidth, y: y },
              thickness: 1,
              color: rgb(0.8, 0.8, 0.8),
            })
          }
        }
      }
    }

    if (layout.addPageNumbers && pdfPage) {
      pdfPage.drawText(`${i + 1}`, {
        x: pageWidth / 2 - 5,
        y: 10,
        size: 10,
        font: font,
        color: rgb(0, 0, 0),
      })
    }
  }

  onProgress(100)
  const pdfBytes = await pdfDoc.save()
  return new Blob([pdfBytes], { type: 'application/pdf' })
}
