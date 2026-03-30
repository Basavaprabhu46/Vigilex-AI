/**
 * analyzer.js
 * Policy Analyzer panel.
 *
 * FIXES vs previous version:
 * ─────────────────────────────────────────────────────────────────────
 * 1. No more hardcoded FLASK_BASE — imported from api.js (single source)
 * 2. File upload uses uploadPolicy() from api.js — no duplicate fetch logic
 * 3. analyzePolicy() uses analyzeWithRAG() from api.js — no duplicate fetch
 * 4. Chunk count display corrected: brain.py chunks at 1800 chars, not 800
 * 5. Inline fetch calls removed — all HTTP goes through api.js functions
 * ─────────────────────────────────────────────────────────────────────
 */

import { analyzeWithRAG, uploadPolicy } from "./api.js";

// Stores full clean policy text (set by file upload or detected from textarea)
let cleanPolicyText = "";

// Chunk size must match brain.py chunk_policy() chunk_size parameter
const CHUNK_SIZE = 1800;

const HTML = /* html */ `
  <div class="section-header">
    <div>
      <div class="section-title">Policy Analyzer</div>
      <div class="section-sub">Upload or paste a privacy policy for AI-powered compliance analysis</div>
    </div>
  </div>

  <div class="analyzer-layout">
    <!-- Left: input -->
    <div>
      <div class="upload-zone" id="uploadZone">
        <div class="upload-icon">📄</div>
        <h3>Drop your Privacy Policy here</h3>
        <p>Supports .txt and .pdf files</p>
        <button class="btn-outline" style="pointer-events:none">Browse Files</button>
        <input type="file" id="fileInput" accept=".txt,.pdf" />
        <div class="file-info" id="fileInfo">
          <span>📎</span>
          <strong id="fileName">—</strong>
          <span id="fileSize"></span>
        </div>
        <div class="upload-progress" id="uploadProgress" style="display:none">
          <div class="spinner-small"></div>
          <span id="uploadProgressText">Extracting text from PDF...</span>
        </div>
      </div>

      <div class="or-divider">or paste directly</div>

      <div class="text-area-wrap">
        <label>Paste policy text</label>
        <textarea
          class="policy-textarea"
          id="policyText"
          placeholder="Paste your privacy policy or terms of service text here...&#10;&#10;Tip: paste the full policy — no need to trim it. The AI handles chunking."
        ></textarea>
        <div class="char-counter" id="charCounter" style="font-size:.72rem;color:var(--text2);margin-top:4px;"></div>
      </div>

      <button class="analyze-btn" id="analyzeBtn">🔍 Analyze with Vigilex</button>
      <div class="disclaimer">⚠️ For assessment purposes only. Review with a legal expert before relying on results.</div>
    </div>

    <!-- Right: report -->
    <div class="report-card" id="reportCard">
      <div style="font-family:'Fira Code',sans-serif;font-weight:700;font-size:1rem;margin-bottom:4px;">Analysis Report</div>
      <div style="font-size:.78rem;color:var(--text2);margin-bottom:16px;">AI-generated compliance findings · RAG-backed</div>

      <div class="report-placeholder" id="reportPlaceholder">
        <div class="ph-icon">🔍</div>
        <p>Upload or paste a privacy policy<br>to see your analysis here</p>
      </div>

      <div class="report-content" id="reportContent"></div>
    </div>
  </div>
`;

export function initAnalyzer(container) {
  container.innerHTML = HTML;
  bindEvents();
}

