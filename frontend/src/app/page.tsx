import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-8">
        <h1 className="text-5xl font-bold tracking-tight text-white mb-3">
          Back<span className="text-green-400">Nine</span>
        </h1>
        <p className="text-zinc-400 text-lg max-w-md mx-auto">
          Your personal health intelligence platform. Connect your wearable and get
          actionable coaching from your daily metrics.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <a
          href="http://localhost:8000/auth/oura"
          className="inline-flex items-center gap-2 rounded-lg bg-green-500 hover:bg-green-400 text-black font-semibold px-6 py-3 transition-colors"
        >
          <span>Connect Oura Ring</span>
          <span aria-hidden>→</span>
        </a>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-300 font-semibold px-6 py-3 transition-colors"
        >
          View Dashboard
        </Link>
      </div>

      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl w-full text-left">
        {[
          { icon: "🏃", title: "Training Intelligence", desc: "Daily HRV-guided training zones — know when to push and when to rest." },
          { icon: "😴", title: "Sleep Coaching",        desc: "Deep sleep, REM, efficiency, debt — turn your sleep data into better nights." },
          { icon: "📈", title: "30-Day Trends",         desc: "Spot patterns in readiness, HRV, and activity before they become problems." },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="text-2xl mb-3">{icon}</div>
            <h3 className="font-semibold text-white mb-1">{title}</h3>
            <p className="text-zinc-400 text-sm">{desc}</p>
          </div>
        ))}
      </div>

      <p className="mt-12 text-zinc-600 text-xs">
        More wearables coming soon: Apple Health · Garmin · WHOOP · Fitbit
      </p>
    </main>
  );
}
