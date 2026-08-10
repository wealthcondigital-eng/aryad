import type { Metadata } from "next"
import { Geist } from "next/font/google"
import "./globals.css"
import { ClientProviders } from "@/components/providers"
import { reportFontFaceCss } from "@/lib/report-fonts"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "Aarya Diagnostics Center — Management System",
  description: "Aarya Diagnostics Center patient management system",
  icons: {
    icon: "/logo.jpeg",
    shortcut: "/logo.jpeg",
    apple: "/logo.jpeg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={geistSans.variable}>
      <head>
        {/* Word's font families, each backed by the real font where it exists
            and a bundled open substitute where it doesn't — see report-fonts.ts.
            Declared here rather than in globals.css because the print window
            and the PDF host build their own documents from the same generator. */}
        <style dangerouslySetInnerHTML={{ __html: reportFontFaceCss() }} />
      </head>
      <body className="min-h-screen bg-background antialiased">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}
