import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.158", "192.168.1.23", "110.226.179.112", "192.168.1.24"],

  async rewrites() {
    return [
      // The link a patient receives is `/mr-yogesh-patel-abd-pel-male-report.pdf`
      // — it ends in .pdf so tapping it in WhatsApp opens the file itself rather
      // than a page about the file. `app/[slug]/page.tsx` already owns `/{slug}`,
      // and one segment can't be both a page and a route handler, so the .pdf
      // form is rewritten onto the existing handler at `/{slug}/pdf`.
      //
      // afterFiles ordering (what a plain array means) is what makes this safe:
      // real files in /public still win, and only then does this run — ahead of
      // the `/{slug}` dynamic page, which would otherwise swallow `foo.pdf`.
      { source: "/:slug([^/]+)\\.pdf", destination: "/:slug/pdf" },
    ]
  },
};

export default nextConfig;
