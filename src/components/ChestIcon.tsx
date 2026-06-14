// Minimalist treasure-chest mark for TroveKeeper. Line-drawn, inherits the
// surrounding text color via currentColor so it tints with the accent.
export default function ChestIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* domed lid */}
      <path d="M3.5 10.5a8.5 8.5 0 0 1 17 0" />
      {/* chest body */}
      <path d="M3.5 10.5v8a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-8" />
      {/* band where lid meets body */}
      <path d="M3.5 13.5h17" />
      {/* lock plate + keyhole */}
      <rect x="10.4" y="12" width="3.2" height="3.6" rx="0.6" />
      <path d="M12 13.4v0.9" />
    </svg>
  )
}
