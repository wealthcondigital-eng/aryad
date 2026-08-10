"use client"

/**
 * Word's Styles gallery: Normal, Heading 1–3, each drawn the way it will look.
 *
 * Report sections ("GENERAL SCAN:", "BIOMETRY") are hand-bolded and
 * hand-underlined today, which is why no two templates agree on what a section
 * heading looks like. A style makes it one decision instead of three keystrokes.
 */

export type ReportStyle = "normal" | "h1" | "h2" | "h3"

const STYLES: { id: ReportStyle; label: string; className: string }[] = [
  { id: "normal", label: "Normal", className: "text-[12px] text-gray-700" },
  { id: "h1", label: "Heading 1", className: "text-[15px] font-bold text-gray-900" },
  { id: "h2", label: "Heading 2", className: "text-[13px] font-bold text-gray-800 underline" },
  { id: "h3", label: "Heading 3", className: "text-[12px] font-semibold italic text-gray-700" },
]

export function StyleGallery({
  value,
  onPick,
}: {
  value: ReportStyle
  onPick: (style: ReportStyle) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          title={s.label}
          onMouseDown={(e) => { e.preventDefault(); onPick(s.id) }}
          className={`h-7 min-w-[62px] rounded border px-2 transition-colors ${value === s.id
              ? "border-blue-400 bg-blue-50"
              : "border-gray-200 bg-white hover:border-blue-300"
            }`}
        >
          <span className={s.className}>{s.label}</span>
        </button>
      ))}
    </div>
  )
}
