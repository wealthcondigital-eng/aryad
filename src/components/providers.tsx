"use client"

import { RoleProvider } from "@/lib/role-context"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <RoleProvider>{children}</RoleProvider>
}
