import { Alert, AlertDescription, AlertTitle } from '@polaris/ui';

type FlashProps = {
  success?: string;
  error?: string;
};

export function Flash({ success, error }: FlashProps) {
  if (!success && !error) return null;

  return (
    <div className="flash-stack" role="status" aria-live="polite">
      {success ? (
        <Alert variant="success">
          <AlertTitle>완료</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertTitle>확인 필요</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
