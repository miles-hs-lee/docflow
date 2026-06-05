'use client';

import type { FormEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

export type UploadPhase = 'idle' | 'uploading' | 'done' | 'error';

type UseFileUploadOptions = {
  endpoint: string;
  /** Multipart field name the route reads the file from. */
  fieldName: string;
  maxBytes: number;
  /** Maps the route's JSON `error` codes to user-facing messages. */
  errorMap: Record<string, string>;
  /** Shown as a 'done' message on success; omit for a silent success. */
  successMessage?: string;
  onSuccess?: () => void;
};

type SubmitOptions = {
  /** Extra multipart fields (empty values are skipped). */
  fields?: Record<string, string>;
  /** Client-side validation run before upload; return a message to abort. */
  preflight?: () => string | null;
};

// Shared upload state machine for the file-request + logo uploaders: file
// selection, size guard, multipart POST, JSON error mapping, success/refresh.
// Each component keeps its own JSX + extra fields (e.g. email) and error map.
export function useFileUpload({
  endpoint,
  fieldName,
  maxBytes,
  errorMap,
  successMessage,
  onSuccess
}: UseFileUploadOptions) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>, options?: SubmitOptions) => {
      event.preventDefault();
      const file = files[0];
      if (!file) {
        setPhase('error');
        setMessage(errorMap.no_file ?? '파일을 선택해주세요.');
        return;
      }
      if (file.size > maxBytes) {
        setPhase('error');
        setMessage(errorMap.too_large ?? '파일이 너무 큽니다.');
        return;
      }
      const preflightError = options?.preflight?.();
      if (preflightError) {
        setPhase('error');
        setMessage(preflightError);
        return;
      }

      const data = new FormData();
      data.append(fieldName, file);
      for (const [key, value] of Object.entries(options?.fields ?? {})) {
        if (value) data.append(key, value);
      }

      setPhase('uploading');
      setMessage(null);
      try {
        const res = await fetch(endpoint, { method: 'POST', body: data });
        if (res.ok) {
          setFiles([]);
          formRef.current?.reset();
          if (successMessage) {
            setPhase('done');
            setMessage(successMessage);
          } else {
            setPhase('idle');
            setMessage(null);
          }
          onSuccess?.();
        } else {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setPhase('error');
          setMessage((json.error && errorMap[json.error]) || '업로드에 실패했습니다.');
        }
      } catch {
        setPhase('error');
        setMessage('네트워크 오류로 업로드에 실패했습니다.');
      }
    },
    [files, endpoint, fieldName, maxBytes, errorMap, successMessage, onSuccess]
  );

  return { files, setFiles, phase, message, formRef, submit, busy: phase === 'uploading' };
}
