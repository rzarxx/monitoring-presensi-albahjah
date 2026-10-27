export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureRealtimeMonitorStarted } = await import('./lib/realtime-monitor');
    ensureRealtimeMonitorStarted();
  }
}
