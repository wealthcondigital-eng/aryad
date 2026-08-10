"use client"

import { RoleProvider } from "@/lib/role-context"
import { ConfirmProvider } from "@/components/confirm-dialog"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      {/* Every page's confirm()/alert() goes through this — see confirm-dialog.tsx */}
      <ConfirmProvider>{children}</ConfirmProvider>
    </RoleProvider>
  )
}
