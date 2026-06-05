'use client';

import { Alert, AlertDescription, Button, FileInput } from '@polaris/ui';
import { useRouter } from 'next/navigation';

import { useFileUpload } from '@/components/use-file-upload';

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
  const { setFiles, phase, message, formRef, submit, busy } = useFileUpload({
    endpoint: '/dashboard/logo',
    fieldName: 'logo',
    maxBytes: MAX_BYTES,
    errorMap: ERRORS,
    onSuccess: () => router.refresh()
  });

  return (
    <form ref={formRef} onSubmit={(event) => submit(event)} className="form-grid">
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
