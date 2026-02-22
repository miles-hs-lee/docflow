type FlashProps = {
  error?: string;
  success?: string;
};

export function Flash({ error, success }: FlashProps) {
  if (!error && !success) {
    return null;
  }

  return (
    <div className="flash-stack" role="status" aria-live="polite">
      {success ? <div className="flash flash-success">{success}</div> : null}
      {error ? <div className="flash flash-error">{error}</div> : null}
    </div>
  );
}
