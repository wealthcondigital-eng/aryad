"use client"

/**
 * Word's ribbon, in the shape this editor needs: a row of tabs over one strip of
 * controls divided into labelled groups.
 *
 * Two tabs, deliberately. Word's five made the clinic hunt for things it uses
 * daily — so everything that was under Layout/Review/View now sits in a group on
 * Home (view, tracking, comments, versions) or Insert (header/footer, band size)
 * instead of behind a tab of its own.
 *
 * Presentational only — every control inside a group is the same button the flat
 * toolbar used, wired to the same handler. Splitting them across tabs is what
 * makes room for Tier 2/3's controls without the single row growing into a
 * horizontal scroll nobody can find anything in.
 */

export const RIBBON_TABS = ["Home", "Insert"] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

export function RibbonTabBar({
  tab,
  onTab,
  right,
}: {
  tab: RibbonTab
  onTab: (t: RibbonTab) => void
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-100 px-4 lg:px-6">
      {RIBBON_TABS.map((t) => (
        <button
          key={t}
          type="button"
          // preventDefault for the same reason every toolbar control does it:
          // switching tabs must not take the caret out of the report.
          onMouseDown={(e) => { e.preventDefault(); onTab(t) }}
          className={`relative px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t
              ? "text-blue-600"
              : "text-gray-600 hover:text-gray-900"
            }`}
        >
          {t}
          {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600" />}
        </button>
      ))}
      {right && <div className="ml-auto flex items-center gap-2 py-1">{right}</div>}
    </div>
  )
}

/** One labelled cluster of controls, with Word's thin divider between groups. */
export function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 border-r border-gray-100 px-2 last:border-r-0">
      <div className="flex items-center gap-0.5">{children}</div>
      <span className="text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
    </div>
  )
}

/** The strip the groups sit in. */
export function RibbonBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-0.5 overflow-x-auto px-3 py-1.5 lg:px-5">
      {children}
    </div>
  )
}
