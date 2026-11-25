import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 → statyczna wersja na GitHub Pages (wszystkie API wołane z przeglądarki).
 * - output: "export" generuje katalog out/,
 *   (API routes są pomijane – w tym trybie UI woła API bezpośrednio, zob. src/lib/planner.ts),
 * - basePath: strona projektu działa pod https://<user>.github.io/<repo>/.
 */
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.PAGES_BASE_PATH ?? "/whatsonroad";

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      env: { NEXT_PUBLIC_STATIC_EXPORT: "1" },
    }
  : {};

export default nextConfig;
