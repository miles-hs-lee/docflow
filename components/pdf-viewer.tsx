'use client';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

let workerInitialized = false;
function ensurePdfWorker() {
  if (workerInitialized || typeof window === 'undefined') return;
  // Self-hosted worker (copied to /public via postinstall, kept in sync
  // with pdfjs-dist version). Avoids the unpkg round trip + lets us
  // serve through our own CDN with the rest of the viewer bundle.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  workerInitialized = true;
}

const MIN_DWELL_MS = 800;
// Per-SEGMENT ceiling. An idle tab left open on one page used to accrue up
// to an hour of "reading"; 10 minutes is the credibility cap (the server
// clamps to the same value). Active readers re-enter pages and accumulate
// across segments, so genuine long reads are not lost.
const SEGMENT_MAX_DWELL_MS = 10 * 60 * 1000;
// Render ±2 pages around the most-visible one. Non-rendered pages get a
// sized placeholder so the scrollbar still reflects total document length.
const RENDER_WINDOW = 2;
// Default A4 portrait ratio (h / w ≈ 1.414). Once a page renders we cache
// its real height so the placeholder shrinks/grows to match.
const FALLBACK_PAGE_RATIO = 1.414;
// Per-page dwell events are buffered locally and posted in batches so
// long PDFs don't fan out to one serverless invocation per page. The
// queue flushes when it hits BATCH_FLUSH_SIZE, after BATCH_FLUSH_MS
// since the first queued event, or on pagehide / hidden-tab.
const BATCH_FLUSH_SIZE = 8;
const BATCH_FLUSH_MS = 8000;

type PageDwellEvent = { pageNumber: number; dwellMs: number };

type PdfViewerProps = {
  documentSrc: string;
  eventEndpoint: string;
  fileId?: string;
  watermarkLabel: string;
  /** Whether to tile the dynamic watermark over each page. Default: true. */
  watermark?: boolean;
};

type PageRecord = {
  number: number;
  el: HTMLDivElement | null;
};

