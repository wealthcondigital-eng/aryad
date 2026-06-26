"use client"

import { useState } from "react"
import { useRole } from "@/lib/role-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ShieldCheck, Stethoscope, ClipboardList, CheckCircle2 } from "lucide-react"

const ROLE_ICON = { admin: ShieldCheck, doctor: Stethoscope, receptionist: ClipboardList }
const ROLE_LABEL = { admin: "Admin", doctor: "Doctor", receptionist: "Receptionist" }
const ROLE_COLOR = { admin: "bg-blue-500", doctor: "bg-purple-500", receptionist: "bg-green-500" }

export default function ProfilePage() {
  const { user, updateUser } = useRole()

  const [name,        setName]        = useState(user?.name ?? "")
  const [password,    setPassword]    = useState("")
  const [confirmPass, setConfirmPass] = useState("")
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState("")

  if (!user) return null

  const RoleIcon  = ROLE_ICON[user.role]
  const initials  = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?"
  const nameChanged = name.trim() !== user.name
  const passChanged = password.trim().length > 0

  const handleSave = async () => {
    setError("")
    if (!name.trim()) { setError("Name cannot be empty."); return }
    if (passChanged && password !== confirmPass) { setError("Passwords do not match."); return }
    if (passChanged && password.length < 6) { setError("Password must be at least 6 characters."); return }

    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (nameChanged) body.name = name.trim()
      if (passChanged) body.password = password

      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? "Failed to save.")
        return
      }
      const { user: updated } = await res.json()
      updateUser({ name: updated.name })
      setName(updated.name)
      setPassword("")
      setConfirmPass("")
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage your account details</p>
      </div>

      {/* Avatar + role card */}
      <Card>
        <CardContent className="p-5 flex items-center gap-4">
          <div className={`h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0 ${ROLE_COLOR[user.role]}`}>
            {initials}
          </div>
          <div>
            <p className="font-semibold text-base">{user.name}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <span className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-muted-foreground">
              <RoleIcon className="h-3 w-3" />
              {ROLE_LABEL[user.role]}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Edit name */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Edit Details</CardTitle>
          <CardDescription>Update your display name or change your password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }}
              placeholder="Your full name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={user.email} disabled className="bg-muted text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Change Password <span className="text-muted-foreground font-normal">(optional)</span></p>
            <div className="space-y-1.5">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setSaved(false) }}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPass">Confirm New Password</Label>
              <Input
                id="confirmPass"
                type="password"
                value={confirmPass}
                onChange={(e) => { setConfirmPass(e.target.value); setSaved(false) }}
                placeholder="Re-enter new password"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSave}
              disabled={saving || (!nameChanged && !passChanged)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4" />Saved
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
