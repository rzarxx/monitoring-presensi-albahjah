"use client";

export default function MetricBar({ metrics }) {
  const { totalScansToday = 0, authorized = 0, unauthorized = 0 } = metrics || {};
  const rate = totalScansToday > 0 ? ((authorized / totalScansToday) * 100).toFixed(1) : "0.0";

  const items = [
    {
      label: "Total Scan Hari Ini",
      value: totalScansToday,
      icon: "fingerprint",
      accent: "#003d9b",
      gradFrom: "rgba(0, 61, 155, 0.12)",
      gradTo: "rgba(0, 61, 155, 0.04)",
      border: "rgba(0, 61, 155, 0.18)",
    },
    {
      label: "Berhasil",
      value: authorized,
      icon: "check_circle",
      accent: "#1a7a4a",
      gradFrom: "rgba(26, 122, 74, 0.12)",
      gradTo: "rgba(26, 122, 74, 0.04)",
      border: "rgba(26, 122, 74, 0.18)",
    },
    {
      label: "Tidak Dikenal",
      value: unauthorized,
      icon: "gpp_bad",
      accent: "#ba1a1a",
      gradFrom: "rgba(186, 26, 26, 0.12)",
      gradTo: "rgba(186, 26, 26, 0.04)",
      border: "rgba(186, 26, 26, 0.18)",
    },
    {
      label: "Keberhasilan",
      value: rate + "%",
      icon: "analytics",
      accent: "#46617b",
      gradFrom: "rgba(70, 97, 123, 0.12)",
      gradTo: "rgba(70, 97, 123, 0.04)",
      border: "rgba(70, 97, 123, 0.18)",
    },
  ];

  return (
    <div style={{
      display: "flex",
      gap: "14px",
      overflowX: "auto",
      paddingBottom: "4px",
      /* Hide scrollbar but keep functionality */
      msOverflowStyle: "none",
      scrollbarWidth: "none",
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 0",
            minWidth: "160px",
            /* Glassmorphism */
            background: `linear-gradient(135deg, ${item.gradFrom}, ${item.gradTo})`,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${item.border}`,
            borderRadius: "16px",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            boxShadow: `0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.7)`,
            position: "relative",
            overflow: "hidden",
            transition: "transform 0.2s, box-shadow 0.2s",
            cursor: "default",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = `0 8px 28px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.7)`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.7)`;
          }}
        >
          {/* Decorative circle */}
          <div style={{
            position: "absolute", top: "-16px", right: "-16px",
            width: "72px", height: "72px", borderRadius: "50%",
            background: item.gradFrom,
            pointerEvents: "none",
          }} />

          {/* Icon */}
          <div style={{
            width: "40px", height: "40px", borderRadius: "12px",
            background: `rgba(255,255,255,0.6)`,
            border: `1px solid ${item.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            backdropFilter: "blur(8px)",
          }}>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: "20px",
                color: item.accent,
                fontVariationSettings: "'FILL' 1",
              }}
            >
              {item.icon}
            </span>
          </div>

          {/* Text */}
          <div style={{ position: "relative" }}>
            <div style={{
              fontSize: "10px",
              fontFamily: "'JetBrains Mono', monospace",
              color: item.accent,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: "4px",
              opacity: 0.75,
              whiteSpace: "nowrap",
            }}>
              {item.label}
            </div>
            <div style={{
              fontSize: "22px",
              fontWeight: 800,
              color: item.accent,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}>
              {item.value}
            </div>
          </div>
        </div>
      ))}

      <style>{`div::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
