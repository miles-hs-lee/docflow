'use client';

import { Button, FileIcon } from '@polaris/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { FileInput } from '@/components/file-input';
import { formatBytes } from '@/lib/format';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export function UploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setFileName(null);
    setFileSize(0);
    setPhase('idle');
    setProgress(0);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const file = fileInputRef.current?.files?.[0];
      if (!file) {
        setErrorMessage('PDF 파일을 선택해주세요.');
        setPhase('error');
        return;
      }
      if (file.size > MAX_PDF_BYTES) {
        setErrorMessage('파일 크기는 50MB를 초과할 수 없습니다.');
        setPhase('error');
        return;
      }

      const data = new FormData();
      data.append('pdf', file);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open('POST', '/dashboard/upload');
      // The route returns a 303 redirect on success — XHR follows redirects
      // automatically and the resulting GET hits /dashboard. We treat any
      // 2xx as success and refresh the dashboard via the router.
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgress(pct);
        }
      };
      xhr.upload.onload = () => {
        // Bytes have hit the server; we're now waiting on storage write +
        // DB insert. Surface a "처리 중" state instead of a stale 100%.
        setPhase('processing');
      };
      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 400) {
          setPhase('done');
          router.refresh();
          // Give the user a beat to see the 100% / done state, then reset.
          window.setTimeout(reset, 1200);
        } else {
          setPhase('error');
          setErrorMessage('업로드에 실패했습니다. 다시 시도해주세요.');
        }
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        setPhase('error');
        setErrorMessage('네트워크 오류가 발생했습니다.');
      };
      xhr.onabort = () => {
        xhrRef.current = null;
      };

      setPhase('uploading');
      setProgress(0);
      setErrorMessage(null);
      xhr.send(data);
    },
    [reset, router]
  );

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? null);
    setFileSize(file?.size ?? 0);
    setPhase('idle');
    setErrorMessage(null);
  }, []);

  const isBusy = phase === 'uploading' || phase === 'processing';

  return (
    <form onSubmit={handleSubmit} className="upload-form" encType="multipart/form-data">
      <FileInput
        ref={fileInputRef}
        name="pdf"
        accept="application/pdf,.pdf"
        required
        disabled={isBusy}
        onChange={handleFileChange}
        className="upload-file"
        aria-label="업로드할 PDF 파일"
      />
      <Button type="submit" disabled={isBusy || !fileName}>
        {phase === 'uploading'
          ? `업로드 중 ${progress}%`
          : phase === 'processing'
            ? '처리 중...'
            : phase === 'done'
              ? '완료'
              : '업로드'}
      </Button>
      {fileName && phase === 'idle' ? (
        <p className="upload-form-hint muted small">
          <FileIcon type="pdf" size={16} /> {fileName} · {formatBytes(fileSize)}
        </p>
      ) : null}
      {isBusy ? (
        <div
          className="upload-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase === 'processing' ? 100 : progress}
        >
          <div
            className="upload-progress-bar"
            style={{ width: `${phase === 'processing' ? 100 : progress}%` }}
          />
        </div>
      ) : null}
      {errorMessage ? <p className="upload-form-error">{errorMessage}</p> : null}
    </form>
  );
}
