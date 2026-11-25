import type { Metadata } from "next";
import { CHUNK_RETRY_INLINE_SCRIPT } from "@/lib/chunk-load-error";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <head>
        {/* Reloads once when a page chunk fails to load; see chunk-load-error.ts. */}
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RETRY_INLINE_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
