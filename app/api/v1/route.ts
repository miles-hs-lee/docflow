import { NextResponse } from 'next/server';

import { publicEnv } from '@/lib/env-public';

export async function GET() {
  return NextResponse.json({
    name: 'DocFlow API',
    version: '1.0.0',
    documentation: `${publicEnv.appUrl}/api/v1/docs`,
    openapi: `${publicEnv.appUrl}/api/v1/openapi.json`,
    authentication: 'Bearer <API key> — create one in the dashboard, same key works for MCP (/api/mcp)'
  });
}
