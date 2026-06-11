'use client';

import { Button, FileInput, Progress, Stack } from '@polaris/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

// Multi-file upload: the route ingests one PDF per POST (kept simple — each
// file is its own storage write + DB insert), so multiple selections upload
// SEQUENTIALLY with one progress bar across the whole batch. A data room
// usually starts as a stack of PDFs; one pick-and-wait beats N round trips
// through the form.
export function UploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setFiles([]);
    setPhase('idle');
    setProgress(0);
    setCurrentIndex(0);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // One file = one XHR; resolves true on 2xx/3xx. Progress maps the byte
  // progress of file i into the batch-wide bar: (i + filePct) / total.
  const uploadOne = useCallback(
    (file: File, index: number, total: number) =>
      new Promise<boolean>((resolve) => {
        const data = new FormData();
        data.append('pdf', file);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('POST', '/dashboard/upload');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const filePct = e.loaded / e.total;
            setProgress(Math.round(((index + filePct) / total) * 100));
          }
        };
        xhr.upload.onload = () => {
          // Bytes for this file hit the server; storage write + DB insert
          // are pending. Only show the indeterminate state on the LAST file —
          // mid-batch the determinate bar keeps moving anyway.
          if (index === total - 1) setPhase('processing');
        };
        xhr.onload = () => {
          xhrRef.current = null;
          resolve(xhr.status >= 200 && xhr.status < 400);
        };
        xhr.onerror = () => {
          xhrRef.current = null;
          resolve(false);
        };
        xhr.onabort = () => {
          xhrRef.current = null;
          resolve(false);
        };
        xhr.send(data);
      }),
    []
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (files.length === 0) {
        setErrorMessage('PDF 파일을 선택해주세요.');
        setPhase('error');
        return;
      }
      const oversized = files.find((file) => file.size > MAX_PDF_BYTES);
      if (oversized) {
        setErrorMessage(`"${oversized.name}" — 파일 크기는 50MB를 초과할 수 없습니다.`);
        setPhase('error');
        return;
      }

      setPhase('uploading');
      setProgress(0);
      setErrorMessage(null);

      for (let i = 0; i < files.length; i += 1) {
        setCurrentIndex(i);
        const ok = await uploadOne(files[i], i, files.length);
        if (!ok) {
          setPhase('error');
          setErrorMessage(
            files.length > 1
              ? `"${files[i].name}" 업로드에 실패했습니다. (${i}/${files.length}개 완료)`
              : '업로드에 실패했습니다. 다시 시도해주세요.'
          );
          router.refresh();
          return;
        }
      }

      setPhase('done');
      setProgress(100);
      router.refresh();
      window.setTimeout(reset, 1200);
    },
    [files, reset, router, uploadOne]
  );

  const isBusy = phase === 'uploading' || phase === 'processing';
  const progressValue = phase === 'processing' ? null : progress;
  const batchLabel = files.length > 1 ? ` (${Math.min(currentIndex + 1, files.length)}/${files.length})` : '';

  return (
    <form onSubmit={handleSubmit} encType="multipart/form-data">
      <Stack gap={3}>
        <FileInput
          ref={fileInputRef}
          name="pdf"
          accept="application/pdf,.pdf"
          required
          multiple
          disabled={isBusy}
          onFilesChange={setFiles}
          aria-label="업로드할 PDF 파일"
          buttonLabel="PDF 선택 (여러 개 가능)"
          helperText="파일당 최대 50MB · application/pdf · 여러 개를 한 번에 선택할 수 있습니다"
          error={errorMessage ?? undefined}
        />
        <Button type="submit" disabled={isBusy || files.length === 0}>
          {phase === 'uploading'
            ? `업로드 중${batchLabel} ${progress}%`
            : phase === 'processing'
              ? '처리 중...'
              : phase === 'done'
                ? '완료'
                : files.length > 1
                  ? `${files.length}개 업로드`
                  : '업로드'}
        </Button>
        {isBusy ? (
          // Both phases are "in progress" — use the neutral accent tone.
          // 'success' (green) is reserved for completion; the bar unmounts
          // once phase === 'done', so it never has a valid success moment.
          <Progress value={progressValue} variant="accent" aria-label="업로드 진행률" />
        ) : null}
      </Stack>
    </form>
  );
}
