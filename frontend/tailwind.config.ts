import type { Config } from "tailwindcss";

/**
 * BackNine design tokens.
 *
 * Two greens. That's it. Stop reaching for arbitrary hex codes.
 *
 *   brand-*   — the signature dark BackNine green (#1B3829 family). Used for
 *               cards, branded surfaces, primary action buttons in interior
 *               surfaces (chat, groups, challenges).
 *
 *   accent-*  — emerald-* mirror. Punchier action color for high-frequency
 *               "log this" CTAs that need to pop against the dark brand
 *               (save meal, save workout, finish workout, save weigh-in).
 *               Hover always goes DARKER (accent-600 → accent-700), never
 *               lighter. Mixing directions was the most-visible inconsistency
 *               across the app.
 *
 * Radii: keep Tailwind's defaults. Convention:
 *   rounded         — tiny pills / counter badges
 *   rounded-md      — text inputs
 *   rounded-lg      — small buttons (size=md)
 *   rounded-xl      — primary buttons (size=lg), inline cards
 *   rounded-2xl     — hero cards (briefing, today's move, leaderboard wrap)
 *
 * Prefer the <Button> primitive in src/components/ui/Button.tsx over rolling
 * one-off button classNames. If you need a button shape this primitive doesn't
 * support, add a variant there rather than free-handing classes.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Signature dark BackNine green. 800 is the canonical #1B3829.
        // 600 is the canonical #2D6A4F hover lighter. Earlier shades are
        // interpolated; later shades are slightly darker. Mostly you only
        // need 50, 100, 600, 800.
        brand: {
          50:  "#f0f5f3",
          100: "#dbe7e1",
          200: "#b6cfc2",
          300: "#8db09b",
          400: "#5d8674",
          500: "#3b6450",
          600: "#2D6A4F", // hover-lighter for brand-800
          700: "#23553F",
          800: "#1B3829", // SIGNATURE — dark green that says "BackNine"
          900: "#0F2118",
        },
        // Action emerald — Tailwind's emerald palette as named tokens so
        // a sweep doesn't have to chase "did this use green or emerald".
        accent: {
          50:  "#ecfdf5",
          100: "#d1fae5",
          500: "#10b981",
          600: "#059669", // primary CTA (save meal, save workout, etc.)
          700: "#047857", // hover-darker (always darker, never lighter)
        },
        // Keep the old "brand" green-22c55e palette aliased under a new name
        // for the few places that lean on the brighter emerald-22c55e and
        // need to keep that exact tone. Phased out as components move to
        // brand-* or accent-* — do not add new uses.
        legacy: {
          50:  "#f0fdf4",
          100: "#dcfce7",
          500: "#22c55e",
          600: "#16a34a",
          900: "#052e16",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
