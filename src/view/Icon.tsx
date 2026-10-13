const FRAME = 'M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z'

const PATHS = {
  'split-right': `${FRAME}M8 3v10`,
  'split-down': `${FRAME}M2.5 8h11`,
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  plus: 'M8 3.5v9M3.5 8h9',
  'chevron-right': 'M6.5 4l4 4-4 4',
  'chevron-left': 'M9.5 4l-4 4 4 4',
  sun: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M13.5 9.6A5.5 5.5 0 1 1 6.4 2.5a4.5 4.5 0 0 0 7.1 7.1z',
  graph: 'M3 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M6.5 11.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5.2 5.9l2.1 4.2M10.8 5.9l-2.1 4.2',
  file: 'M4.5 2.5h4.5l3 3v8h-7.5zM9 2.5v3h3',
}

export type IconName = keyof typeof PATHS

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
