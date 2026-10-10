"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import MetricBar from "@/app/components/MetricBar";
import Modal from "@/app/components/Modal";

export default function DashboardShell({ children, metrics }) {
  const router = useRouter();
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(j => { if (j.user) setCurrentUser(j.user); })
      .catch(() => {});
  }, []);

  const isSuperAdmin = currentUser?.role === 'superadmin';

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  // Admin menu hanya tampil untuk superadmin
  const navItems = [
    { href: "/", label: "Dasbor", icon: "dashboard" },
    { href: "/employees", label: "Karyawan", icon: "groups" },
    ...(isSuperAdmin ? [{ href: "/devices", label: "Mesin", icon: "memory" }] : []),
    ...(isSuperAdmin ? [{ href: "/admins", label: "Admin", icon: "admin_panel_settings" }] : []),
  ];

  const isActive = (href) => pathname === href;

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      /* Gradient background agar glassmorphism terlihat */
      background: "linear-gradient(140deg, var(--color-surface-container-high) 0%, var(--color-surface) 35%, var(--color-surface-container-highest) 65%, var(--color-surface-container) 100%)",
      fontFamily: "'Inter', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>

      {/* Dekorasi background blob */}
      <div style={{
        position: "fixed", top: "-120px", right: "-120px",
        width: "480px", height: "480px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />
      <div style={{
        position: "fixed", bottom: "-80px", left: "-80px",
        width: "360px", height: "360px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(71,85,105,0.08) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* ── TopAppBar ─────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        /* Glassmorphism navbar */
        background: "rgba(255, 255, 255, 0.78)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--color-outline-variant)",
        boxShadow: "0 1px 20px rgba(0, 0, 0, 0.05)",
      }}>
        <div className="mobile-px" style={{
          maxWidth: "1440px", margin: "0 auto", padding: "0 40px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: "60px", position: "relative", zIndex: 1,
        }}>
          {/* Logo */}
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
            <img
              src="/logo.png"
              alt="PRESENSI YAYASAN Logo"
              style={{
                width: "36px",
                height: "36px",
                objectFit: "contain",
                filter: "drop-shadow(0 2px 6px rgba(5,150,105,0.25))",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--color-primary)", letterSpacing: "-0.01em", textTransform: "uppercase" }}>
                Presensi Yayasan
              </span>
              <span style={{ fontSize: "9px", color: "var(--color-outline)", fontWeight: 500, letterSpacing: "0.04em" }}>
                Sistem Monitoring Kehadiran
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {navItems.map(item => (
              <Link key={item.href} href={item.href} style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "7px 16px", borderRadius: "9px", fontSize: "13px", fontWeight: 600,
                textDecoration: "none", transition: "all 0.15s",
                background: isActive(item.href)
                  ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-container))"
                  : "transparent",
                color: isActive(item.href) ? "var(--color-on-primary)" : "var(--color-outline)",
                boxShadow: isActive(item.href) ? "0 2px 8px rgba(5,150,105,0.25)" : "none",
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: "17px", fontVariationSettings: `'FILL' ${isActive(item.href) ? 1 : 0}` }}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Account */}
          <button
            onClick={() => setShowLogoutModal(true)}
            title="Keluar"
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "7px 12px", border: "1px solid var(--color-outline-variant)",
              borderRadius: "9px",
              background: "var(--color-surface)",
              backdropFilter: "blur(8px)",
              cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--color-on-surface-variant)",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--color-surface-container-high)"; e.currentTarget.style.color = "var(--color-error)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--color-surface)"; e.currentTarget.style.color = "var(--color-on-surface-variant)"; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>account_circle</span>
            <span className="hide-mobile" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "1px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, lineHeight: 1 }}>{currentUser?.username || "Admin"}</span>
              <span style={{
                fontSize: "9px", fontWeight: 600, lineHeight: 1,
                color: isSuperAdmin ? "#059669" : "#6366f1",
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                {isSuperAdmin ? "Super Admin" : "Admin"}
              </span>
            </span>
          </button>
        </div>
      </header>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <main style={{ flex: 1, position: "relative", zIndex: 1 }}>
        {/* MetricBar: floating, dengan jarak dari navbar */}
        <div className="mobile-px" style={{
          maxWidth: "1440px", margin: "0 auto",
          padding: "24px 40px 0",
        }}>
          <MetricBar metrics={metrics} />
        </div>

        {/* Konten halaman */}
        {children}
      </main>

      {/* ── Bottom Nav (Mobile) ───────────────────────────────────────── */}
      <nav style={{
        display: "flex", position: "fixed", bottom: 0, left: 0, right: 0,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid var(--color-outline-variant)",
        zIndex: 50, padding: "8px 0 14px",
      }} className="bottom-nav">
        {[...navItems, { href: "#logout", label: "Keluar", icon: "logout" }].map(item => {
          const active = item.href !== "#logout" && isActive(item.href);
          return (
            <button
              key={item.href}
              onClick={() => item.href === "#logout" ? setShowLogoutModal(true) : router.push(item.href)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                border: "none", background: "none", cursor: "pointer",
                color: active ? "var(--color-primary)" : "var(--color-outline)",
                transition: "color 0.15s",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "22px", fontVariationSettings: `'FILL' ${active ? 1 : 0}` }}>
                {item.icon}
              </span>
              <span style={{ fontSize: "10px", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── Logout Modal ──────────────────────────────────────────────── */}
      <Modal isOpen={showLogoutModal} onClose={() => setShowLogoutModal(false)} title="Konfirmasi Keluar" size="sm">
        <p style={{ color: "var(--color-outline)", marginBottom: "24px", fontSize: "14px", lineHeight: 1.6 }}>
          Sesi Anda akan diakhiri. Apakah Anda yakin ingin keluar dari sistem?
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={() => setShowLogoutModal(false)} style={{
            padding: "10px 18px", border: "1px solid var(--color-outline-variant)", borderRadius: "9px",
            background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-surface)",
          }}>Batal</button>
          <button onClick={handleLogout} disabled={loggingOut} style={{
            padding: "10px 18px", background: "var(--color-error)", border: "none",
            borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "var(--color-on-error)",
            cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
            opacity: loggingOut ? 0.6 : 1,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>logout</span>
            {loggingOut ? "Keluar..." : "Ya, Keluar"}
          </button>
        </div>
      </Modal>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer style={{
        textAlign: "center",
        padding: "14px 24px",
        borderTop: "1px solid var(--color-outline-variant)",
        fontSize: "11px",
        color: "var(--color-outline)",
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(8px)",
        position: "relative",
        zIndex: 1,
        // Beri jarak dari bottom-nav di mobile
        paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
      }}>
        <span>
          Powered by{" "}
          <strong style={{ color: "var(--color-primary)", fontWeight: 700 }}>PUTI</strong>
          {" "}(Pusat Teknologi Informasi Al-Bahjah)
        </span>
      </footer>

      <style>{`
        @media (min-width: 768px) { .bottom-nav { display: none !important; } footer { padding-bottom: 14px !important; } }
        @media (max-width: 767px) { footer { margin-bottom: 70px; } .hide-mobile { display: none !important; } .mobile-px { padding-left: 16px !important; padding-right: 16px !important; } }
      `}</style>
    </div>
  );
}
