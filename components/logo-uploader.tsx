'use client';

import { Alert, AlertDescription, Button, FileInput } from '@polaris/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

type Phase = 'idle' | 'uploading' | 'error';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.svg';
const MAX_BYTES = 2097152;

const ERRORS: Record<string, string> = {
  unauthorized: '로그인이 필요합니다.',
  no_file: '로고 파일을 선택해주세요.',
  too_large: '로고는 2MB를 초과할 수 없습니다.',
  unsupported_type: 'PNG·JPG·WEBP·SVG 이미지만 업로드할 수 있습니다.',
  storage_failed: '업로드에 실패했습니다. 다시 시도해주세요.',
  save_failed: '저장에 실패했습니다. 다시 시도해주세요.'
};

export function LogoUploader() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const file = files[0];
      if (!file) {
        setPhase('error');
        setMessage(ERRORS.no_file);
        return;
      }
      if (file.size > MAX_BYTES) {
        setPhase('error');
        setMessage(ERRORS.too_large);
        return;
      }

      const data = new FormData();
      data.append('logo', file);

      setPhase('uploading');
      setMessage(null);
      try {
        const res = await fetch('/dashboard/logo', { method: 'POST', body: data });
        if (res.ok) {
          setFiles([]);
          formRef.current?.reset();
          setPhase('idle');
          router.refresh();
        } else {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setPhase('error');
          setMessage((json.error && ERRORS[json.error]) || '업로드에 실패했습니다.');
        }
      } catch {
        setPhase('error');
        setMessage('네트워크 오류로 업로드에 실패했습니다.');
      }
    },
    [files, router]
  );

  const busy = phase === 'uploading';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="form-grid">
      <FileInput
        accept={ACCEPT}
        disabled={busy}
        onFilesChange={setFiles}
        aria-label="로고 이미지"
        buttonLabel="로고 선택"
        helperText="PNG·JPG·WEBP·SVG · 최대 2MB · 가로형 로고 권장"
      />
      {phase === 'error' && message ? (
        <Alert variant="danger">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? '업로드 중…' : '로고 업로드'}
      </Button>
    </form>
  );
}
