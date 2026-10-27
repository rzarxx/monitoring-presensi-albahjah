"use client";

import { useEffect, useRef } from "react";

// Singleton EventSource di browser supaya semua komponen dalam 1 tab berbagi 1 koneksi SSE
let sharedSource = null;
let sharedListeners = new Set();
let reconnectTimeout = null;

function ensureSource() {
  if (typeof window === "undefined") return;
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return;

  try {
    const es = new EventSource("/api/events");
    sharedSource = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        for (const fn of sharedListeners) {
          fn(data);
        }
      } catch {}
    };

    es.onerror = () => {
      try {
        es.close();
      } catch {}
      sharedSource = null;
      if (sharedListeners.size > 0 && !reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          ensureSource();
        }, 2000);
      }
    };
  } catch {}
}

/**
 * Hook untuk berlangganan event perubahan real-time dari server (0 delay).
 * @param {(event: { type: string, [key: string]: any }) => void} onEvent
 */
export function useRealtimeStream(onEvent) {
  const callbackRef = useRef(onEvent);

  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const handler = (event) => {
      if (callbackRef.current) callbackRef.current(event);
    };
    sharedListeners.add(handler);
    ensureSource();

    return () => {
      sharedListeners.delete(handler);
      if (sharedListeners.size === 0 && sharedSource) {
        try {
          sharedSource.close();
        } catch {}
        sharedSource = null;
      }
    };
  }, []);
}
