import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vicora", template: "%s · Vicora" },
  description: "One shared timeline for shippers, brokers, carriers, auto transporters and customs brokers.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f57d0" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