function bindEvents() {
  const zone = document.getElementById("uploadZone");

  zone.addEventListener("click", (e) => {
    if (!e.target.closest("#uploadProgress")) {
      document.getElementById("fileInput").click();
    }
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  document.getElementById("fileInput").addEventListener("change", (e) => {
    if (e.target.files[0]) processFile(e.target.files[0]);
  });

  document.getElementById("policyText").addEventListener("input", (e) => {
    const len = e.target.value.length;
    const counter = document.getElementById("charCounter");
    if (len > 0) {
      counter.textContent = `${len.toLocaleString()} chars · ~${Math.ceil(len / 5)} words`;
      counter.style.color = "var(--text2)";
    } else {
      counter.textContent = "";
    }
    // When user types/pastes manually, clear the uploaded file text
    // so analyzePolicy() uses the textarea content instead
    cleanPolicyText = "";
  });

  document
    .getElementById("analyzeBtn")
    .addEventListener("click", analyzePolicy);
}

/**
 * processFile — sends file to backend via uploadPolicy() from api.js.
 * Backend uses PyPDFLoader for PDFs — correct extraction, no binary garbage.
 */
async function processFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  document.getElementById("fileInfo").classList.add("show");
  document.getElementById("fileName").textContent = file.name;
  document.getElementById("fileSize").textContent =
    (file.size / 1024).toFixed(1) + " KB";

  const progressEl = document.getElementById("uploadProgress");
  const progressText = document.getElementById("uploadProgressText");
  progressEl.style.display = "flex";
  progressText.textContent =
    ext === "pdf" ? "Extracting text from PDF..." : "Reading file...";

  try {
    // All HTTP goes through api.js — no fetch() calls here
    const data = await uploadPolicy(file);
    cleanPolicyText = data.text;

    // Show preview in textarea (first 2000 chars — full text stored in cleanPolicyText)
    document.getElementById("policyText").value =
      cleanPolicyText.substring(0, 2000) +
      (cleanPolicyText.length > 2000
        ? "\n\n[... preview truncated — full text will be analyzed ...]"
        : "");

    const counter = document.getElementById("charCounter");
    counter.textContent =
      `${data.char_count.toLocaleString()} chars extracted` +
      (data.pages ? ` from ${data.pages} pages` : "") +
      " · ready for analysis";
    counter.style.color = "var(--green)";

    progressText.textContent = `✅ Extracted ${data.char_count.toLocaleString()} chars`;
    setTimeout(() => {
      progressEl.style.display = "none";
    }, 2000);
  } catch (err) {
    progressText.textContent = `❌ ${err.message}`;
    setTimeout(() => {
      progressEl.style.display = "none";
    }, 4000);

    // Fallback: if server is down and it's a .txt, read it client-side
    if (ext === "txt") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        cleanPolicyText = ev.target.result;
        document.getElementById("policyText").value = cleanPolicyText.substring(
          0,
          2000,
        );
        const counter = document.getElementById("charCounter");
        counter.textContent = `${cleanPolicyText.length.toLocaleString()} chars (client-side fallback)`;
        counter.style.color = "var(--yellow)";
      };
      reader.readAsText(file);
    }
  }
}

/**
 * analyzePolicy — sends clean policy text to brain.py's map-reduce pipeline.
 * Uses analyzeWithRAG() from api.js — no fetch() calls here.
 */
async function analyzePolicy() {
  const pasteText = document.getElementById("policyText").value.trim();
  const textToAnalyze = cleanPolicyText || pasteText;

  if (!textToAnalyze) {
    alert("Please upload a file or paste policy text first.");
    return;
  }

  // Reset report area
  document.getElementById("reportPlaceholder").style.display = "none";
  const reportContent = document.getElementById("reportContent");
  reportContent.classList.remove("show");
  reportContent.innerHTML = "";

  const btn = document.getElementById("analyzeBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Analyzing...";

  // Loading overlay — chunk count uses CHUNK_SIZE to match brain.py
  const card = document.getElementById("reportCard");
  const loader = document.createElement("div");
  loader.className = "loading-overlay";
  loader.id = "analysisLoader";
  loader.innerHTML = `
    <div class="spinner"></div>
    <div class="loading-text" id="loaderText">Chunking policy text...</div>
    <div style="font-size:.72rem;color:var(--text2);margin-top:6px;" id="loaderSub">
      ~${Math.ceil(textToAnalyze.length / CHUNK_SIZE)} chunks · semantic search in progress
    </div>
  `;
  card.appendChild(loader);

  // Cycle through informative loading steps
  const steps = [
    "Chunking policy text...",
    "Searching legal database...",
    "Matching clauses to DPDP / GDPR...",
    "Deduplicating law references...",
    "Generating compliance report...",
  ];
  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    stepIdx = (stepIdx + 1) % steps.length;
    const el = document.getElementById("loaderText");
    if (el) el.textContent = steps[stepIdx];
  }, 2500);

  try {
    // All HTTP goes through api.js
    const { answer: reply, sources } = await analyzeWithRAG(textToAnalyze);

    const clean = reply.replace(/```json|```/g, "").trim();
    const data = JSON.parse(clean);
    renderReport(data, sources, textToAnalyze.length);
  } catch (e) {
    reportContent.innerHTML = `
      <p style="color:var(--red)">
        <strong>Analysis failed:</strong> ${e.message}
      </p>
      <p style="font-size:.8rem;color:var(--text2)">
        Make sure the Flask server is running: <code>python server.py</code>
      </p>
    `;
    reportContent.classList.add("show");
    document.getElementById("reportPlaceholder").style.display = "none";
  }

  clearInterval(stepInterval);
  document.getElementById("analysisLoader")?.remove();
  btn.disabled = false;
  btn.textContent = "🔍 Analyze with Vigilex";
}

