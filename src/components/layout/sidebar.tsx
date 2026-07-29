"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, Users, UserCog, FlaskConical, Receipt,
  FileText, CalendarDays, Activity, LogOut, X, UserPlus,
  ShieldCheck, ClipboardList, Stethoscope, ChevronRight, LayoutTemplate, PenTool,
  PanelLeftClose, PanelLeftOpen, FileSpreadsheet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useRole, Role } from "@/lib/role-context"

// Clinical/operational nav — every role sees these.
const BASE_NAV: { href: string; label: string; icon: React.ElementType; highlight?: boolean }[] = [
  { href: "/dashboard",    label: "Dashboard",       icon: LayoutDashboard },
  { href: "/patients/new", label: "New Patient",     icon: UserPlus,       highlight: true },
  { href: "/patients",     label: "All Patients",    icon: Users },
  { href: "/billing",      label: "Billing",         icon: Receipt },
  { href: "/reports",      label: "Reports",         icon: FileText },
  { href: "/doctors",      label: "Doctors",         icon: UserCog },
  { href: "/register",     label: "Monthly Register", icon: FileSpreadsheet },
  { href: "/signatures",   label: "Add Signature",  icon: PenTool },
  { href: "/add-template", label: "Add Template", icon: LayoutTemplate },
  { href: "/studies",      label: "Studies & Tests", icon: FlaskConical },
  { href: "/analytics",    label: "Analytics",       icon: CalendarDays },
]

const USER_MANAGEMENT_NAV = { href: "/admin/users", label: "User Management", icon: ShieldCheck }

// Admin and doctor can manage staff logins; receptionist cannot.
const NAV_BY_ROLE: Record<Role, { href: string; label: string; icon: React.ElementType; highlight?: boolean }[]> = {
  admin:        [...BASE_NAV, USER_MANAGEMENT_NAV],
  doctor:       [...BASE_NAV, USER_MANAGEMENT_NAV],
  receptionist: BASE_NAV,
}

const ROLE_ICON: Record<Role, React.ElementType> = {
  admin:        ShieldCheck,
  doctor:       Stethoscope,
  receptionist: ClipboardList,
}

