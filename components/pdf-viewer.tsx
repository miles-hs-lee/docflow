'use client';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

let workerInitialized = false;
function ensurePdfWorker() {
  if (workerInitialized || typeof window === 'undefined') return;
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  workerInitialized = true;
}

const MIN_DWELL_MS = 800;
const MAX_DWELL_MS = 60 * 60 * 1000;

type PdfViewerProps = {
  documentSrc: string;
  eventEndpoint: string;
  fileId?: string;
  watermarkLabel: string;
};

type PageRecord = {
  number: number;
  el: HTMLDivElement | null;
};

export function PdfViewer({ documentSrc, eventEndpoint, fileId, watermarkLabel }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<PageRecord[]>([]);
  const pageEnterAt = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    ensurePdfWorker();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(Math.min(el.clientWidth - 24, 960));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const reportPageDwell = useCallback(
    (pageNumber: number, dwellMs: number) => {
      if (dwellMs < MIN_DWELL_MS) return;
      const clamped = Math.min(dwellMs, MAX_DWELL_MS);
      const body = JSON.stringify({ pageNumber, dwellMs: clamped, fileId });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(eventEndpoint, new Blob([body], { type: 'application/json' }));
          return;
        }
      } catch {
        // sendBeacon may throw under restrictive policies; fall through to fetch.
      }
      void fetch(eventEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {
        // Swallow — page-level analytics never blocks the viewer.
      });
    },
    [eventEndpoint, fileId]
  );

  useEffect(() => {
    if (numPages === 0) return;
    const enterAt = pageEnterAt.current;
    const flushAll = () => {
      const now = Date.now();
      for (const [pageNumber, t0] of enterAt.entries()) {
        reportPageDwell(pageNumber, now - t0);
      }
      enterAt.clear();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const now = Date.now();
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (!pageNumber) continue;
          if (entry.isIntersecting) {
            if (!enterAt.has(pageNumber)) enterAt.set(pageNumber, now);
          } else {
            const t0 = enterAt.get(pageNumber);
            if (t0 != null) {
              reportPageDwell(pageNumber, now - t0);
              enterAt.delete(pageNumber);
            }
          }
        }
      },
      { threshold: 0.55 }
    );

    for (const record of pageRefs.current) {
      if (record.el) observer.observe(record.el);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushAll);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushAll);
      flushAll();
    };
  }, [numPages, reportPageDwell]);

  const fileProp = useMemo(() => ({ url: documentSrc }), [documentSrc]);

  const handleLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    pageRefs.current = Array.from({ length: total }, (_, i) => ({ number: i + 1, el: null }));
  }, []);

  const setPageRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    const record = pageRefs.current[index];
    if (record) record.el = el;
  }, []);

  return (
    <div ref={containerRef} className="pdf-viewer">
      <Document
        file={fileProp}
        onLoadSuccess={handleLoadSuccess}
        loading={<p className="pdf-viewer-status">PDF를 불러오는 중...</p>}
        error={<p className="pdf-viewer-status">PDF를 표시할 수 없습니다.</p>}
        className="pdf-viewer-doc"
      >
        {Array.from({ length: numPages }, (_, i) => {
          const pageNumber = i + 1;
          return (
            <div
              key={pageNumber}
              ref={setPageRef(i)}
              data-page-number={pageNumber}
              className="pdf-viewer-page-frame"
            >
              <div className="pdf-viewer-page-inner">
                <Page
                  pageNumber={pageNumber}
                  width={width || undefined}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />
                <Watermark label={watermarkLabel} pageNumber={pageNumber} />
              </div>
            </div>
          );
        })}
      </Document>
    </div>
  );
}

function Watermark({ label, pageNumber }: { label: string; pageNumber: number }) {
  const stamp = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }, []);

  const tile = `${label} · ${stamp} · p.${pageNumber}`;
  const repeated = Array.from({ length: 24 }, () => tile);

  return (
    <div className="pdf-viewer-watermark" aria-hidden>
      {repeated.map((text, idx) => (
        <span key={idx} className="pdf-viewer-watermark-cell">
          {text}
        </span>
      ))}
    </div>
  );
}
