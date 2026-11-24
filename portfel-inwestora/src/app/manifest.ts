import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

/**
 * Lets a phone offer "add to home screen" with the Mexo icon instead of a
 * blank tile. Colours are the app canvas, so the splash and the status bar
 * blend with the page. `start_url` is the signed-in entry point; a visitor who
 * is not signed in is sent to /login by the app itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "Mexo",
    description: APP_DESCRIPTION,
    lang: "pl",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f4efe7",
    theme_color: "#f4efe7",
    icons: [
      { src: "/icons/mexo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/mexo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/mexo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
