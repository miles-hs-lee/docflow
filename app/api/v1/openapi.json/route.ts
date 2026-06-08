import { NextResponse } from 'next/server';

import { buildOpenApiSpec } from '@/lib/api/openapi';

// The OpenAPI 3.0 contract. Import into Postman/Insomnia, generate SDKs, or feed
// Zapier/Make. Rendered interactively at /api/v1/docs.
export async function GET() {
  return NextResponse.json(buildOpenApiSpec());
}
