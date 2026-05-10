'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@polaris/ui';
import { useState } from 'react';

// Two-step confirm for account deletion. The outer form (in
// settings/page.tsx) holds the password input + posts to /auth/delete-account;
// this trigger opens a Dialog that requires the user to acknowledge what
// they're about to lose, then explicitly submits the parent form.
export function DeleteAccountConfirm() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="danger">
          계정과 모든 데이터 영구 삭제
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>계정을 정말 삭제할까요?</DialogTitle>
          <DialogDescription>
            이 작업은 되돌릴 수 없습니다. 외부에 공유한 모든 링크가 즉시 작동을 멈춥니다.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="danger">
          <AlertTitle>삭제되는 데이터</AlertTitle>
          <AlertDescription>
            업로드한 PDF, 문서 묶음, 공유 링크, 페이지 통계, MCP API 키, 자동화 구독.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button type="submit" variant="danger">
            영구 삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
