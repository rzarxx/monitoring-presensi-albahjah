"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Nama pengguna atau kata sandi tidak valid.");
        setLoading(false);
        return;
      }

      sessionStorage.setItem("showWelcome", "true");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError("Terjadi kesalahan pada koneksi. Silakan coba lagi.");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--color-surface-container)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px",
      fontFamily: "'Inter', system-ui, sans-serif",
      position: "relative", overflow: "hidden",
    }}>
      {/* Blob dekoratif */}
      <div style={{ position: "absolute", top: "-100px", right: "-100px", width: "400px", height: "400px", borderRadius: "50%", background: "radial-gradient(circle, rgba(5,150,105,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-100px", left: "-100px", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(15,23,42,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", width: "100%", maxWidth: "420px" }}>
        {/* Logo & Identitas Sistem */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ marginBottom: "16px", display: "flex", justifyContent: "center" }}>
            <Image
              src="/logo.png"
              alt="Presensi Yayasan Al Bahjah Pusat"
              width={80}
              height={80}
              style={{
                width: "80px",
                height: "80px",
                objectFit: "contain",
                display: "block",
                filter: "drop-shadow(0 8px 20px rgba(5,150,105,0.35))",
              }}
            />
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: "22px", fontWeight: 800, color: "var(--color-on-background)", letterSpacing: "-0.02em", textTransform: "uppercase" }}>
            Presensi Yayasan Al Bahjah Pusat
          </h1>
          <p style={{ margin: 0, fontSize: "11px", fontWeight: 500, color: "var(--color-outline)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Sistem Monitoring Kehadiran Pejuang
          </p>
        </div>

        {/* Kartu Login — Glassmorphism */}
        <div style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-outline-variant)",
          borderRadius: "22px",
          padding: "36px",
          boxShadow: "0 8px 40px rgba(0, 0, 0, 0.05)",
        }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: 700, color: "var(--color-on-background)" }}>
            Masuk ke Dashboard
          </h2>
          <p style={{ margin: "0 0 24px", fontSize: "13px", color: "var(--color-outline)" }}>
            Masukkan kredensial Anda untuk mengakses sistem.
          </p>

          {error && (
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: "var(--color-error-container)", color: "var(--color-on-error-container)",
              border: "1px solid var(--color-error)",
              padding: "12px 16px", borderRadius: "10px",
              marginBottom: "20px", fontSize: "13px",
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>error</span>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {[
              { key: "username", label: "Nama Pengguna", type: "text", icon: "person", placeholder: "Masukkan nama pengguna", autoComplete: "username" },
              { key: "password", label: "Kata Sandi", type: showPassword ? "text" : "password", icon: "lock", placeholder: "Masukkan kata sandi", autoComplete: "current-password" },
            ].map(field => (
              <div key={field.key}>
                <label style={{
                  display: "block", marginBottom: "8px",
                  fontSize: "11px", fontWeight: 700, color: "var(--color-outline)",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>{field.label}</label>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <span className="material-symbols-outlined" style={{ position: "absolute", left: "14px", color: "var(--color-outline)", fontSize: "18px" }}>{field.icon}</span>
                  <input
                    type={field.type}
                    required
                    autoComplete={field.autoComplete}
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={form[field.key]}
                    onChange={e => setForm({ ...form, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--color-surface-container-low)",
                      border: "1.5px solid var(--color-outline-variant)",
                      borderRadius: "10px", padding: "13px 40px",
                      fontSize: "14px", color: "var(--color-on-background)", outline: "none",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                    onFocus={e => { e.target.style.borderColor = "var(--color-primary)"; e.target.style.boxShadow = "0 0 0 3px rgba(5,150,105,0.1)"; }}
                    onBlur={e => { e.target.style.borderColor = "var(--color-outline-variant)"; e.target.style.boxShadow = "none"; }}
                  />
                  {field.key === "password" && (
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: "absolute", right: "12px", background: "transparent", border: "none",
                        cursor: "pointer", color: "var(--color-outline)", display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 10, padding: "8px"
                      }}
                      title={showPassword ? "Sembunyikan sandi" : "Tampilkan sandi"}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "8px", width: "100%",
                background: loading ? "var(--color-outline)" : "var(--color-primary)",
                color: "var(--color-on-primary)", border: "none", borderRadius: "10px",
                padding: "14px 16px", fontSize: "14px", fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                boxShadow: loading ? "none" : "0 4px 16px rgba(5,150,105,0.35)",
                transition: "all 0.2s",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "18px", animation: loading ? "spin 1s linear infinite" : "none" }}>
                {loading ? "progress_activity" : "login"}
              </span>
              {loading ? "Memverifikasi Kredensial..." : "Masuk ke Sistem"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "11px", marginTop: "24px", fontFamily: "'JetBrains Mono', monospace" }}>
          Powered by <strong style={{ color: "#059669" }}>PUTI</strong> (Pusat Teknologi Informasi Al-Bahjah) 2026
        </p>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
