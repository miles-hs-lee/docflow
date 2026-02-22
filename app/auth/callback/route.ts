import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', 'OAuth 콜백은 더 이상 사용되지 않습니다. 이메일 로그인으로 진행해주세요.');
  return NextResponse.redirect(url);
}
