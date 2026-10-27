"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtimeStream } from "@/app/components/useRealtimeStream";

const STORAGE_KEY = "selectedDeviceId";
export const ALL_DEVICES = "all";

function readStoredDevice() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeDevice(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {}
}

export function useSelectedDevice({ allowAll = false } = {}) {
  const [devices, setDevices] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [deviceId, setDeviceIdState] = useState("");

  const resolve = useCallback((list, wanted) => {
    if (allowAll && wanted === ALL_DEVICES) return ALL_DEVICES;
    if (list.some((device) => String(device.id) === wanted)) return wanted;
    return list[0] ? String(list[0].id) : "";
  }, [allowAll]);

  const reloadDevices = useCallback(() => {
    fetch("/api/devices")
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .catch(() => ({ data: [] }))
      .then((json) => {
        const list = json.data || [];
        setDevices(list);
        setDeviceIdState((prev) => resolve(list, prev || readStoredDevice()));
        setLoaded(true);
      });
  }, [resolve]);

  useEffect(() => {
    reloadDevices();
  }, [reloadDevices]);

  useRealtimeStream((event) => {
    if (event.type === "devices") {
      reloadDevices();
    }
  });

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setDeviceIdState(resolve(devices, event.newValue || ""));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [devices, resolve]);

  const setDeviceId = useCallback((value) => {
    storeDevice(value);
    setDeviceIdState(value);
  }, []);

  const device = devices.find((item) => String(item.id) === deviceId) || null;
  return { devices, deviceId, setDeviceId, device, isAll: deviceId === ALL_DEVICES, loaded, reloadDevices };
}

export function deviceLabel(device) {
  if (!device) return "";
  return device.segment_name ? `${device.name} (${device.segment_name})` : device.name;
}

export default function DeviceSelect({ devices, value, onChange, allowAll = false, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "var(--color-primary)" }}>memory</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Pilih mesin presensi"
        style={{ minWidth: "250px", maxWidth: "100%", padding: "9px 12px", border: "1px solid var(--color-outline-variant)", borderRadius: "8px", background: "var(--color-surface)", color: "var(--color-on-background)", fontWeight: 600, ...style }}>
        {!allowAll && <option value="">Pilih mesin presensi</option>}
        {allowAll && <option value={ALL_DEVICES}>Semua mesin</option>}
        {devices.map((device) => <option key={device.id} value={device.id}>{deviceLabel(device)}</option>)}
      </select>
    </div>
  );
}
