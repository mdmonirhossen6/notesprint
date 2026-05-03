import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { applyFiltersToCanvas, FilterOptions } from './imageFilters'

export async function generateFinalPDF(
  pages: any[], // The selected page thumbnails
  filters: FilterOptions,
  layout: any, // layout settings
  onProgress: (progress: number) => void
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  
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

  for (let i = 0; i < numOutputPages; i++) {
    console.log(`Processing output page ${i + 1}/${numOutputPages}`);
    onProgress((i / numOutputPages) * 100)
    
    // Create new PDF page
    let pdfPage
    
    // For Original size, we guess the dimensions from the first image of the batch later
    if (isA4) {
      pdfPage = pdfDoc.addPage([pageWidth, pageHeight])
    }

    // Process images for this page
    for (let j = 0; j < itemsPerPage; j++) {
      const pageIndex = i * itemsPerPage + j
      if (pageIndex >= pages.length) break
      
      const sourcePage = pages[pageIndex]
      
      // We load the thumbnail to a canvas, apply filters, and convert to JPEG base64
      console.log(`Processing source image ${pageIndex}`);
      const imgData = await getFilteredImageData(sourcePage.thumbnailUrl, filters)
      console.log(`Embedding JPG for source image ${pageIndex}`);
      
      const image = await pdfDoc.embedJpg(imgData)
      const imgDims = image.scale(1)

      // If original size and it's the first item on the page, set page dims
      if (!isA4 && j === 0) {
        pageWidth = imgDims.width * cols + margin * 2
        pageHeight = imgDims.height * rows + margin * 2
        if (layout.orientation === 'landscape') {
           [pageWidth, pageHeight] = [pageHeight, pageWidth]
        }
        pdfPage = pdfDoc.addPage([pageWidth, pageHeight])
      }

      if (!pdfPage) continue

      const cellWidth = (pageWidth - margin * 2) / cols
      const cellHeight = (pageHeight - margin * 2) / rows
      
      const colIdx = j % cols
      const rowIdx = Math.floor(j / cols)

      // Calculate position
      const x = margin + colIdx * cellWidth
      // pdf-lib y-axis is from bottom
      const y = pageHeight - margin - (rowIdx + 1) * cellHeight

      // Scale image to fit cell
      const scale = Math.min(
        cellWidth / imgDims.width,
        cellHeight / imgDims.height
      ) * 0.95 // 5% padding inside cell

      const finalWidth = imgDims.width * scale
      const finalHeight = imgDims.height * scale
      
      // Center in cell
      const finalX = x + (cellWidth - finalWidth) / 2
      const finalY = y + (cellHeight - finalHeight) / 2

      pdfPage.drawImage(image, {
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight,
      })

      // Draw Separators
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

    // Draw Page Number
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

async function getFilteredImageData(url: string, filters: FilterOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        
        const targetCanvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0)
        
        applyFiltersToCanvas(canvas, targetCanvas, filters)
        
        resolve(targetCanvas.toDataURL('image/jpeg', 0.8))
      } catch (err) {
        console.error("Error in filter processing:", err);
        reject(err);
      }
    }
    img.onerror = (err) => {
      console.error("Image failed to load in getFilteredImageData");
      reject(err);
    }
    img.src = url
  })
}
