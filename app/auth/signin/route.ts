import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', 'M365 로그인은 제거되었습니다. 이메일 로그인을 사용해주세요.');
  return NextResponse.redirect(url);
}
