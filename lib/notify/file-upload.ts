import { dispatchDirectNotification } from '@/lib/notify/dispatch';

export type FileUploadNotification = {
  ownerId: string;
  requestId: string;
  requestTitle: string;
  uploadId: string;
  fileName: string;
  uploaderEmail: string | null;
  createdAt: string;
};

// Best-effort owner notification when a visitor uploads to a file request.
// Delivery (subscription fetch, Teams/webhook split, signing, SSRF, timeout) is
// the shared dispatchDirectNotification; this only shapes the payload.
export async function notifyFileUpload(input: FileUploadNotification): Promise<void> {
  await dispatchDirectNotification({
    ownerId: input.ownerId,
    eventType: 'file_uploaded',
    viewerEmail: input.uploaderEmail,
    createdAt: input.createdAt,
    build: () => ({
      // The request title + file name ride along as the Teams card's '사유' fact.
      teamsReason: `${input.requestTitle}: ${input.fileName}`,
      webhookEvent: {
        eventType: 'file_uploaded',
        requestId: input.requestId,
        requestTitle: input.requestTitle,
        uploadId: input.uploadId,
        fileName: input.fileName,
        uploaderEmail: input.uploaderEmail,
        createdAt: input.createdAt
      }
    })
  });
}
