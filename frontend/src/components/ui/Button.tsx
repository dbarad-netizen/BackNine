"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

/**
 * BackNine button primitive.
 *
 * Use this for every clickable rectangle in the app. If a variant doesn't
 * exist for what you need, add it here rather than free-handing a
 * `bg-green-600 hover:bg-green-500 …` string somewhere — that was the
 * source of the "every button looks slightly different" problem.
 *
 * Variants:
 *   primary   — dark BackNine brand green. Default for interior surfaces.
 *   accent    — punchy emerald. Use for the highest-frequency "log this"
 *               CTAs (save meal, save workout, save weigh-in, finish).
 *   secondary — outlined white-on-gray. Cancel / dismiss / inline.
 *   ghost     — text-only, hover-tinted. Toolbar icons, refresh, etc.
 *   danger    — red. Destructive only.
 *
 * Sizes:
 *   sm — h-7  (pills, chip actions)
 *   md — h-9  (default, most form buttons)
 *   lg — h-11 (hero CTAs at the bottom of forms)
 *
 * Hover always goes DARKER. If a future variant breaks that rule, it should
 * have a strong design reason.
 */

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:   "bg-brand-800 hover:bg-brand-600 text-white",
  accent:    "bg-accent-600 hover:bg-accent-700 text-white",
  secondary: "border border-gray-200 bg-white hover:bg-gray-50 text-gray-900",
  ghost:     "text-gray-700 hover:bg-gray-100",
  danger:    "bg-red-600 hover:bg-red-700 text-white",
};

const SIZE: Record<Size, string> = {
  sm: "h-7  px-2.5 text-xs  rounded-md  font-medium",
  md: "h-9  px-3   text-sm  rounded-lg  font-medium",
  lg: "h-11 px-4   text-sm  rounded-xl  font-semibold",
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 " +
  "transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600/40";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", fullWidth, className = "", type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={[
        BASE,
        VARIANT[variant],
        SIZE[size],
        fullWidth ? "w-full" : "",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    />
  ),
);

Button.displayName = "Button";

export default Button;
