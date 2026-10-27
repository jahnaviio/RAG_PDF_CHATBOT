import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// pdf.js is large, so it is only downloaded when the first PDF is opened.
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export interface PageText {
  pageNumber: number;
  text: string;
}

/** Extracts text page by page, entirely inside the browser. */
export async function extractPages(
  data: ArrayBuffer,
  onProgress?: (done: number, total: number) => void
): Promise<PageText[]> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err: any) {
    if (err?.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Remove the password and try again.");
    }
    throw new Error("Could not read this PDF. It may be corrupted.");
  }

  const pages: PageText[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as any[]) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      pages.push({ pageNumber: i, text });
      page.cleanup();
      onProgress?.(i, pdf.numPages);
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}
