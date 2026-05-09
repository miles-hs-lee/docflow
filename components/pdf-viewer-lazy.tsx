'use client';

import dynamic from 'next/dynamic';

// react-pdf + pdfjs are heavy (~150kB gzipped) and only run in the
// browser. Skipping SSR avoids the worker / DOMMatrix init blowing up
// during prerender, and the dynamic boundary keeps the chunk out of
// the viewer page's first-load JS.
export const PdfViewer = dynamic(
  () => import('@/components/pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => <p className="pdf-viewer-status">PDF를 불러오는 중...</p>
  }
);
