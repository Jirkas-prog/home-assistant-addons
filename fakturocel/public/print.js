import { getDocument, GlobalWorkerOptions } from './pdfjs/pdf.mjs';
GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.mjs';
document.querySelector('#print').onclick = () => {
  try {
    if (!window.printReady) throw Error("Wait for the print preview to finish.");
    window.print();
  } catch (e) {
    parent.postMessage({
      type: "fakturocel-print-error",
      message: e.message
    }, location.origin);
  }
};
window.renderPdf = async ({
  name,
  base64,
  language = 'en',
  labels = {},
  interfaceStyle = {}
}) => {
  try {
    document.documentElement.lang = language === 'cs' ? 'cs' : 'en';
    document.querySelector('#print').textContent = labels.print || 'Print';
    document.querySelector('#title').textContent = labels.preparing || 'Preparing document…';
    for (const key of ['font-size', 'background', 'surface', 'text', 'sidebar', 'sidebar-text']) if (interfaceStyle[key]) document.documentElement.style.setProperty('--ui-' + key, interfaceStyle[key]);
    const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const pdf = await getDocument({
      data,
      isEvalSupported: false,
      enableXfa: false
    }).promise;
    const main = document.querySelector('main');
    main.replaceChildren();
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n),
        viewport = page.getViewport({
          scale: 3
        }),
        article = document.createElement('article'),
        canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      article.append(canvas);
      main.append(article);
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport
      }).promise;
    }
    document.querySelector('#title').textContent = name;
    window.printReady = true;
    return {
      pages: pdf.numPages
    };
  } catch (e) {
    document.querySelector('#error').textContent = (labels.error || "The PDF could not be prepared for printing: ") + e.message;
    throw e;
  }
};
