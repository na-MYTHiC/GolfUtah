import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "./components/service-worker";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "GolfUtah",
  description: "Every Utah tee time worth playing, in one place.",
  manifest: `${basePath}/manifest.json`,
  appleWebApp: {
    capable: true,
    title: "GolfUtah",
    // Matches the page background so the iOS status bar blends in rather
    // than sitting on a white strip above the app.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: `${basePath}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${basePath}/icon.svg`, type: "image/svg+xml" },
    ],
    apple: [
      { url: `${basePath}/icon-180.png`, sizes: "180x180" },
      { url: `${basePath}/icon-167.png`, sizes: "167x167" },
      { url: `${basePath}/icon-152.png`, sizes: "152x152" },
      { url: `${basePath}/icon-120.png`, sizes: "120x120" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#064e3b",
  // Fills the notch area on iPhone when launched from the home screen.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