export function PdfViewer({
  documentSrc,
  eventEndpoint,
  fileId,
  watermarkLabel,
  watermark = true
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [activePage, setActivePage] = useState(1);
  // Cached real page heights from PDF metadata, keyed by page number.
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<PageRecord[]>([]);
  // Dwell accrues to ONE page at a time — the most-visible one. The old
  // model credited every page above an intersection threshold, so a
  // landscape deck showing two slides at once double-counted wall time
  // (total dwell could exceed the visit length). { page, since } is the
  // open segment; null = suspended (hidden tab / nothing visible).
  const activeDwellRef = useRef<{ page: number; since: number } | null>(null);
  // Each page's intersection ratio so we can pick the most-visible one
  // for the render window. A ref + rAF avoids re-rendering on every scroll.
  const pageVisibility = useRef<Map<number, number>>(new Map());
  const activeRafRef = useRef<number | null>(null);
  // Total page count, piggybacked on dwell batches so the server can fill
  // files.page_count (completion metrics) without parsing the PDF itself.
  const numPagesRef = useRef(0);

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

  const eventQueue = useRef<PageDwellEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  const sendBatch = useCallback(
    (events: PageDwellEvent[]) => {
      if (events.length === 0) return;
      const body = JSON.stringify({
        events,
        fileId,
        numPages: numPagesRef.current || undefined
      });
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

  const flushQueue = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const events = eventQueue.current.splice(0);
    if (events.length > 0) sendBatch(events);
  }, [sendBatch]);

  const reportPageDwell = useCallback(
    (pageNumber: number, dwellMs: number) => {
      if (dwellMs < MIN_DWELL_MS) return;
      const clamped = Math.min(dwellMs, SEGMENT_MAX_DWELL_MS);
      eventQueue.current.push({ pageNumber, dwellMs: clamped });
      if (eventQueue.current.length >= BATCH_FLUSH_SIZE) {
        flushQueue();
        return;
      }
      if (flushTimerRef.current == null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          const events = eventQueue.current.splice(0);
          if (events.length > 0) sendBatch(events);
        }, BATCH_FLUSH_MS);
      }
    },
    [flushQueue, sendBatch]
  );

  useEffect(() => {
    if (numPages === 0) return;
    const visibility = pageVisibility.current;

    // Close the open dwell segment (if any) and report it.
    const closeActiveDwell = () => {
      const current = activeDwellRef.current;
      if (current) {
        reportPageDwell(current.page, Date.now() - current.since);
        activeDwellRef.current = null;
      }
    };
    const flushAll = () => {
      closeActiveDwell();
      flushQueue();
    };

    // Single source of truth for "which page is being read": the page with
    // the highest intersection ratio. Drives both the render window and the
    // dwell segment — when the winner changes, the previous segment closes
    // and a new one opens. Exactly one page accrues time at any moment.
    const scheduleActiveRecalc = () => {
      if (activeRafRef.current != null) return;
      activeRafRef.current = window.requestAnimationFrame(() => {
        activeRafRef.current = null;
        let bestPage = 1;
        let bestRatio = -1;
        for (const [pageNumber, ratio] of visibility.entries()) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = pageNumber;
          }
        }
        if (bestRatio <= 0) {
          // Nothing visible — close the segment rather than keep accruing.
          closeActiveDwell();
          return;
        }
        const now = Date.now();
        const current = activeDwellRef.current;
        if (!current) {
          activeDwellRef.current = { page: bestPage, since: now };
        } else if (current.page !== bestPage) {
          reportPageDwell(current.page, now - current.since);
          activeDwellRef.current = { page: bestPage, since: now };
        }
        setActivePage((prev) => (prev === bestPage ? prev : bestPage));
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (!pageNumber) continue;
          visibility.set(pageNumber, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        scheduleActiveRecalc();
      },
      { threshold: [0, 0.25, 0.55, 0.9] }
    );

    for (const record of pageRefs.current) {
      if (record.el) observer.observe(record.el);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Hidden time must not count as reading. Close + ship now (the tab
        // may never come back).
        flushAll();
      } else {
        // On return, IntersectionObserver won't refire without an
        // intersection change — re-stamp from the cached ratios so reading
        // time resumes immediately instead of after the next scroll.
        scheduleActiveRecalc();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushAll);

    return () => {
      observer.disconnect();
      if (activeRafRef.current != null) {
        window.cancelAnimationFrame(activeRafRef.current);
        activeRafRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushAll);
      flushAll();
    };
  }, [numPages, reportPageDwell, flushQueue]);

  const fileProp = useMemo(() => ({ url: documentSrc }), [documentSrc]);

  const handleLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    numPagesRef.current = total;
    pageRefs.current = Array.from({ length: total }, (_, i) => ({ number: i + 1, el: null }));
  }, []);

  const setPageRef = useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      const record = pageRefs.current[index];
      if (record) record.el = el;
    },
    []
  );

  const recordPageSize = useCallback((pageNumber: number, height: number) => {
    setPageHeights((prev) => (prev[pageNumber] === height ? prev : { ...prev, [pageNumber]: height }));
  }, []);

  const placeholderHeight = useMemo(
    () => (width > 0 ? Math.round(width * FALLBACK_PAGE_RATIO) : 0),
    [width]
  );

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
          const inWindow = Math.abs(pageNumber - activePage) <= RENDER_WINDOW;
          const cachedHeight = pageHeights[pageNumber];
          const reservedHeight = cachedHeight ?? placeholderHeight;
          return (
            <div
              key={pageNumber}
              ref={setPageRef(i)}
              data-page-number={pageNumber}
              className="pdf-viewer-page-frame"
              style={!inWindow && reservedHeight ? { minHeight: reservedHeight } : undefined}
            >
              {inWindow ? (
                <div className="pdf-viewer-page-inner">
                  <Page
                    pageNumber={pageNumber}
                    width={width || undefined}
                    renderTextLayer
                    renderAnnotationLayer={false}
                    onLoadSuccess={(p) => recordPageSize(pageNumber, p.height)}
                  />
                  {watermark ? <Watermark label={watermarkLabel} pageNumber={pageNumber} /> : null}
                </div>
              ) : null}
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
