"use client";

/**
 * CoachAlAvatar — SVG caricature of Coach Al.
 * A friendly, confident coach character: strong jaw, kind eyes,
 * slight smile, sporty headband, and a subtle BackNine green palette.
 */

interface Props {
  size?: number;
  className?: string;
}

export default function CoachAlAvatar({ size = 48, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* ── Background circle ── */}
      <circle cx="50" cy="50" r="50" fill="url(#alBg)" />
      <defs>
        <radialGradient id="alBg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#2D6A4F" />
          <stop offset="100%" stopColor="#1B3829" />
        </radialGradient>
      </defs>

      {/* ── Neck + shoulders (jersey) ── */}
      <path d="M30 100 Q32 78 50 74 Q68 78 70 100Z" fill="#1B3829" />
      {/* Jersey collar V-neck */}
      <path d="M42 74 L50 85 L58 74" stroke="#2D6A4F" strokeWidth="2" fill="none" />
      {/* Shoulder blocks */}
      <rect x="22" y="82" width="18" height="18" rx="3" fill="#2D6A4F" />
      <rect x="60" y="82" width="18" height="18" rx="3" fill="#2D6A4F" />

      {/* ── Head ── */}
      {/* Skin base */}
      <ellipse cx="50" cy="52" rx="22" ry="26" fill="#D4956A" />
      {/* Jaw / chin line slightly square */}
      <path d="M30 58 Q30 76 50 78 Q70 76 70 58" fill="#D4956A" />

      {/* ── Ears ── */}
      <ellipse cx="28" cy="54" rx="4" ry="5" fill="#C4845A" />
      <ellipse cx="72" cy="54" rx="4" ry="5" fill="#C4845A" />

      {/* ── Headband ── */}
      <path d="M28 38 Q50 28 72 38 L70 44 Q50 34 30 44Z" fill="#22c55e" />
      {/* Headband stripe detail */}
      <path d="M30 41 Q50 31 70 41" stroke="#16a34a" strokeWidth="1.5" fill="none" />

      {/* ── Hair (short, above headband) ── */}
      <path d="M30 40 Q32 28 50 24 Q68 28 70 40 Q60 32 50 30 Q40 32 30 40Z" fill="#2C1810" />

      {/* ── Eyes ── */}
      {/* Eye whites */}
      <ellipse cx="41" cy="52" rx="7" ry="5.5" fill="white" />
      <ellipse cx="59" cy="52" rx="7" ry="5.5" fill="white" />
      {/* Irises — warm brown with green ring */}
      <circle cx="41" cy="52" r="3.5" fill="#4A7C59" />
      <circle cx="59" cy="52" r="3.5" fill="#4A7C59" />
      {/* Pupils */}
      <circle cx="41" cy="52" r="2" fill="#1a1a1a" />
      <circle cx="59" cy="52" r="2" fill="#1a1a1a" />
      {/* Eye shine */}
      <circle cx="42" cy="51" r="0.8" fill="white" />
      <circle cx="60" cy="51" r="0.8" fill="white" />
      {/* Eyebrows — confident, slight arch */}
      <path d="M34 46 Q41 43 48 45" stroke="#2C1810" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M52 45 Q59 43 66 46" stroke="#2C1810" strokeWidth="2.5" strokeLinecap="round" fill="none" />

      {/* ── Nose ── */}
      <path d="M48 55 Q46 61 50 63 Q54 61 52 55" stroke="#B5754A" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* ── Mouth — confident smile ── */}
      <path d="M43 68 Q50 74 57 68" stroke="#8B4513" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Cheek colour */}
      <ellipse cx="36" cy="64" rx="5" ry="3.5" fill="#E8957A" opacity="0.45" />
      <ellipse cx="64" cy="64" rx="5" ry="3.5" fill="#E8957A" opacity="0.45" />

      {/* ── Whistle on lanyard (coach touch) ── */}
      <circle cx="50" cy="90" r="4" fill="#f59e0b" />
      <rect x="49" y="86" width="2" height="4" rx="1" fill="#d97706" />
      <path d="M48 90 Q50 92 52 90" stroke="#d97706" strokeWidth="1" fill="none" />
    </svg>
  );
}
