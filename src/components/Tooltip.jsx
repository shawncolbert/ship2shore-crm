// Wraps any icon-only control (a button with no visible text) and shows a
// small floating label on hover or keyboard focus -- faster and more
// consistently visible than the browser's native title="" tooltip, which is
// slow to appear, tiny, and doesn't show at all on touch devices.
//
// Uses a NAMED Tailwind group (group/tooltip) so it never conflicts with a
// parent's own `.group` (e.g. Pipeline's JobCard already uses an unnamed
// group to fade its icon row in on card-hover -- this tooltip layers on top
// of that instead of fighting it).
const SIDE_CLASSES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
}

export default function Tooltip({ label, side = 'top', block = false, children }) {
  if (!label) return children

  return (
    <span className={`group/tooltip relative ${block ? 'block w-full' : 'inline-flex'}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 delay-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${SIDE_CLASSES[side] || SIDE_CLASSES.top}`}
      >
        {label}
      </span>
    </span>
  )
}
