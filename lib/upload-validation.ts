// Shared validation for multipart upload routes (owner PDF, file-request,
// logo). The per-route allowed extension→MIME maps stay local (different
// allowlists), but the extraction + magic-byte logic lives here so it can't
// drift across routes.

// Lowercased extension without the dot, or '' when there is none.
export function fileExtension(name: string): string {
  return (name.includes('.') ? name.split('.').pop() : '')?.toLowerCase() ?? '';
}

// True when the file's leading bytes match the signature expected for its
// content type. Types we don't positively sniff (svg, webp, office docs, zip,
// …) return true — callers gate those by extension + the bucket's
// allowed_mime_types backstop. Pass at least the first 5 bytes.
export function magicByteMatches(header: Buffer, contentType: string): boolean {
  switch (contentType) {
    case 'application/pdf':
      return header.subarray(0, 5).toString('binary') === '%PDF-';
    case 'image/png':
      return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    case 'image/jpeg':
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    default:
      return true;
  }
}
