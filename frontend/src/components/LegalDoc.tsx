import Link from "next/link";

// Minimal, dependency-free markdown renderer for our own static legal copy.
// Supports: #/##/### headings, paragraphs, "- " bullet lists, "> " blockquotes,
// "---" rules, **bold**, *italic*, and [text](url) links. The input is trusted
// (authored by us in legalContent.ts), so dangerouslySetInnerHTML is safe here.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text: string): string {
  let t = escapeHtml(text);
  // links: [label](url)
  t = t.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-[#2D6A4F] underline hover:text-[#1B3829]">$1</a>'
  );
  // bold then italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}

function mdToHtml(md: string): string {
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) { html += "</ul>"; inList = false; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // Bullet list item (supports a leading indent for nested-looking sub-bullets)
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { html += '<ul class="list-disc pl-5 space-y-1 mb-4">'; inList = true; }
      html += `<li class="text-sm text-gray-600 leading-relaxed">${inline(line.replace(/^\s*-\s+/, ""))}</li>`;
      continue;
    }
    closeList();

    if (line.trim() === "") continue;

    if (line.startsWith("### ")) {
      html += `<h3 class="text-base font-semibold text-gray-800 mt-5 mb-1">${inline(line.slice(4))}</h3>`;
    } else if (line.startsWith("## ")) {
      html += `<h2 class="text-lg font-semibold text-gray-900 mt-8 mb-2">${inline(line.slice(3))}</h2>`;
    } else if (line.startsWith("# ")) {
      html += `<h1 class="text-2xl font-bold text-gray-900 mb-1">${inline(line.slice(2))}</h1>`;
    } else if (line.startsWith("> ")) {
      html += `<blockquote class="border-l-4 border-amber-300 bg-amber-50 text-gray-700 text-sm px-4 py-2 my-4 rounded-r">${inline(line.slice(2))}</blockquote>`;
    } else if (/^---+$/.test(line.trim())) {
      html += '<hr class="my-6 border-gray-200" />';
    } else {
      html += `<p class="text-sm text-gray-600 leading-relaxed mb-3">${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

export default function LegalDoc({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-[#0f1a15] py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            <span className="text-white">Back</span><span className="text-green-400">Nine</span>
          </Link>
          <Link href="/dashboard" className="text-xs text-zinc-400 hover:text-white transition-colors">
            ← Back to app
          </Link>
        </div>

        {/* Document card */}
        <article className="bg-white rounded-2xl p-6 sm:p-10 shadow-sm">
          <span className="sr-only">{title}</span>
          <div dangerouslySetInnerHTML={{ __html: mdToHtml(body) }} />
          <hr className="my-6 border-gray-200" />
          <p className="text-xs text-gray-600">
            BackNine is for informational and entertainment purposes only and is not medical advice.
            See our{" "}
            <Link href="/terms" className="text-[#2D6A4F] underline">Terms</Link>,{" "}
            <Link href="/privacy" className="text-[#2D6A4F] underline">Privacy Policy</Link>, and{" "}
            <Link href="/disclaimer" className="text-[#2D6A4F] underline">Health Disclaimer</Link>.
          </p>
        </article>
      </div>
    </main>
  );
}