/**
 * renderReport — renders the structured JSON report from brain.py.
 */
function renderReport(data, sources = [], policyCharCount = 0) {
  const placeholder = document.getElementById("reportPlaceholder");
  const content = document.getElementById("reportContent");
  placeholder.style.display = "none";

  const scoreColor =
    data.score >= 75
      ? "var(--green)"
      : data.score >= 50
        ? "var(--yellow)"
        : data.score >= 30
          ? "var(--warn)"
          : "var(--red)";

  const badgeBg =
    data.score >= 75
      ? "rgba(0,214,143,.15)"
      : data.score >= 50
        ? "rgba(255,209,102,.15)"
        : "rgba(255,77,109,.15)";

  const sourcesHTML = sources.length
    ? `<div class="report-section">
        <h4>📚 Sources from ChromaDB</h4>
        <div class="sources-pills">
          ${sources
            .map((s) => {
              const name = s
                .split("/")
                .pop()
                .split("\\")
                .pop()
                .replace(/\.(pdf|txt|docx)$/i, "");
              return `<span class="source-pill">📄 ${name}</span>`;
            })
            .join("")}
        </div>
      </div>`
    : "";

  const statsHTML = policyCharCount
    ? `<div style="font-size:.72rem;color:var(--text2);margin-bottom:12px;">
        Analyzed ${policyCharCount.toLocaleString()} chars ·
        ~${Math.ceil(policyCharCount / CHUNK_SIZE)} chunks searched against DPDP/GDPR database
       </div>`
    : "";

  content.innerHTML = `
    <div class="report-score-header">
      <div>
        <div class="report-score-big" style="color:${scoreColor}">${data.score}<sub>/100</sub></div>
        <div style="font-size:.75rem;color:var(--text2);margin-top:4px;">${data.summary || ""}</div>
      </div>
      <div class="report-grade-badge" style="background:${badgeBg};color:${scoreColor};border:1px solid ${scoreColor}40">
        ${data.grade}
      </div>
    </div>

    ${statsHTML}

    ${
      data.strengths?.length
        ? `
      <div class="report-section">
        <h4>✅ What's Working</h4>
        ${data.strengths
          .map(
            (s) => `
          <div class="finding-item">
            <span class="finding-icon">✓</span>
            <span style="color:var(--text)">${s}</span>
          </div>`,
          )
          .join("")}
      </div>`
        : ""
    }

    ${
      data.gaps?.length
        ? `
      <div class="report-section">
        <h4>⚠️ Compliance Gaps</h4>
        ${data.gaps
          .map((g) => {
            const col =
              g.severity === "High"
                ? "var(--red)"
                : g.severity === "Medium"
                  ? "var(--yellow)"
                  : "var(--green)";
            return `
          <div class="finding-item" style="flex-direction:column;align-items:flex-start;">
            <div style="display:flex;gap:8px;align-items:center;width:100%;flex-wrap:wrap;">
              <span class="finding-icon">⚠️</span>
              <strong style="color:${col};font-size:.8rem;">[${g.severity}]</strong>
              <span style="font-size:.82rem;">${g.issue}</span>
              ${g.section ? `<span class="ref-tag">${g.section}</span>` : ""}
              ${g.act ? `<span class="act-tag act-${g.act.toLowerCase()}">${g.act}</span>` : ""}
            </div>
            ${g.suggestion ? `<div style="font-size:.76rem;color:var(--text2);padding-left:28px;margin-top:4px;">💡 ${g.suggestion}</div>` : ""}
          </div>`;
          })
          .join("")}
      </div>`
        : ""
    }

    ${
      data.missing_elements?.length
        ? `
      <div class="report-section">
        <h4>❌ Missing Elements</h4>
        ${data.missing_elements
          .map((m) => {
            const label = typeof m === "string" ? m : m.element;
            const section = typeof m === "object" ? m.section : null;
            const act = typeof m === "object" ? m.act : null;
            return `
          <div class="finding-item">
            <span class="finding-icon">✗</span>
            <span style="color:var(--text2);flex:1;">${label}</span>
            ${section ? `<span class="ref-tag">${section}</span>` : ""}
            ${act ? `<span class="act-tag act-${act.toLowerCase()}">${act}</span>` : ""}
          </div>`;
          })
          .join("")}
      </div>`
        : ""
    }

    ${sourcesHTML}
  `;

  content.classList.add("show");

  // Inject download button below the report
  const dlBtn = document.createElement("button");
  dlBtn.className = "analyze-btn";
  dlBtn.textContent = "⬇️ Download Report";
  dlBtn.style.cssText =
    "margin-top:20px;background:var(--surface2);color:var(--text);border:1px solid var(--border2);";
  dlBtn.addEventListener("click", () => downloadReport(data, sources));
  content.appendChild(dlBtn);
}

