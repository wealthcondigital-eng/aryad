"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  UserPlus, ShieldCheck, Stethoscope, ClipboardList,
  MoreHorizontal, Trash2, Pencil, ToggleLeft, ToggleRight,
  KeyRound, Loader2, AlertCircle, RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { useRole } from "@/lib/role-context"

// ── Types ──────────────────────────────────────────────────────────────────────

type Role = "admin" | "doctor" | "receptionist"

interface DBPermissions {
  patients:  { view: boolean; create: boolean; edit: boolean }
  billing:   { view: boolean; create: boolean; edit: boolean }
  reports:   { view: boolean; create: boolean; edit: boolean }
  analytics: { view: boolean }
  users:     { view: boolean; create: boolean; edit: boolean }
}

interface ManagedUser {
  _id: string
  name: string
  email: string
  role: Role
  active: boolean
  createdAt: string
  permissions: DBPermissions
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE_ICON: Record<Role, React.ElementType> = {
  admin: ShieldCheck, doctor: Stethoscope, receptionist: ClipboardList,
}

const ROLE_COLOR: Record<Role, string> = {
  admin:        "bg-blue-100 text-blue-700 border-blue-200",
  doctor:       "bg-purple-100 text-purple-700 border-purple-200",
  receptionist: "bg-green-100 text-green-700 border-green-200",
}

const PERMISSION_MODULES = [
  { key: "patients",  label: "Patients",   actions: ["view", "create", "edit"] },
  { key: "billing",   label: "Billing",    actions: ["view", "create", "edit"] },
  { key: "reports",   label: "Reports",    actions: ["view", "create", "edit"] },
  { key: "analytics", label: "Analytics",  actions: ["view"] },
  { key: "users",     label: "Users",      actions: ["view", "create", "edit"] },
] as const

const ROLE_DEFAULTS: Record<Role, DBPermissions> = {
  admin: {
    patients:  { view: true,  create: true,  edit: true  },
    billing:   { view: true,  create: true,  edit: true  },
    reports:   { view: true,  create: true,  edit: true  },
    analytics: { view: true  },
    users:     { view: true,  create: true,  edit: true  },
  },
  doctor: {
    patients:  { view: true,  create: false, edit: false },
    billing:   { view: false, create: false, edit: false },
    reports:   { view: true,  create: true,  edit: true  },
    analytics: { view: false },
    users:     { view: false, create: false, edit: false },
  },
  receptionist: {
    patients:  { view: true,  create: true,  edit: true  },
    billing:   { view: true,  create: true,  edit: false },
    reports:   { view: true,  create: false, edit: false },
    analytics: { view: false },
    users:     { view: false, create: false, edit: false },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
}

function permissionSummary(permissions: DBPermissions | undefined, role: Role): string {
  if (role === "admin") return "Full access"
  if (!permissions) return "Default"
  const total   = PERMISSION_MODULES.reduce((s, m) => s + m.actions.length, 0)
  const granted = PERMISSION_MODULES.reduce(
    (s, m) => s + m.actions.filter(a => (permissions as Record<string, Record<string, boolean>>)[m.key]?.[a]).length,
    0
  )
  if (granted === total) return "Full access"
  if (granted === 0)     return "No access"
  return `${granted}/${total} permissions`
}

// ── Permission editor ──────────────────────────────────────────────────────────

function PermissionEditor({
  permissions,
  onChange,
}: {
  permissions: DBPermissions
  onChange: (p: DBPermissions) => void
}) {
  const toggle = (module: string, action: string) => {
    const permsMap = permissions as Record<string, Record<string, boolean>>
    const updated = {
      ...permissions,
      [module]: { ...permsMap[module], [action]: !permsMap[module]?.[action] },
    }
    onChange(updated as DBPermissions)
  }

  const permsMap = permissions as Record<string, Record<string, boolean>>

  return (
    <div className="space-y-3">
      {PERMISSION_MODULES.map(({ key, label, actions }) => (
        <div key={key} className="flex items-center gap-4">
          <div className="w-24 text-sm font-medium text-slate-700 shrink-0">{label}</div>
          <div className="flex flex-wrap gap-2">
            {actions.map(action => {
              const allowed = permsMap[key]?.[action] ?? false
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggle(key, action)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors capitalize ${
                    allowed
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {action}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { user: me } = useRole()
  const router = useRouter()

  const [users,     setUsers]     = useState<ManagedUser[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [saving,    setSaving]    = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editUser,   setEditUser]   = useState<ManagedUser | null>(null)
  const [deleteId,   setDeleteId]   = useState<string | null>(null)
  const [pwdUser,    setPwdUser]    = useState<ManagedUser | null>(null)

  const [form,      setForm]      = useState({ name: "", email: "", password: "", role: "receptionist" as Role })
  const [newPerms,  setNewPerms]  = useState<DBPermissions>(ROLE_DEFAULTS.receptionist)
  const [createErr, setCreateErr] = useState("")
  const [newPwd,    setNewPwd]    = useState("")

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch("/api/users")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setUsers(data.users ?? [])
    } catch {
      setError("Failed to load users. Please refresh.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  // ── Guard ─────────────────────────────────────────────────────────────────────

  if (!me || me.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <ShieldCheck className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">You don&apos;t have access to this page.</p>
        <Button variant="outline" onClick={() => router.back()}>Go Back</Button>
      </div>
    )
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setCreateErr("All fields are required.")
      return
    }
    setCreateErr("")
    setSaving("__new__")
    try {
      const res  = await fetch("/api/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...form, permissions: newPerms }),
      })
      const data = await res.json()
      if (!res.ok) { setCreateErr(data.error ?? "Failed to create user."); return }
      setForm({ name: "", email: "", password: "", role: "receptionist" })
      setNewPerms(ROLE_DEFAULTS.receptionist)
      setCreateOpen(false)
      await loadUsers()
    } catch {
      setCreateErr("Server error. Please try again.")
    } finally {
      setSaving(null)
    }
  }

  async function handleSavePermissions() {
    if (!editUser) return
    setSaving(editUser._id)
    try {
      const res = await fetch(`/api/users/${editUser._id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ permissions: editUser.permissions }),
      })
      if (!res.ok) { setError("Failed to save permissions."); return }
      setUsers(us => us.map(u => u._id === editUser._id ? { ...u, permissions: editUser.permissions } : u))
      setEditUser(null)
    } catch {
      setError("Server error.")
    } finally {
      setSaving(null)
    }
  }

  async function handleToggleActive(u: ManagedUser) {
    setSaving(u._id)
    try {
      const res = await fetch(`/api/users/${u._id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ active: !u.active }),
      })
      if (!res.ok) { setError("Failed to update status."); return }
      setUsers(us => us.map(x => x._id === u._id ? { ...x, active: !u.active } : x))
    } catch {
      setError("Server error.")
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(deleteId)
    try {
      const res = await fetch(`/api/users/${deleteId}`, { method: "DELETE" })
      if (!res.ok) { setError("Failed to delete user."); return }
      setUsers(us => us.filter(u => u._id !== deleteId))
      setDeleteId(null)
    } catch {
      setError("Server error.")
    } finally {
      setSaving(null)
    }
  }

  async function handleResetPassword() {
    if (!pwdUser || !newPwd.trim()) return
    setSaving(pwdUser._id)
    try {
      const res = await fetch(`/api/users/${pwdUser._id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password: newPwd }),
      })
      if (!res.ok) { setError("Failed to reset password."); return }
      setNewPwd("")
      setPwdUser(null)
    } catch {
      setError("Server error.")
    } finally {
      setSaving(null)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const activeCount   = users.filter(u => u.active).length
  const inactiveCount = users.filter(u => !u.active).length
  const deleteTarget  = users.find(u => u._id === deleteId)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">Create and manage login access, roles, and permissions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadUsers} disabled={loading} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Create User
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold leading-none">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Users", value: users.length   },
          { label: "Active",      value: activeCount    },
          { label: "Inactive",    value: inactiveCount  },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{loading ? "—" : value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Users table */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold">All Users</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">No users found.</div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="pl-5 text-xs">User</TableHead>
                  <TableHead className="text-xs">Role</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Permissions</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Created</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                  <TableHead className="text-xs pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(u => {
                  const RoleIcon = ROLE_ICON[u.role]
                  const isSelf   = me.id === u._id
                  const isBusy   = saving === u._id
                  return (
                    <TableRow key={u._id} className={`hover:bg-muted/20 transition-opacity ${isBusy ? "opacity-50" : ""}`}>

                      {/* User info */}
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${ROLE_COLOR[u.role]}`}>
                            {initials(u.name)}
                          </div>
                          <div>
                            <p className="font-medium text-sm flex items-center gap-1.5">
                              {u.name}
                              {isSelf && (
                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-200">you</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Role */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[u.role]}`}>
                          <RoleIcon className="h-3 w-3" />
                          {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                        </span>
                      </TableCell>

                      {/* Permissions summary */}
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                        {permissionSummary(u.permissions, u.role)}
                      </TableCell>

                      {/* Created date */}
                      <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                        {new Date(u.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </TableCell>

                      {/* Status */}
                      <TableCell className="text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${u.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                          {u.active ? "Active" : "Inactive"}
                        </span>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right pr-5">
                        {isBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">

                              {u.role !== "admin" && (
                                <DropdownMenuItem
                                  className="flex items-center gap-2 cursor-pointer"
                                  onClick={() => setEditUser({ ...u })}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Edit Permissions
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuItem
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={() => setPwdUser(u)}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                                Reset Password
                              </DropdownMenuItem>

                              {!isSelf && (
                                <DropdownMenuItem
                                  className="flex items-center gap-2 cursor-pointer"
                                  onClick={() => handleToggleActive(u)}
                                >
                                  {u.active
                                    ? <><ToggleLeft  className="h-3.5 w-3.5" />Deactivate</>
                                    : <><ToggleRight className="h-3.5 w-3.5" />Activate</>
                                  }
                                </DropdownMenuItem>
                              )}

                              {u.role !== "admin" && !isSelf && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
                                    onClick={() => setDeleteId(u._id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete User
                                  </DropdownMenuItem>
                                </>
                              )}

                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>

                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create User Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onOpenChange={o => {
          if (!o) { setCreateErr(""); setForm({ name: "", email: "", password: "", role: "receptionist" }); setNewPerms(ROLE_DEFAULTS.receptionist) }
          setCreateOpen(o)
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {createErr && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {createErr}
              </div>
            )}

            {/* Basic info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Full Name</Label>
                <Input
                  placeholder="Dr. Sunita Rao"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Email</Label>
                <Input
                  type="email"
                  placeholder="user@center.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Password</Label>
              <Input
                type="password"
                placeholder="Set a strong password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
              />
            </div>

            {/* Role selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Role</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["admin", "doctor", "receptionist"] as Role[]).map(r => {
                  const Icon = ROLE_ICON[r]
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setForm(f => ({ ...f, role: r })); setNewPerms(ROLE_DEFAULTS[r]) }}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                        form.role === r
                          ? `${ROLE_COLOR[r]} ring-2 ring-offset-1 ring-blue-400`
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <p className="text-xs font-bold capitalize">{r}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Permissions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Permissions</Label>
                <button
                  type="button"
                  onClick={() => setNewPerms(ROLE_DEFAULTS[form.role])}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Reset to defaults
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <PermissionEditor permissions={newPerms} onChange={setNewPerms} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleCreate}
              disabled={saving === "__new__"}
            >
              {saving === "__new__"
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
                : "Create User"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Permissions Dialog ──────────────────────────────────────────── */}
      <Dialog open={!!editUser} onOpenChange={o => !o && setEditUser(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Permissions</DialogTitle>
          </DialogHeader>

          {editUser && (
            <div className="py-2">
              <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-muted/50">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${ROLE_COLOR[editUser.role]}`}>
                  {initials(editUser.name)}
                </div>
                <div>
                  <p className="font-semibold">{editUser.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{editUser.role} · {editUser.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditUser({ ...editUser, permissions: ROLE_DEFAULTS[editUser.role] })}
                  className="ml-auto text-xs text-blue-600 hover:underline shrink-0"
                >
                  Reset to defaults
                </button>
              </div>
              <PermissionEditor
                permissions={editUser.permissions ?? ROLE_DEFAULTS[editUser.role]}
                onChange={p => setEditUser({ ...editUser, permissions: p })}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleSavePermissions}
              disabled={saving === editUser?._id}
            >
              {saving === editUser?._id
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : "Save Permissions"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!pwdUser} onOpenChange={o => { if (!o) { setNewPwd(""); setPwdUser(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Set a new password for <span className="font-semibold text-foreground">{pwdUser?.name}</span>.
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">New Password</Label>
              <Input
                type="password"
                placeholder="Enter new password"
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleResetPassword()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdUser(null)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleResetPassword}
              disabled={!newPwd.trim() || saving === pwdUser?._id}
            >
              {saving === pwdUser?._id
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : "Reset Password"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will permanently delete{" "}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>{" "}
            and revoke their access. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving === deleteId}
            >
              {saving === deleteId
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</>
                : "Delete"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
