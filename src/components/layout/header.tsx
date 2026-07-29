"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Menu, Bell, Search, CheckCheck,
  CheckCircle2, Clock, AlertCircle, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { useRole } from "@/lib/role-context"
import { motion, AnimatePresence } from "motion/react"

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface Notification {
  _id: string
  type: string
  title: string
  message: string
  createdAt: string
  isRead: boolean
}

interface PatientResult {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  reportStatus: "pending" | "in_progress" | "completed"
  createdAt: string
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

function buildReportHref(p: PatientResult, mode: "fill" | "edit" = "fill") {
  const params = new URLSearchParams({
    patient: p.name, study: p.study, refBy: p.referredBy || "Self",
    date: dateOf(p.createdAt), age: String(p.age), gender: p.gender,
    srNo: String(p.srNo), contact: p.contact, id: p._id,
    ...(mode === "edit" ? { load: "1" } : {}),
  })
  return `/reports/new?${params}`
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-green-100 text-green-700"><CheckCircle2 className="h-2.5 w-2.5" />Done</span>
  if (status === "in_progress")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-yellow-100 text-yellow-700"><Clock className="h-2.5 w-2.5" />In Progress</span>
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-500"><AlertCircle className="h-2.5 w-2.5" />Pending</span>
}

/* ── Header ─────────────────────────────────────────────────────────────────── */

interface HeaderProps {
  onMenuClick: () => void
  /** Keep the menu button visible on desktop (pages where the sidebar is a drawer). */
  alwaysShowMenu?: boolean
}

export function Header({ onMenuClick, alwaysShowMenu = false }: HeaderProps) {
  const { user } = useRole()
  const router   = useRouter()

  /* ── Notifications ── */
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount,   setUnreadCount]   = useState(0)

  const fetchNotifications = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch("/api/notifications")
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications ?? [])
        setUnreadCount(data.unreadCount ?? 0)
      }
    } catch {}
  }, [user])

  useEffect(() => {
    fetchNotifications()
    const id = setInterval(fetchNotifications, 30000)
    return () => clearInterval(id)
  }, [fetchNotifications])

  const markAllRead = async () => {
    await fetch("/api/notifications", { method: "PATCH" })
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnreadCount(0)
  }
  const markOneRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" })
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  /* ── Search ── */
  const [query,     setQuery]     = useState("")
  const [results,   setResults]   = useState<PatientResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open,      setOpen]      = useState(false)

  const searchRef   = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) { setResults([]); setOpen(false); setSearching(false); return }

    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/patients?search=${encodeURIComponent(q)}&limit=6`)
        const data = await res.json()
        setResults(data.patients ?? [])
        setOpen(true)
      } catch { setResults([]) }
      finally  { setSearching(false) }
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Click outside closes dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const closeSearch = () => { setOpen(false); setQuery("") }

  const handleResultClick = (p: PatientResult) => {
    closeSearch()
    router.push(`/patients?q=${encodeURIComponent(p.name)}`)
  }

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-border bg-background px-4 lg:px-6">
        <Button variant="ghost" size="icon" className={alwaysShowMenu ? "" : "lg:hidden"} onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>

        {/* ── Live Search ── */}
        <div className="flex-1 max-w-xs sm:max-w-sm" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search patients, bills..."
              className="pl-9 pr-8 bg-muted/50 h-9 rounded-lg"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (results.length > 0) setOpen(true) }}
              onKeyDown={(e) => { if (e.key === "Escape") closeSearch() }}
              autoComplete="off"
            />
            {query && (
              <button
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={closeSearch}
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Dropdown */}
            <AnimatePresence>
              {(open || (searching && query)) && (
                <motion.div
                  className="absolute top-full left-0 right-0 mt-1.5 bg-background border border-border rounded-xl shadow-lg overflow-hidden z-50"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  style={{ minWidth: "min(360px, calc(100vw - 2rem))" }}
                >
                  {/* Header bar */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {searching ? "Searching…" : `${results.length} result${results.length !== 1 ? "s" : ""} for "${query}"`}
                    </p>
                    <button onClick={closeSearch} className="text-muted-foreground hover:text-foreground transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Loading skeletons */}
                  {searching && (
                    <div className="px-3 py-2 space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="flex items-center gap-3 py-1.5"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.06 }}
                        >
                          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-32" />
                            <Skeleton className="h-3 w-48" />
                          </div>
                          <Skeleton className="h-6 w-16 rounded-md shrink-0" />
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {/* No results */}
                  {!searching && open && results.length === 0 && (
                    <motion.div
                      className="flex flex-col items-center gap-1.5 py-7 text-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <Search className="h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm font-medium text-muted-foreground">No patients found</p>
                      <p className="text-xs text-muted-foreground/60">Try name, serial number, or phone</p>
                    </motion.div>
                  )}

                  {/* Results */}
                  {!searching && results.map((p, i) => (
                    <motion.div
                      key={p._id}
                      className="flex items-center gap-3 px-3 py-3 hover:bg-muted/40 border-b border-border/40 last:border-0 cursor-pointer transition-colors group"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.2 }}
                      onClick={() => handleResultClick(p)}
                    >
                      {/* Avatar */}
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {initials(p.name)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm leading-none">{p.name}</p>
                          <StatusBadge status={p.reportStatus} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          #{p.srNo} · {p.age}y {p.gender[0]} · {p.study}
                          {p.referredBy ? ` · ${p.referredBy}` : ""}
                        </p>
                      </div>

                      {/* Chevron hint */}
                      <Search className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* ── Notifications ── */}
          <DropdownMenu onOpenChange={(open) => { if (open && unreadCount > 0) markAllRead() }}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]" variant="destructive">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(320px,calc(100vw-1rem))]">
              <div className="flex items-center justify-between px-2 py-1.5">
                <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
                {unreadCount > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markAllRead() }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />Mark all read
                  </button>
                )}
              </div>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications yet</div>
              ) : (
                notifications.slice(0, 10).map((n) => (
                  <DropdownMenuItem
                    key={n._id}
                    className="flex items-start gap-2 cursor-pointer py-2.5"
                    onClick={() => { if (!n.isRead) markOneRead(n._id) }}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full transition-colors ${n.isRead ? "bg-transparent" : "bg-blue-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${n.isRead ? "font-normal" : "font-medium"}`}>{n.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">{timeAgo(n.createdAt)}</p>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
}
