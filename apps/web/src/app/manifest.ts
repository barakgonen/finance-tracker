import type { MetadataRoute } from "next";

// "Add to Home Screen": opens full-screen like an app
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "הכספים שלנו",
    short_name: "הכספים",
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "he",
    background_color: "#f5f6f8",
    theme_color: "#0e6b66",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
