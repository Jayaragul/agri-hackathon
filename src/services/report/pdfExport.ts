import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

/**
 * Captures every `.report-section` inside `container` as its own high-resolution image
 * (`html2canvas`, scale 2 for crisp text/charts) and packs them onto A4 pages (`jsPDF`) — a
 * section never straddles a page break, EXCEPT one that's taller than a full page on its own
 * (the full daily-plan table for a long-duration crop), which gets sliced across as many pages
 * as it needs via `sliceCanvasAcrossPages`. `container` must already be laid out in the live DOM
 * (off-screen is fine — see `useFarmReportGenerator.ts` — but `display:none` is not, since
 * `html2canvas` needs real layout/paint to rasterize).
 */

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

function sliceCanvasAcrossPages(pdf: jsPDF, canvas: HTMLCanvasElement, imgWidthMm: number, pageHeightMm: number): void {
  const pxPerMm = canvas.width / imgWidthMm
  const pageHeightPx = Math.max(1, Math.floor(pageHeightMm * pxPerMm))
  let renderedPx = 0
  let isFirstSlice = true

  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx)
    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = canvas.width
    sliceCanvas.height = sliceHeightPx
    const ctx = sliceCanvas.getContext('2d')
    if (!ctx) throw new Error('Could not acquire 2D canvas context for PDF page slicing.')
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx)

    if (!isFirstSlice) pdf.addPage()
    const sliceHeightMm = sliceHeightPx / pxPerMm
    pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidthMm, sliceHeightMm)

    renderedPx += sliceHeightPx
    isFirstSlice = false
  }
}

export async function exportSectionsToPdf(container: HTMLElement, filename: string): Promise<void> {
  const sections = Array.from(container.querySelectorAll<HTMLElement>('.report-section'))
  if (sections.length === 0) throw new Error('No .report-section elements found inside the report container.')

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let cursorMm = 0

  for (const section of sections) {
    const canvas = await html2canvas(section, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
    const imgHeightMm = (canvas.height / canvas.width) * A4_WIDTH_MM

    if (imgHeightMm > A4_HEIGHT_MM) {
      if (cursorMm > 0) {
        pdf.addPage()
        cursorMm = 0
      }
      sliceCanvasAcrossPages(pdf, canvas, A4_WIDTH_MM, A4_HEIGHT_MM)
      cursorMm = A4_HEIGHT_MM // last sliced page may have space left, but the next section always starts fresh
      continue
    }

    if (cursorMm + imgHeightMm > A4_HEIGHT_MM) {
      pdf.addPage()
      cursorMm = 0
    }

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, cursorMm, A4_WIDTH_MM, imgHeightMm)
    cursorMm += imgHeightMm
  }

  pdf.save(filename)
}
