/** Skip-to-content link: the first focusable element on every page. */
export function SkipLink({ target = '#main' }: { target?: string }) {
  return (
    <a
      href={target}
      onClick={(e) => {
        const el = document.querySelector<HTMLElement>(target)
        if (!el) return
        e.preventDefault()
        el.focus({ preventScroll: false })
      }}
      className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-lift transition-transform duration-fast focus-visible:translate-y-0"
    >
      Skip to content
    </a>
  )
}
