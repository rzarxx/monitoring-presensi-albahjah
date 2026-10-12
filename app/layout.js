import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://absensi.albahjah.or.id";
const OG_IMAGE = `${APP_URL}/og-image.jpg`;

export const metadata = {
  metadataBase: new URL(APP_URL),
  title: "PRESENSI YAYASAN — Sistem Monitoring Kehadiran",
  description: "Platform manajemen dan monitoring presensi karyawan berbasis sidik jari secara real-time. Kelola kehadiran dengan mudah, akurat, dan aman.",

  // Favicon
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: [{ url: "/logo.png", type: "image/png" }],
    shortcut: "/logo.png",
  },

  // Open Graph — Facebook, WhatsApp, Telegram, LinkedIn
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "PRESENSI YAYASAN",
    title: "PRESENSI YAYASAN — Sistem Monitoring Kehadiran",
    description: "Platform manajemen dan monitoring presensi karyawan berbasis sidik jari secara real-time.",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Absensi-AB — Sistem Monitoring Kehadiran Biometrik",
        type: "image/jpeg",
      },
    ],
    locale: "id_ID",
  },

  // Twitter Card — Twitter / X
  twitter: {
    card: "summary_large_image",
    title: "PRESENSI YAYASAN — Sistem Monitoring Kehadiran",
    description: "Platform manajemen dan monitoring presensi karyawan berbasis sidik jari secara real-time.",
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="id"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      >
      <head>
        {/* Material Symbols is a third-party icon stylesheet required by the UI. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-on-surface min-h-screen flex flex-col selection:bg-primary-container selection:text-on-primary-container overflow-x-hidden font-sans">
        {children}
      </body>
    </html>
  );
}