const ROLE_STYLE: Record<Role, { bg: string; text: string; dot: string }> = {
  admin:        { bg: "bg-blue-50",   text: "text-blue-700",  dot: "bg-blue-500"  },
  doctor:       { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  receptionist: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
}

const ROLE_LABEL: Record<Role, string> = {
  admin:        "Admin",
  doctor:       "Doctor",
  receptionist: "Receptionist",
}

const AVATAR_COLOR: Record<Role, string> = {
  admin:        "bg-blue-600",
  doctor:       "bg-purple-600",
  receptionist: "bg-emerald-600",
}

interface SidebarProps {
  open?: boolean
  onClose?: () => void
  /**
   * Behave as an overlay drawer on desktop too, instead of a permanent column —
   * for a full-bleed page that needs the whole window width and would
   * otherwise be squeezed by a permanent 240px navigation column. Currently
   * unused (no route opts into full-bleed), left in place as it's cheap,
   * general-purpose sidebar behaviour rather than tied to any one page.
   */
  drawerOnDesktop?: boolean
  /** Icon-only rail instead of the full labeled column. Desktop-only — the
   * mobile drawer always renders expanded since it's a transient overlay,
   * not a column competing with the page for width. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function Sidebar({ open = true, onClose, drawerOnDesktop = false, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, logout } = useRole()

  const navItems    = user ? NAV_BY_ROLE[user.role] : []
  const RoleIcon    = user ? ROLE_ICON[user.role] : Activity
  const roleStyle   = user ? ROLE_STYLE[user.role] : ROLE_STYLE.admin
  const avatarColor = user ? AVATAR_COLOR[user.role] : "bg-blue-600"
  const initials    = user?.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"

  const handleLogout = () => {
    logout()
    router.push("/login")
  }

  // The rail only collapses on the permanent desktop column — a drawer (mobile,
  // or a full-bleed page forcing drawerOnDesktop) is a transient overlay with
  // room to spare, so it always renders expanded regardless of this preference.
  // Every collapsed-only style below is gated through `rc` and scoped to `lg:`
  // so nothing below that breakpoint ever reflects it.
  const rc = collapsed && !drawerOnDesktop

  return (
    <>
      {open && (
        <div
          className={cn("fixed inset-0 z-20 bg-black/40", !drawerOnDesktop && "lg:hidden")}
          onClick={onClose}
        />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-white border-r border-gray-200 transition-[transform,width] duration-300",
        // In drawer mode the desktop overrides are dropped, so the panel stays
        // fixed and slides in over the content rather than reserving a column.
        !drawerOnDesktop && "lg:static lg:translate-x-0 lg:z-auto",
        rc && "lg:w-[68px]",
        open ? "translate-x-0" : "-translate-x-full"
      )}>

        {/* ── Logo ── */}
        <div className={cn(
          "flex h-14 items-center justify-between px-4 shrink-0 border-b border-gray-100",
          rc && "lg:justify-center lg:px-2"
        )}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg overflow-hidden shrink-0 ring-1 ring-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpeg" alt="Aarya" className="h-full w-full object-cover" />
            </div>
            <div className={cn("min-w-0", rc && "lg:hidden")}>
              <p className="text-sm font-bold text-gray-900 leading-none truncate">Aarya Diagnostic</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Center</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={cn(
              "p-1.5 rounded-md hover:bg-gray-100 text-gray-400 transition-colors",
              // In drawer mode there is no permanent column, so the close
              // button has to stay reachable on desktop as well.
              !drawerOnDesktop && "lg:hidden"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Collapse toggle — desktop only, permanent column only ── */}
        {!drawerOnDesktop && onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "hidden lg:flex items-center gap-2 justify-start h-9 px-4 shrink-0 border-b border-gray-100 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors",
              rc && "lg:justify-center lg:px-0"
            )}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
            <span className={cn("text-xs font-medium", rc && "lg:hidden")}>Collapse</span>
          </button>
        )}

        {/* ── Role badge ── */}
        {user && (
          <>
            <div className={cn("px-3 pt-3 pb-1", rc && "lg:hidden")}>
              <div className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5", roleStyle.bg)}>
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", roleStyle.dot)} />
                <RoleIcon className={cn("h-3 w-3 shrink-0", roleStyle.text)} />
                <span className={cn("text-[11px] font-semibold uppercase tracking-wider", roleStyle.text)}>
                  {ROLE_LABEL[user.role]}
                </span>
              </div>
            </div>
            <div className={cn("hidden justify-center pt-3 pb-1", rc && "lg:flex")} title={ROLE_LABEL[user.role]}>
              <div className={cn("flex items-center justify-center h-7 w-7 rounded-lg", roleStyle.bg)}>
                <RoleIcon className={cn("h-3.5 w-3.5", roleStyle.text)} />
              </div>
            </div>
          </>
        )}

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto py-2 px-2.5 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, highlight }) => {
            const isActive =
              pathname === href ||
              (href !== "/patients/new" && href !== "/patients" && href !== "/admin" &&
               pathname.startsWith(href + "/"))
            const isNew = !!highlight

            if (isNew) {
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  title={rc ? label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors mb-1 shadow-sm",
                    rc && "lg:justify-center lg:px-2"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={cn(rc && "lg:hidden")}>{label}</span>
                  <span className={cn(
                    "ml-auto text-[10px] bg-white/20 rounded px-1.5 py-0.5 font-bold tracking-wide",
                    rc && "lg:hidden"
                  )}>
                    NEW
                  </span>
                </Link>
              )
            }

            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                title={rc ? label : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  rc && "lg:justify-center lg:px-2",
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <Icon className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-blue-600" : "text-gray-400 group-hover:text-gray-700"
                )} />
                <span className={cn("flex-1", rc && "lg:hidden")}>{label}</span>
                {isActive && (
                  <ChevronRight className={cn("h-3.5 w-3.5 text-blue-400 shrink-0", rc && "lg:hidden")} />
                )}
              </Link>
            )
          })}
        </nav>

        {/* ── User + Sign out ── */}
        <div className={cn("border-t border-gray-100 p-3 space-y-1", rc && "lg:px-2")}>
          {user && (
            <Link
              href="/profile"
              onClick={onClose}
              title={rc ? user.name : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors group",
                rc && "lg:justify-center lg:px-1"
              )}
            >
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                avatarColor
              )}>
                {initials}
              </div>
              <div className={cn("min-w-0 flex-1", rc && "lg:hidden")}>
                <p className="text-sm font-semibold text-gray-900 truncate leading-none">{user.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5 truncate group-hover:text-gray-500">Edit profile</p>
              </div>
            </Link>
          )}
          <button
            title={rc ? "Sign Out" : undefined}
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors group",
              rc && "lg:justify-center lg:px-2"
            )}
          >
            <LogOut className="h-4 w-4 text-gray-400 group-hover:text-red-500 transition-colors shrink-0" />
            <span className={cn(rc && "lg:hidden")}>Sign Out</span>
          </button>
        </div>

      </aside>
    </>
  )
}
