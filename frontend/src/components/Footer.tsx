import Link from "next/link";

// Footer for the app's light (cream) backgrounds, e.g. the dashboard.
export default function Footer() {
  return (
    <footer className="mt-8 pt-6 pb-10 px-4 border-t border-gray-200">
      <div className="max-w-2xl mx-auto text-center space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
          <Link href="/terms" className="text-gray-500 hover:text-gray-800 transition-colors">Terms of Use</Link>
          <span className="text-gray-300">·</span>
          <Link href="/privacy" className="text-gray-500 hover:text-gray-800 transition-colors">Privacy Policy</Link>
          <span className="text-gray-300">·</span>
          <Link href="/disclaimer" className="text-gray-500 hover:text-gray-800 transition-colors">Health Disclaimer</Link>
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed max-w-md mx-auto">
          BackNine is for informational and entertainment purposes only and is not medical advice.
          Consult a healthcare professional before changing your exercise or diet.
        </p>
        <p className="text-[11px] text-gray-400">© {new Date().getFullYear()} BackNine</p>
      </div>
    </footer>
  );
}
