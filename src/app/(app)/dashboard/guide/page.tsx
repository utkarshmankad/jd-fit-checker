'use client'

import { useState } from 'react'
import { Copy, Check, Terminal, MousePointer, ClipboardList, Zap } from 'lucide-react'

const SCRAPER_SCRIPT = `(function () {
  var P = [
    /\\/jobs\\/[^\\/\\s?#]+/i, /\\/job\\/[^\\/\\s?#]+/i,
    /\\/careers\\/[a-zA-Z0-9_-]+/i, /\\/career\\/[a-zA-Z0-9_-]+/i,
    /\\/openings\\/[^\\/\\s?#]+/i, /\\/positions\\/[^\\/\\s?#]+/i,
    /\\/apply\\/[^\\/\\s?#]+/i, /\\/posting\\/[^\\/\\s?#]+/i,
    /\\/opportunities\\/[^\\/\\s?#]+/i, /\\/role\\/[^\\/\\s?#]+/i,
    /greenhouse\\.io\\/.+\\/jobs\\/\\d+/i,
    /jobs\\.lever\\.co\\/.+\\/[a-f0-9]{8}-[a-f0-9]{4}/i,
    /myworkdayjobs\\.com/i, /icims\\.com\\/jobs\\/\\d+/i,
    /jobs\\.smartrecruiters\\.com/i,
    /jobs\\.ashbyhq\\.com\\/.+\\/[a-f0-9]{8}-[a-f0-9]{4}/i,
    /linkedin\\.com\\/jobs\\/view\\/\\d+/i, /indeed\\.com\\/viewjob/i,
    /ats\\.rippling\\.com/i, /bamboohr\\.com\\/careers\\/\\d+/i,
    /jobvite\\.com\\/[^\\/]+\\/job\\//i,
  ];
  function isJob(h) { return h && h[0] !== "#" && !/^mailto:/i.test(h) && P.some(function(p){return p.test(h);}); }
  function abs(h) { try { return new URL(h, location.href).href; } catch(e) { return h; } }
  var seen = {}, urls = [];
  document.querySelectorAll("a[href]").forEach(function(a) {
    var u = abs(a.getAttribute("href"));
    if (isJob(u) && !seen[u]) { seen[u] = 1; urls.push(u); }
  });
  if (!urls.length) { alert("No job links found. Scroll down to load more, then run again."); return; }
  var text = urls.join("\\n");
  function el(tag, css, txt) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function showPanel() {
    var old = document.getElementById("jdfit-panel");
    if (old) old.remove();
    var panel = el("div", "position:fixed;top:16px;right:16px;z-index:2147483647;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.18);padding:16px;width:400px;max-height:80vh;display:flex;flex-direction:column;font-family:-apple-system,sans-serif;");
    panel.id = "jdfit-panel";
    var hdr = el("div", "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;");
    var title = el("b", "color:#1B3A5C;font-size:14px;", "JD Fit Checker — " + urls.length + " job" + (urls.length !== 1 ? "s" : "") + " found");
    var xBtn = el("button", "border:none;background:none;cursor:pointer;font-size:20px;color:#94a3b8;line-height:1;", "\\u00d7");
    xBtn.addEventListener("click", function() { panel.remove(); });
    hdr.appendChild(title); hdr.appendChild(xBtn); panel.appendChild(hdr);
    var ta = el("textarea", "flex:1;min-height:160px;max-height:280px;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:11px;font-family:monospace;resize:vertical;outline:none;color:#334155;line-height:1.5;");
    ta.readOnly = true; ta.value = text; panel.appendChild(ta);
    var ftr = el("div", "display:flex;gap:8px;margin-top:10px;");
    var copyBtn = el("button", "flex:1;background:#1B3A5C;color:#fff;border:none;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;", "Copy all URLs");
    copyBtn.addEventListener("click", function() {
      navigator.clipboard.writeText(text).catch(function() { ta.select(); document.execCommand("copy"); });
      copyBtn.textContent = "Copied \\u2713"; copyBtn.style.background = "#16a34a";
      setTimeout(function() { copyBtn.textContent = "Copy all URLs"; copyBtn.style.background = "#1B3A5C"; }, 2000);
    });
    var closeBtn = el("button", "background:#f1f5f9;color:#475569;border:none;border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer;", "Close");
    closeBtn.addEventListener("click", function() { panel.remove(); });
    ftr.appendChild(copyBtn); ftr.appendChild(closeBtn); panel.appendChild(ftr);
    document.body.appendChild(panel);
  }
  navigator.clipboard.writeText(text).catch(function(){}).finally(showPanel);
})();`.trim()

