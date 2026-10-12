import { NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';

export async function POST(request) {
  const session = await getUserSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const response = NextResponse.json({ message: 'Logged out' });
  response.cookies.delete('auth_token');
  return response;
}
