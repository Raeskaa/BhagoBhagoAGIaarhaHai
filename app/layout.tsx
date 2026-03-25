import type { Metadata } from "next";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Five at the Fire",
  description: "A browser-based village simulation where five autonomous chaotic personalities move, argue, bond, and speak.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