const SITES = [
  'Greenhouse', 'Lever', 'Workday', 'iCIMS', 'SmartRecruiters',
  'Ashby', 'LinkedIn Jobs', 'Indeed', 'Rippling ATS', 'BambooHR',
  'Jobvite', 'Custom career pages',
]

function CopyButton({ text, label = 'Copy script' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        copied ? 'bg-green-600 text-white' : 'text-white'
      }`}
      style={copied ? {} : { backgroundColor: '#1B3A5C' }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

function Step({
  num,
  icon: Icon,
  title,
  children,
}: {
  num: number
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: '#1B3A5C' }}>
        {num}
      </div>
      <div className="flex-1 min-w-0 pb-6 border-b border-gray-100 last:border-0 last:pb-0">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={15} className="text-gray-400" />
          <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
        </div>
        <div className="text-sm text-gray-600 space-y-2">{children}</div>
      </div>
    </div>
  )
}

export default function GuidePage() {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">How to use</h1>
        <p className="text-sm text-gray-500 mt-1">Scrape job links from any career page and screen them in bulk.</p>
      </div>

      {/* Quick workflow */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="font-semibold text-gray-900">Workflow</h2>
        </div>
        <div className="px-5 space-y-5">
          <Step num={1} icon={MousePointer} title="Go to a company's jobs page">
            <p>Open the careers or jobs listing page of any company in your browser. Works on Greenhouse, Lever, Workday, Ashby, LinkedIn, Indeed, and most custom career sites.</p>
          </Step>

          <Step num={2} icon={Terminal} title="Run the scraper script in browser console">
            <p>Open DevTools (<kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">F12</kbd> or <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">Cmd+Option+J</kbd>), paste the script below into the Console tab, and press Enter.</p>
          </Step>
        </div>

        {/* Code block outside flex chain so it can fill full card width */}
        <div className="mx-5 mb-3 rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-mono text-gray-500">Scraper script — paste into browser console</span>
            <CopyButton text={SCRAPER_SCRIPT} />
          </div>
          <pre className="px-4 py-3 text-xs font-mono bg-gray-950 text-green-400 leading-relaxed overflow-x-auto max-h-48 w-full box-border">
            {SCRAPER_SCRIPT}
          </pre>
        </div>
        <p className="text-xs text-gray-400 px-5 pb-3">A panel will appear with all job URLs found. Scroll down to load more listings before running if the page uses infinite scroll.</p>

        <div className="px-5 space-y-5 pb-5">

          <Step num={3} icon={ClipboardList} title="Copy the URLs">
            <p>Click <strong>Copy all URLs</strong> in the panel that appears. The URLs are newline-separated — one job per line.</p>
          </Step>

          <Step num={4} icon={Zap} title="Paste and screen">
            <p>Go to <a href="/dashboard" className="text-blue-600 hover:underline font-medium">Screen JDs</a>, select the <strong>Paste URLs</strong> tab, paste the links, and click <strong>Screen all</strong>.</p>
          </Step>
        </div>
      </div>

      {/* Supported sites */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5">
        <h2 className="font-semibold text-gray-900 mb-3">Supported sites</h2>
        <div className="flex flex-wrap gap-2">
          {SITES.map((s) => (
            <span key={s} className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
              {s}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          If a site uses a URL pattern the script misses, scroll down more and retry — some ATSes load jobs lazily. Most custom career pages work as long as job links appear as <code className="font-mono">&lt;a href&gt;</code> tags.
        </p>
      </div>

      {/* Tips */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
        <h2 className="font-semibold text-amber-900 text-sm mb-2">Tips</h2>
        <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
          <li>Scroll to bottom before running on infinite-scroll pages (LinkedIn, Indeed)</li>
          <li>On Workday, navigate into a job category first — the root page may not list individual jobs</li>
          <li>If the panel shows 0 jobs, open the job listing page (not the company homepage)</li>
          <li>The script only reads the current page — run once per page/category</li>
        </ul>
      </div>
    </div>
  )
}
