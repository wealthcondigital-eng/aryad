"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { AlertTriangle, Info } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/**
 * The app's own confirm/alert, replacing the browser's.
 *
 * `window.confirm` and `window.alert` are the one part of the UI the clinic
 * cannot be styled: Chrome draws them at the top of the screen in the OS font,
 * says "localhost:3000 says", and blocks the whole tab. They also can't say
 * "Delete report" on the dangerous button, which is exactly where a
 * confirmation earns its keep.
 *
 * The API is promise-based so call sites read the same as before:
 *
 *   if (!(await confirm({ message: "Remove this row?" }))) return
 *   await notify({ title: "Save failed", message: "..." })
 */

export interface ConfirmOptions {
  title?: string
  message: string
  /** Text on the affirmative button. Defaults to "OK". */
  confirmLabel?: string
  cancelLabel?: string
  /** Red affirmative button, for anything that destroys or overwrites. */
  danger?: boolean
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>
type Tell = (opts: Omit<ConfirmOptions, "danger" | "cancelLabel">) => Promise<void>

const ConfirmContext = createContext<{ confirm: Ask; notify: Tell }>({
  confirm: async () => true,
  notify: async () => { },
})

export function useConfirm() {
  return useContext(ConfirmContext)
}

/**
 * The same dialog for code that isn't a React component.
 *
 * The print helpers build their HTML and open the window from plain functions
 * (`printReceipt`, `printReport`) — no hooks available — and they still need to
 * say "the pop-up was blocked". The provider registers itself here on mount; if
 * somehow none is mounted the browser's own alert is used rather than the
 * message being swallowed.
 */
let bridge: { notify: Tell } | null = null

export function showAlert(opts: Omit<ConfirmOptions, "danger" | "cancelLabel">) {
  if (bridge) void bridge.notify(opts)
  else if (typeof window !== "undefined") window.alert(opts.message)
}

type Pending = ConfirmOptions & { kind: "confirm" | "notify" }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  // Resolved when the dialog closes; kept in a ref so re-renders never drop the
  // caller waiting on it.
  const resolveRef = useRef<(ok: boolean) => void>(() => { })

  const open = useCallback((opts: Pending) => {
    setPending(opts)
    return new Promise<boolean>((resolve) => { resolveRef.current = resolve })
  }, [])

  const confirm = useCallback<Ask>((opts) => open({ ...opts, kind: "confirm" }), [open])
  const notify = useCallback<Tell>(async (opts) => { await open({ ...opts, kind: "notify" }) }, [open])

  // Keep the non-React bridge pointed at this provider for as long as it lives.
  useEffect(() => {
    bridge = { notify }
    return () => { bridge = null }
  }, [notify])

  const close = (ok: boolean) => {
    setPending(null)
    resolveRef.current(ok)
  }

  const danger = pending?.danger
  const isConfirm = pending?.kind === "confirm"

  return (
    <ConfirmContext.Provider value={{ confirm, notify }}>
      {children}

      <Dialog
        open={!!pending}
        // Esc or a click outside is a cancel — the same as the browser's dialog.
        onOpenChange={(next) => { if (!next && pending) close(false) }}
      >
        <DialogContent className="max-w-md gap-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${danger ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                }`}>
                {danger ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
              </span>
              {pending?.title ?? (isConfirm ? "Are you sure?" : "Notice")}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line pt-1 text-sm text-gray-600">
              {pending?.message}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-2">
            {isConfirm && (
              <Button variant="outline" onClick={() => close(false)}>
                {pending?.cancelLabel ?? "Cancel"}
              </Button>
            )}
            <Button
              autoFocus
              onClick={() => close(true)}
              className={danger ? "bg-red-600 hover:bg-red-700" : undefined}
            >
              {pending?.confirmLabel ?? "OK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}
