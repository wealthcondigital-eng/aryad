"use client"

import { createContext, useContext, useEffect, useState } from "react"

export type Role = "admin" | "doctor" | "receptionist"

export interface Permissions {
  patients:  { view: boolean; create: boolean; edit: boolean }
  billing:   { view: boolean; create: boolean }
  reports:   { view: boolean; create: boolean; edit: boolean }
  analytics: { view: boolean }
  users:     { manage: boolean }
  doctors:   { view: boolean; manage: boolean }
  studies:   { view: boolean; manage: boolean }
}

export interface CurrentUser {
  id: string
  role: Role
  name: string
  email: string
  permissions: Permissions
}

// Clinical/operational modules are wide open for every role — admin, doctor
// and receptionist can all view/create/edit patients, billing, reports, etc.
// User Management (staff accounts + their permissions) is admin/doctor only —
// receptionist does not manage logins.
const FULL_PERMISSIONS: Permissions = {
  patients:  { view: true,  create: true,  edit: true  },
  billing:   { view: true,  create: true               },
  reports:   { view: true,  create: true,  edit: true  },
  analytics: { view: true                              },
  users:     { manage: true                            },
  doctors:   { view: true,  manage: true               },
  studies:   { view: true,  manage: true               },
}

export const DEFAULT_PERMISSIONS: Record<Role, Permissions> = {
  admin:  FULL_PERMISSIONS,
  doctor: FULL_PERMISSIONS,
  receptionist: { ...FULL_PERMISSIONS, users: { manage: false } },
}

interface RoleContextType {
  user: CurrentUser | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  updateUser: (updates: { name?: string }) => void
  ready: boolean
}

const RoleContext = createContext<RoleContextType>({
  user: null, login: async () => false, logout: () => {}, updateUser: () => {}, ready: false,
})

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [ready, setReady] = useState(false)

  // Restore session from httpOnly cookie via /api/auth/me
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setUser({
            id: data.user._id,
            role: data.user.role as Role,
            name: data.user.name,
            email: data.user.email,
            permissions: DEFAULT_PERMISSIONS[data.user.role as Role],
          })
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase(), password }),
      })
      if (!res.ok) return false
      const { user: u } = await res.json()
      setUser({
        id: u.id ?? u._id,
        role: u.role as Role,
        name: u.name,
        email: u.email,
        permissions: DEFAULT_PERMISSIONS[u.role as Role],
      })
      return true
    } catch {
      return false
    }
  }

  const logout = () => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    setUser(null)
  }

  const updateUser = (updates: { name?: string }) => {
    setUser((prev) => prev ? { ...prev, ...updates } : prev)
  }

  return (
    <RoleContext.Provider value={{ user, login, logout, updateUser, ready }}>
      {children}
    </RoleContext.Provider>
  )
}

export const useRole = () => useContext(RoleContext)
