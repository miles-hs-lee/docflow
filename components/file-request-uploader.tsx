'use client';

import { Alert, AlertDescription, Button, FileInput, Input } from '@polaris/ui';
import { useCallback, useRef, useState } from 'react';

type Phase = 'idle' | 'uploading' | 'done' | 'error';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
const MAX_BYTES = 52428800;

// Maps the upload route's JSON error codes to Korean messages.
const ERRORS: Record<string, string> = {
  not_found: '요청을 찾을 수 없습니다.',
  closed: '이 요청은 현재 닫혀 있습니다.',
  expired: '이 요청은 마감되었습니다.',
  too_many: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
  limit_reached: '업로드 한도에 도달했습니다.',
  no_file: '업로드할 파일을 선택해주세요.',
  too_large: '파일 크기는 50MB를 초과할 수 없습니다.',
  email_required: '이메일을 입력해주세요.',
  unsupported_type: '지원하지 않는 파일 형식입니다.',
  save_failed: '업로드에 실패했습니다. 다시 시도해주세요.',
  storage_failed: '저장에 실패했습니다. 다시 시도해주세요.'
};

type FileRequestUploaderProps = {
  token: string;
  requireEmail: boolean;
};

export function FileRequestUploader({ token, requireEmail }: FileRequestUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [email, setEmail] = useState('');
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
      if (requireEmail && !email.includes('@')) {
        setPhase('error');
        setMessage(ERRORS.email_required);
        return;
      }

      const data = new FormData();
      data.append('file', file);
      if (email.trim()) data.append('email', email.trim());

      setPhase('uploading');
      setMessage(null);
      try {
        const res = await fetch(`/r/${token}/upload`, { method: 'POST', body: data });
        if (res.ok) {
          setPhase('done');
          setMessage('업로드가 완료되었습니다. 감사합니다!');
          setFiles([]);
          formRef.current?.reset();
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
    [files, email, requireEmail, token]
  );

  const busy = phase === 'uploading';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="form-grid">
      <Input
        type="email"
        label={requireEmail ? '이메일' : '이메일 (선택)'}
        placeholder="name@company.com"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
        disabled={busy}
      />
      <FileInput
        accept={ACCEPT}
        disabled={busy}
        onFilesChange={setFiles}
        aria-label="업로드할 파일"
        buttonLabel="파일 선택"
        helperText="최대 50MB · PDF, 이미지, Office 문서, CSV/TXT, ZIP"
      />
      {phase === 'done' && message ? (
        <Alert variant="success">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {phase === 'error' && message ? (
        <Alert variant="danger">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? '업로드 중…' : '업로드'}
      </Button>
    </form>
  );
}
