import { NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
