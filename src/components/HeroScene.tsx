// A self-contained SVG "fantasy realm" backdrop for the hero, evoking the
// reference art: blue sky, sun glow, layered mountains, a golden castle on a
// green hill, and a banner-bearing column riding out. Pure vector so it ships
// with no external image and scales to any hero size.
export default function HeroScene() {
  return (
    <svg
      className="hero-scene"
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f7fd1" />
          <stop offset="45%" stopColor="#7db9e8" />
          <stop offset="100%" stopColor="#cfe6f5" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="62%" cy="34%" r="34%">
          <stop offset="0%" stopColor="#fffefb" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fffefb" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fae4f" />
          <stop offset="100%" stopColor="#3f7e3a" />
        </linearGradient>
        <linearGradient id="castle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6e6a8" />
          <stop offset="100%" stopColor="#caa85a" />
        </linearGradient>
      </defs>

      {/* sky + sun */}
      <rect width="1000" height="600" fill="url(#sky)" />
      <circle cx="620" cy="200" r="240" fill="url(#sunGlow)" />

      {/* clouds */}
      <g fill="#ffffff" opacity="0.85">
        <ellipse cx="180" cy="90" rx="90" ry="26" />
        <ellipse cx="250" cy="105" rx="70" ry="20" />
        <ellipse cx="820" cy="70" rx="110" ry="28" />
        <ellipse cx="900" cy="95" rx="70" ry="20" />
      </g>

      {/* far mountains */}
      <path d="M0 300 L150 170 L280 290 L420 150 L560 300 L700 200 L860 300 L1000 230 L1000 360 L0 360 Z"
        fill="#8fb4d6" opacity="0.7" />
      {/* near mountains */}
      <path d="M0 360 L120 250 L260 360 L380 260 L520 370 L640 280 L820 380 L1000 300 L1000 420 L0 420 Z"
        fill="#5d83ad" opacity="0.85" />

      {/* castle on the hill */}
      <g transform="translate(720 150)">
        <g fill="url(#castle)" stroke="#8a6f33" strokeWidth="1.5">
          <rect x="40" y="120" width="120" height="90" />
          <rect x="20" y="80" width="26" height="130" />
          <rect x="150" y="70" width="26" height="140" />
          <rect x="85" y="40" width="30" height="170" />
          <polygon points="20,80 33,52 46,80" />
          <polygon points="150,70 163,40 176,70" />
          <polygon points="85,40 100,8 115,40" />
          <polygon points="40,120 100,90 160,120" />
        </g>
        <rect x="92" y="2" width="2" height="20" fill="#8a6f33" />
        <polygon points="94,4 118,9 94,16" fill="#2f6bd8" />
      </g>

      {/* green hill */}
      <path d="M0 420 Q300 360 560 410 Q780 450 1000 400 L1000 600 L0 600 Z" fill="url(#hill)" />
      <path d="M0 470 Q260 440 520 470 Q760 498 1000 460 L1000 600 L0 600 Z" fill="#356b32" opacity="0.7" />

      {/* river */}
      <path d="M540 600 Q570 500 640 470 Q700 446 760 430" stroke="#bfe0f2" strokeWidth="14"
        fill="none" opacity="0.8" strokeLinecap="round" />

      {/* banner column riding out */}
      <g stroke="#1f4f86" strokeWidth="3">
        <line x1="120" y1="560" x2="120" y2="430" />
        <line x1="180" y1="575" x2="180" y2="440" />
        <line x1="240" y1="585" x2="240" y2="450" />
        <line x1="300" y1="575" x2="300" y2="455" />
      </g>
      <g fill="#2f6bd8">
        <polygon points="120,430 158,440 120,456" />
        <polygon points="180,440 218,450 180,466" />
        <polygon points="240,450 278,460 240,476" />
        <polygon points="300,455 338,465 300,481" />
      </g>
      {/* riders (simple silhouettes) */}
      <g fill="#23364d" opacity="0.92">
        <ellipse cx="118" cy="556" rx="22" ry="9" />
        <ellipse cx="178" cy="568" rx="22" ry="9" />
        <ellipse cx="238" cy="580" rx="22" ry="9" />
        <rect x="112" y="528" width="9" height="26" rx="3" />
        <rect x="172" y="540" width="9" height="26" rx="3" />
        <rect x="232" y="552" width="9" height="26" rx="3" />
      </g>
    </svg>
  )
}
