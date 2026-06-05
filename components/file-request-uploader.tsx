'use client';

import { Alert, AlertDescription, Button, FileInput, Input } from '@polaris/ui';
import { useState } from 'react';

import { useFileUpload } from '@/components/use-file-upload';

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
  const [email, setEmail] = useState('');
  const { setFiles, phase, message, formRef, submit, busy } = useFileUpload({
    endpoint: `/r/${token}/upload`,
    fieldName: 'file',
    maxBytes: MAX_BYTES,
    errorMap: ERRORS,
    successMessage: '업로드가 완료되었습니다. 감사합니다!'
  });

  return (
    <form
      ref={formRef}
      onSubmit={(event) =>
        submit(event, {
          fields: { email: email.trim() },
          preflight: () => (requireEmail && !email.includes('@') ? ERRORS.email_required : null)
        })
      }
      className="form-grid"
    >
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
