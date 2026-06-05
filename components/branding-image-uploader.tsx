'use client';

import { Alert, AlertDescription, Button, FileInput } from '@polaris/ui';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { useFileUpload } from '@/components/use-file-upload';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.svg';
const MAX_BYTES = 2097152;

type BrandingImageUploaderProps = {
  /** Route the file POSTs to (account vs per-collection, logo vs cover). */
  endpoint: string;
  /** Multipart field the server reads the file from ('logo' or 'cover'). */
  fieldName: string;
  /** Noun used in the button + error copy (e.g. '로고', '커버 이미지'). */
  noun: string;
  /** Format/size hint under the file picker. */
  helperText: string;
};

// Generic owner-side branding-image uploader (account/room logo + cover). One
// component drives every variant — only the endpoint, multipart field, and
// noun/helper copy differ. Mirrors the server-side handleLogoUpload, which is
// likewise field-parameterized.
export function BrandingImageUploader({ endpoint, fieldName, noun, helperText }: BrandingImageUploaderProps) {
  const router = useRouter();
  const errorMap = useMemo<Record<string, string>>(
    () => ({
      unauthorized: '로그인이 필요합니다.',
      no_file: `${noun} 파일을 선택해주세요.`,
      too_large: `${noun} 파일은 2MB를 초과할 수 없습니다.`,
      unsupported_type: 'PNG·JPG·WEBP·SVG 이미지만 업로드할 수 있습니다.',
      storage_failed: '업로드에 실패했습니다. 다시 시도해주세요.',
      save_failed: '저장에 실패했습니다. 다시 시도해주세요.'
    }),
    [noun]
  );
  const { setFiles, phase, message, formRef, submit, busy } = useFileUpload({
    endpoint,
    fieldName,
    maxBytes: MAX_BYTES,
    errorMap,
    onSuccess: () => router.refresh()
  });

  return (
    <form ref={formRef} onSubmit={(event) => submit(event)} className="form-grid">
      <FileInput
        accept={ACCEPT}
        disabled={busy}
        onFilesChange={setFiles}
        aria-label={`${noun} 이미지`}
        buttonLabel={`${noun} 선택`}
        helperText={helperText}
      />
      {phase === 'error' && message ? (
        <Alert variant="danger">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? '업로드 중…' : `${noun} 업로드`}
      </Button>
    </form>
  );
}
