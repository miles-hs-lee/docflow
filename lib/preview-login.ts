import { serverEnv } from '@/lib/env-server';

export function canUsePreviewTestLogin() {
  return (
    process.env.VERCEL_ENV === 'preview' &&
    serverEnv.previewTestLoginEnabled &&
    Boolean(serverEnv.previewTestEmail) &&
    Boolean(serverEnv.previewTestPassword)
  );
}
