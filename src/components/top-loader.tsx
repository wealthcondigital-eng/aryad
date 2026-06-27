"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState, Suspense } from "react"
import { cn } from "@/lib/utils"

function TopLoaderBar() {
  const pathname    = usePathname()
  const searchParams = useSearchParams()

  type State = "idle" | "loading" | "complete"
  const [state,    setState]    = useState<State>("idle")
  const [progress, setProgress] = useState(0)

  const prevKeyRef   = useRef(pathname + searchParams.toString())
  const t1Ref   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const t2Ref   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const t3Ref   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const doneRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Intercept internal link clicks → start the bar
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest("a")
      if (!a?.href) return
      if (a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      try {
        const url = new URL(a.href)
        if (url.origin !== window.location.origin) return
        const next = url.pathname + url.search
        const curr = window.location.pathname + window.location.search
        if (next !== curr) {
          clearTimeout(t1Ref.current); clearTimeout(t2Ref.current)
          clearTimeout(t3Ref.current); clearTimeout(doneRef.current)
          setProgress(0)
          setState("loading")
          // Slowly fill to 80% — will complete when pathname changes
          t1Ref.current = setTimeout(() => setProgress(25), 80)
          t2Ref.current = setTimeout(() => setProgress(55), 400)
          t3Ref.current = setTimeout(() => setProgress(78), 1200)
        }
      } catch {}
    }
    document.addEventListener("click", handleClick, true)
    return () => document.removeEventListener("click", handleClick, true)
  }, [])

  // Detect navigation complete → fill to 100% and fade out
  useEffect(() => {
    const key = pathname + searchParams.toString()
    if (key !== prevKeyRef.current) {
      prevKeyRef.current = key
      clearTimeout(t1Ref.current); clearTimeout(t2Ref.current)
      clearTimeout(t3Ref.current)
      setProgress(100)
      setState("complete")
      doneRef.current = setTimeout(() => {
        setState("idle")
        setProgress(0)
      }, 500)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  if (state === "idle") return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[300] h-0.5 pointer-events-none overflow-hidden">
      <div
        className={cn(
          "h-full bg-blue-500",
          state === "complete" ? "transition-[width,opacity] duration-300 ease-out" : "transition-[width] ease-out",
          state === "complete" && progress === 100 ? "opacity-0 delay-200" : "opacity-100",
        )}
        style={{
          width: `${progress}%`,
          transitionDuration: state === "loading" ? "600ms" : "250ms",
        }}
      />
    </div>
  )
}

export function TopLoader() {
  return (
    <Suspense>
      <TopLoaderBar />
    </Suspense>
  )
}