/**
 * downloadReport — converts the JSON report data into a plain-text file and
 * triggers a browser download. No extra libraries needed.
 */
function downloadReport(data, sources = []) {
  const date = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const divider = "─".repeat(60);

  const lines = [
    "vigilex AI — COMPLIANCE ANALYSIS REPORT",
    `Generated: ${date}`,
    divider,
    "",
    `OVERALL SCORE : ${data.score} / 100`,
    `GRADE         : ${data.grade}`,
    "",
    "SUMMARY",
    data.summary || "—",
    "",
    divider,
  ];

  if (data.strengths?.length) {
    lines.push("", "✅  WHAT'S WORKING", "");
    data.strengths.forEach((s) => lines.push(`  ✓  ${s}`));
  }

  if (data.gaps?.length) {
    lines.push("", divider, "", "⚠️   COMPLIANCE GAPS", "");
    data.gaps.forEach((g) => {
      lines.push(`  [${g.severity.toUpperCase()}]  ${g.issue}`);
      if (g.section) lines.push(`         Ref : ${g.section}  (${g.act})`);
      if (g.suggestion) lines.push(`         Fix : ${g.suggestion}`);
      lines.push("");
    });
  }

  if (data.missing_elements?.length) {
    lines.push(divider, "", "❌  MISSING ELEMENTS", "");
    data.missing_elements.forEach((m) => {
      const label = typeof m === "string" ? m : m.element;
      const section = typeof m === "object" ? m.section : null;
      const act = typeof m === "object" ? m.act : null;
      lines.push(`  ✗  ${label}`);
      if (section)
        lines.push(`       Ref : ${section}${act ? `  (${act})` : ""}`);
      lines.push("");
    });
  }

  if (sources.length) {
    lines.push(divider, "", "📚  SOURCES (ChromaDB)", "");
    sources.forEach((s) => {
      const name = s.split("/").pop().split("\\").pop();
      lines.push(`  • ${name}`);
    });
  }

  lines.push("", divider);
  lines.push("Disclaimer: This report is AI-generated guidance only.");
  lines.push(
    "Consult a qualified DPO or legal counsel before acting on these findings.",
  );

  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vigilex-report-${date.replace(/\s/g, "-")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
