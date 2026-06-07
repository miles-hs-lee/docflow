'use client';

import { Button, Input, Stack } from '@polaris/ui';
import { useEffect, useState } from 'react';

// Shows the absolute invite URL (built client-side from the current origin) with
// a copy-to-clipboard button. We have no email infra yet, so the admin copies
// this link and shares it however they like.
export function InviteLinkCopy({ token }: { token: string }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/invite/${token}`);
  }, [token]);

  return (
    <Stack direction="row" gap={2} align="center" className="invite-link-row">
      <Input readOnly value={url} aria-label="초대 링크" className="invite-link-input" />
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked — the field is selectable as a fallback */
          }
        }}
      >
        {copied ? '복사됨' : '링크 복사'}
      </Button>
    </Stack>
  );
}
