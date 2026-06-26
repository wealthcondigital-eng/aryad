import type { Metadata } from "next"
import { Geist } from "next/font/google"
import "./globals.css"
import { ClientProviders } from "@/components/providers"

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
      <body className="min-h-screen bg-background antialiased">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}
