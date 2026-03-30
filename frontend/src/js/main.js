/* ══════════════════════════════════════════
   Vigilex AI — main.js
   Entry point. Owns Chat + Compliance panels.
   Delegates Analyzer panel to analyzer.js.
══════════════════════════════════════════ */

import { initAnalyzer } from "./analyzer.js";
import {
  getPromptSettings,
  resetPromptSettings,
  savePromptSettings,
} from "./api.js";

/* ── Backend base (single source of truth imported via api.js in analyzer) ── */
const BASE_URL = "http://localhost:5001";
const CHAT_API = `${BASE_URL}/api/chat`;
const ANALYZE_API = `${BASE_URL}/api/analyze`;

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */
let msgCount = 0;
let chatStarted = false;
const AI_AVATAR_HTML =
  '<img src="orb-logo.svg" alt="Vigilex AI Logo" class="msg-avatar-logo" />';
let promptState = {};

const PROMPT_SECTIONS = [
  {
    key: "chat_system",
    title: "Chat Prompt",
    description: "System prompt used for the main Vigilex chatbot RAG flow.",
  },
  {
    key: "analyzer_chunk",
    title: "Analyzer Chunk Prompt",
    description:
      "Per-chunk analyzer instructions. Keep both {context} and {policy_chunk}.",
  },
  {
    key: "analyzer_report",
    title: "Analyzer Report Prompt",
    description:
      "Final reduce prompt for the structured JSON compliance report. Keep {all_findings}.",
  },
  {
    key: "compliance_system",
    title: "Compliance Prompt",
    description:
      "System prompt used for direct LLM compliance/report generation calls.",
  },
];

/* ─────────────────────────────────────────
   TAB ROUTING
   main.js owns tab switching directly —
   tabs.js is available but not needed here.
───────────────────────────────────────── */
const tabInits = {
  chat: { fn: renderChatStart, done: false },
  compliance: { fn: renderCompliance, done: false },
  analyzer: { fn: initAnalyzer, done: false }, // ← delegates to analyzer.js
};

document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

function activateTab(tabId) {
  document
    .querySelectorAll(".nav-tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.toggle("active", p.id === `panel-${tabId}`));

  const entry = tabInits[tabId];
  if (entry && !entry.done) {
    const container = document.getElementById(`panel-${tabId}`);
    entry.fn(container);
    entry.done = true;
  }
}

/* ─────────────────────────────────────────
   BOOT — activate default tab
───────────────────────────────────────── */
activateTab("chat");
initPromptSettings();

/* ═══════════════════════════════════════════════════════════
   CHAT PANEL
═══════════════════════════════════════════════════════════ */
function renderChatStart() {
  const panel = document.getElementById("panel-chat");
  panel.innerHTML = `
    <div class="chat-start-screen">
      <div class="chat-greeting">
        <div class="greeting-line-1">
          <span class="greeting-pulse"></span>
          Online · Ready to assist
        </div>
        <div class="greeting-line-2">
          DPDP or GDPR questions?<br>
          <span class="hl">Let's sort it out.</span>
        </div>
        <div class="greeting-line-3">
          Ask anything about India's Digital Personal Data Protection Act 2023, GDPR,
          consent requirements, data breaches, or cross-border transfers.
        </div>
      </div>

      <div class="chat-input-box">
        <div class="chat-input-wrapper">
          <textarea class="chat-input-large" id="start-input"
            placeholder="Ask about DPDP, GDPR, consent, data breaches…" rows="1"></textarea>
          <div class="input-actions">
            <button class="send-btn-main" id="start-send-btn" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="chat-chips">
        <button class="chip" data-q="What is the DPDP Act 2023 and who does it apply to?">
          <span class="chip-icon">🇮🇳</span> What is the DPDP Act 2023?
        </button>
        <button class="chip" data-q="What are the key differences between GDPR and India's DPDP Act?">
          <span class="chip-icon">⚖️</span> GDPR vs DPDP — key differences
        </button>
        <button class="chip" data-q="What are the consent requirements under the DPDP Act 2023?">
          <span class="chip-icon">✅</span> Consent rules under DPDP
        </button>
        <button class="chip" data-q="What are the data breach notification obligations under DPDP and GDPR?">
          <span class="chip-icon">🚨</span> Data breach obligations
        </button>
        <button class="chip" data-q="Does GDPR apply to Indian companies? What are the extraterritorial provisions?">
          <span class="chip-icon">🌍</span> Does GDPR apply to Indian companies?
        </button>
        <button class="chip" data-q="What are the penalties and fines under the DPDP Act 2023?">
          <span class="chip-icon">💸</span> Penalties under DPDP Act
        </button>
      </div>
    </div>
  `;

  const textarea = document.getElementById("start-input");
  const sendBtn = document.getElementById("start-send-btn");

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
    sendBtn.disabled = !textarea.value.trim();
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) kickoffChat(textarea.value.trim());
    }
  });
  sendBtn.addEventListener("click", () => {
    if (!sendBtn.disabled) kickoffChat(textarea.value.trim());
  });
  panel.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => kickoffChat(chip.dataset.q));
  });
}

function kickoffChat(query) {
  chatStarted = true;
  renderChatActive();
  sendMessage(query);
}

function renderChatActive() {
  const panel = document.getElementById("panel-chat");
  panel.innerHTML = `
    <div class="chat-active-layout">
      <div class="chat-main">
        <div class="chat-header">
          <div class="chat-header-left">
            <div class="status-dot"></div>
            <div class="chat-header-text">
              <strong>Vigilex AI</strong>
              <span>DPDP · GDPR · IT Act Expert</span>
            </div>
          </div>
          <button class="chat-new-btn" id="chat-new-btn">+ New chat</button>
        </div>
        <div class="messages" id="messages"></div>
        <div class="chat-input-area">
          <textarea class="chat-input" id="chat-input"
            placeholder="Ask a follow-up question…" rows="1"></textarea>
          <button class="send-btn" id="chat-send-btn" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z"
                stroke="#000" stroke-width="2.2" stroke-linecap="round"
                stroke-linejoin="round" fill="none"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="chat-sidebar">
        <div class="sidebar-card">
          <h4>Quick Topics</h4>
          <button class="quick-btn" data-q="Explain Section 7 of DPDP Act — lawful processing">📋 Lawful processing basis</button>
          <button class="quick-btn" data-q="What are data principal rights under DPDP Act 2023?">👤 Data principal rights</button>
          <button class="quick-btn" data-q="What is a Data Protection Officer and when is one required under GDPR?">🧑‍💼 DPO requirements</button>
          <button class="quick-btn" data-q="How does DPDP handle cross-border data transfers?">🌐 Cross-border transfers</button>
          <button class="quick-btn" data-q="How to draft a DPDP-compliant privacy notice?">📝 Privacy notice checklist</button>
        </div>
        <div class="sidebar-card">
          <h4>Session Info</h4>
          <div class="info-row"><span>Framework</span><span>DPDP + GDPR</span></div>
          <div class="info-row"><span>Engine</span><span>RAG + ChromaDB</span></div>
          <div class="info-row"><span>Model</span><span>GPT-4o-mini</span></div>
          <div class="info-row"><span>Messages</span><span id="msg-count">0</span></div>
        </div>
      </div>
    </div>
  `;

  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    sendBtn.disabled = !input.value.trim();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) handleSend();
    }
  });
  sendBtn.addEventListener("click", handleSend);
  document.getElementById("chat-new-btn").addEventListener("click", () => {
    msgCount = 0;
    chatStarted = false;
    tabInits.chat.done = false; // allow re-init on next tab visit
    renderChatStart();
  });
  panel.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.q));
  });

  function handleSend() {
    const val = input.value.trim();
    if (!val) return;
    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    sendMessage(val);
  }
}

async function sendMessage(text) {
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;

  appendMsg("user", text, []);
  updateMsgCount();

  const typingId = "typing-" + Date.now();
  messagesEl.insertAdjacentHTML(
    "beforeend",
    `
    <div class="msg ai" id="${typingId}">
      <div class="msg-avatar">${AI_AVATAR_HTML}</div>
      <div class="msg-bubble">
        <div class="typing"><span></span><span></span><span></span></div>
      </div>
    </div>
  `,
  );
  scrollToBottom();
  setInputDisabled(true);

  try {
    const res = await fetch(CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Server error");

    document.getElementById(typingId)?.remove();
    appendMsg("ai", data.answer || "No response received.", data.sources || []);
    updateMsgCount();
  } catch (err) {
    document.getElementById(typingId)?.remove();
    appendMsg(
      "ai",
      `⚠️ Could not reach the backend.\n\nMake sure **server.py** is running:\n\`python server.py\``,
      [],
    );
    console.error("Chat error:", err);
  }

  setInputDisabled(false);
  scrollToBottom();
}

function appendMsg(role, text, sources = []) {
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;

  const isAI = role === "ai" || role === "assistant";
  const avatar = isAI ? AI_AVATAR_HTML : "You";

  let sourcesHTML = "";
  if (isAI && sources.length) {
    const pills = sources
      .map((src) => {
        const name = src
          .split("/")
          .pop()
          .split("\\")
          .pop()
          .replace(/\.(pdf|txt|docx)$/i, "");
        return `<span class="source-pill">📄 ${name}</span>`;
      })
      .join("");
    sourcesHTML = `
      <div class="sources-strip">
        <span class="sources-label">Sources from ChromaDB</span>
        <div class="sources-pills">${pills}</div>
      </div>`;
  }

  messagesEl.insertAdjacentHTML(
    "beforeend",
    `
    <div class="msg ${isAI ? "ai" : "user"}">
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-bubble">
        ${isAI ? "<strong>Vigilex AI · RAG</strong>" : ""}
        ${formatText(text)}
        ${sourcesHTML}
      </div>
    </div>
  `,
  );
}

function formatText(text) {
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
  text = text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
  return `<p>${text}</p>`;
}

function scrollToBottom() {
  const el = document.getElementById("messages");
  if (el) el.scrollTop = el.scrollHeight;
}

function updateMsgCount() {
  msgCount++;
  const el = document.getElementById("msg-count");
  if (el) el.textContent = msgCount;
}

function setInputDisabled(disabled) {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  if (input) input.disabled = disabled;
  if (sendBtn) sendBtn.disabled = disabled;
}

function initPromptSettings() {
  const root = document.getElementById("prompt-settings-root");
  if (!root) return;

  root.innerHTML = `
    <button class="prompt-fab" id="prompt-fab" type="button" aria-label="Open prompt settings">
      <span class="prompt-fab-icon">⚙</span>
      <span class="prompt-fab-text">Prompts</span>
    </button>

    <aside class="prompt-drawer" id="prompt-drawer" aria-hidden="true">
      <div class="prompt-drawer-header">
        <div>
          <div class="prompt-drawer-eyebrow">Internal Controls</div>
          <h3>Vigilex Prompt Studio</h3>
          <p>Review, edit, save, or reset the live prompts used by Vigilex.</p>
        </div>
        <button class="prompt-close" id="prompt-close" type="button" aria-label="Close prompt settings">✕</button>
      </div>

      <div class="prompt-toolbar">
        <button class="btn-outline" id="prompt-refresh-btn" type="button">Refresh</button>
        <button class="btn-outline" id="prompt-reset-all-btn" type="button">Reset All</button>
      </div>

      <div class="prompt-status" id="prompt-status">Loading prompts...</div>
      <div class="prompt-list" id="prompt-list"></div>
    </aside>
  `;

  const fab = document.getElementById("prompt-fab");
  const drawer = document.getElementById("prompt-drawer");
  const closeBtn = document.getElementById("prompt-close");

  fab.addEventListener("click", () => {
    drawer.classList.toggle("open");
    drawer.setAttribute(
      "aria-hidden",
      drawer.classList.contains("open") ? "false" : "true",
    );
  });
  closeBtn.addEventListener("click", () => {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  });
  document
    .getElementById("prompt-refresh-btn")
    .addEventListener("click", loadPromptSettings);
  document
    .getElementById("prompt-reset-all-btn")
    .addEventListener("click", handleResetAllPrompts);

  renderPromptCards();
  loadPromptSettings();
}

function renderPromptCards() {
  const list = document.getElementById("prompt-list");
  if (!list) return;

  list.innerHTML = PROMPT_SECTIONS.map(
    (section) => `
      <section class="prompt-card" data-key="${section.key}">
        <div class="prompt-card-head">
          <div>
            <h4>${section.title}</h4>
            <p>${section.description}</p>
          </div>
        </div>
        <textarea class="prompt-textarea" data-prompt-input="${section.key}" spellcheck="false"></textarea>
        <div class="prompt-card-actions">
          <button class="btn-outline" type="button" data-prompt-save="${section.key}">Save</button>
          <button class="btn-outline" type="button" data-prompt-reset="${section.key}">Reset</button>
        </div>
      </section>
    `,
  ).join("");

  PROMPT_SECTIONS.forEach((section) => {
    const textarea = list.querySelector(`[data-prompt-input="${section.key}"]`);
    if (textarea) {
      textarea.value = promptState[section.key] || "";
    }

    list
      .querySelector(`[data-prompt-save="${section.key}"]`)
      ?.addEventListener("click", () => handleSavePrompt(section.key));
    list
      .querySelector(`[data-prompt-reset="${section.key}"]`)
      ?.addEventListener("click", () => handleResetPrompt(section.key));
  });
}

async function loadPromptSettings() {
  updatePromptStatus("Loading prompts...", "muted");
  try {
    promptState = await getPromptSettings();
    renderPromptCards();
    updatePromptStatus("Live prompts loaded.", "success");
  } catch (err) {
    updatePromptStatus(err.message, "error");
  }
}

async function handleSavePrompt(key) {
  const textarea = document.querySelector(`[data-prompt-input="${key}"]`);
  if (!textarea) return;

  updatePromptStatus(`Saving ${promptLabel(key)}...`, "muted");
  try {
    promptState = await savePromptSettings({ [key]: textarea.value });
    renderPromptCards();
    updatePromptStatus(`${promptLabel(key)} saved.`, "success");
  } catch (err) {
    updatePromptStatus(err.message, "error");
  }
}

async function handleResetPrompt(key) {
  updatePromptStatus(`Resetting ${promptLabel(key)}...`, "muted");
  try {
    promptState = await resetPromptSettings(key);
    renderPromptCards();
    updatePromptStatus(`${promptLabel(key)} reset to default.`, "success");
  } catch (err) {
    updatePromptStatus(err.message, "error");
  }
}

async function handleResetAllPrompts() {
  updatePromptStatus("Resetting all prompts...", "muted");
  try {
    promptState = await resetPromptSettings();
    renderPromptCards();
    updatePromptStatus("All prompts reset to defaults.", "success");
  } catch (err) {
    updatePromptStatus(err.message, "error");
  }
}

function promptLabel(key) {
  return PROMPT_SECTIONS.find((section) => section.key === key)?.title || key;
}

function updatePromptStatus(message, tone = "muted") {
  const status = document.getElementById("prompt-status");
  if (!status) return;
  status.textContent = message;
  status.className = `prompt-status ${tone}`;
}

/* ═══════════════════════════════════════════════════════════
   COMPLIANCE PANEL  (unchanged from original)
═══════════════════════════════════════════════════════════ */
function renderCompliance() {
  const panel = document.getElementById("panel-compliance");

  const checks = [
    {
      id: "c1",
      fw: "dpdp",
      title: "Lawful basis for processing",
      desc: "Valid consent or legitimate use under Section 4 of DPDP Act",
      tag: "DPDP",
      weight: 10,
    },
    {
      id: "c2",
      fw: "dpdp",
      title: "Privacy notice published",
      desc: "Transparent notice to data principals before collection",
      tag: "DPDP",
      weight: 8,
    },
    {
      id: "c3",
      fw: "dpdp",
      title: "Consent management system",
      desc: "Mechanism to obtain, record and withdraw consent",
      tag: "DPDP",
      weight: 9,
    },
    {
      id: "c4",
      fw: "dpdp",
      title: "Data Principal rights implemented",
      desc: "Access, correction, erasure and grievance redressal",
      tag: "DPDP",
      weight: 8,
    },
    {
      id: "c5",
      fw: "dpdp",
      title: "Data breach response plan",
      desc: "72-hour notification to DPBI and data principals",
      tag: "DPDP",
      weight: 9,
    },
    {
      id: "c6",
      fw: "dpdp",
      title: "Data retention & deletion policy",
      desc: "Data erased when purpose is fulfilled per Section 8(7)",
      tag: "DPDP",
      weight: 7,
    },
    {
      id: "c7",
      fw: "dpdp",
      title: "Children's data safeguards",
      desc: "Verifiable parental consent for under-18 users",
      tag: "DPDP",
      weight: 8,
    },
    {
      id: "g1",
      fw: "gdpr",
      title: "Article 6 lawful basis documented",
      desc: "One of 6 lawful bases identified and documented for each processing activity",
      tag: "GDPR",
      weight: 10,
    },
    {
      id: "g2",
      fw: "gdpr",
      title: "Data Processing Register (RoPA)",
      desc: "Records of processing activities maintained per Article 30",
      tag: "GDPR",
      weight: 8,
    },
    {
      id: "g3",
      fw: "gdpr",
      title: "DPA contracts with processors",
      desc: "Article 28 agreements with all data processors",
      tag: "GDPR",
      weight: 9,
    },
    {
      id: "g4",
      fw: "gdpr",
      title: "DPIA for high-risk processing",
      desc: "Data Protection Impact Assessments completed where required",
      tag: "GDPR",
      weight: 7,
    },
    {
      id: "g5",
      fw: "gdpr",
      title: "72-hour breach notification",
      desc: "Process to notify supervisory authority within 72 hours",
      tag: "GDPR",
      weight: 9,
    },
    {
      id: "g6",
      fw: "gdpr",
      title: "Cross-border transfer mechanisms",
      desc: "SCCs, adequacy decisions or BCRs for non-EEA transfers",
      tag: "GDPR",
      weight: 8,
    },
    {
      id: "b1",
      fw: "both",
      title: "Privacy Policy updated",
      desc: "Covers both DPDP and GDPR obligations",
      tag: "BOTH",
      weight: 7,
    },
    {
      id: "b2",
      fw: "both",
      title: "Staff data protection training",
      desc: "Annual training for all staff handling personal data",
      tag: "BOTH",
      weight: 6,
    },
    {
      id: "b3",
      fw: "both",
      title: "Incident response plan",
      desc: "Documented plan tested at least once per year",
      tag: "BOTH",
      weight: 8,
    },
  ];

  const checkHTML = (section, label) => `
    <div class="form-section-title">${label}</div>
    ${checks
      .filter((c) => c.fw === section)
      .map(
        (c) => `
      <div class="check-item">
        <input type="checkbox" id="${c.id}" data-weight="${c.weight}">
        <label for="${c.id}">
          <strong>${c.title}</strong>
          <span>${c.desc}</span>
        </label>
        <span class="tag ${c.fw}">${c.tag}</span>
      </div>`,
      )
      .join("")}
  `;

  panel.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Compliance Posture Check</div>
        <div class="section-sub">Check every item that applies to your organisation</div>
      </div>
    </div>
    <div class="compliance-layout">
      <div class="form-card">
        ${checkHTML("dpdp", "🇮🇳 DPDP Act 2023")}
        ${checkHTML("gdpr", "🇪🇺 GDPR")}
        ${checkHTML("both", "🌐 Both Frameworks")}
      </div>
      <div class="score-card">
        <div class="section-title" style="font-size:.9rem">Compliance Score</div>
        <div class="score-ring-wrap">
          <div class="score-ring">
            <svg viewBox="0 0 140 140">
              <circle class="ring-bg"   cx="70" cy="70" r="60"/>
              <circle class="ring-fill" cx="70" cy="70" r="60" id="ring-fill"/>
            </svg>
            <div class="score-center">
              <span class="score-num" id="score-num">0</span>
              <span class="score-label">/ 100</span>
            </div>
          </div>
        </div>
        <div class="score-grade" id="score-grade" style="color:var(--text3)">Not assessed</div>
        <ul class="risk-list" id="risk-list">
          <li class="risk-item">
            <span class="risk-dot med"></span>
            <span>Check items above and click Calculate</span>
          </li>
        </ul>
        <button class="calc-btn" id="calc-btn">Calculate Score</button>
        <div class="disclaimer">
          ⚠️ This tool provides a general guidance score only — not legal advice.
        </div>
      </div>
    </div>
  `;

  document.getElementById("calc-btn").addEventListener("click", calcScore);
}

function calcScore() {
  const all = [...document.querySelectorAll(".check-item input")];
  const checked = all.filter((el) => el.checked);
  const totalW = all.reduce((s, el) => s + +el.dataset.weight, 0);
  const checkedW = checked.reduce((s, el) => s + +el.dataset.weight, 0);
  const score = Math.round((checkedW / totalW) * 100);

  const ring = document.getElementById("ring-fill");
  const circ = 2 * Math.PI * 60;
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ - (circ * score) / 100;
  ring.style.stroke =
    score >= 75 ? "var(--green)" : score >= 50 ? "var(--yellow)" : "var(--red)";

  document.getElementById("score-num").textContent = score;
  document.getElementById("score-num").style.color =
    score >= 75 ? "var(--green)" : score >= 50 ? "var(--yellow)" : "var(--red)";

  let grade, gradeColor;
  if (score >= 85) {
    grade = "🟢 Strong Posture";
    gradeColor = "var(--green)";
  } else if (score >= 65) {
    grade = "🟡 Moderate Risk";
    gradeColor = "var(--yellow)";
  } else if (score >= 40) {
    grade = "🟠 High Risk";
    gradeColor = "var(--warn)";
  } else {
    grade = "🔴 Critical Gaps";
    gradeColor = "var(--red)";
  }

  document.getElementById("score-grade").textContent = grade;
  document.getElementById("score-grade").style.color = gradeColor;

  const unchecked = all.filter((el) => !el.checked).slice(0, 5);
  const riskList = document.getElementById("risk-list");
  riskList.innerHTML = unchecked.length
    ? unchecked
        .map((el) => {
          const label = el
            .closest(".check-item")
            .querySelector("strong").textContent;
          const w = +el.dataset.weight;
          const level = w >= 9 ? "high" : w >= 7 ? "med" : "low";
          return `<li class="risk-item"><span class="risk-dot ${level}"></span><span>Missing: ${label}</span></li>`;
        })
        .join("")
    : `<li class="risk-item"><span class="risk-dot low"></span><span>All major controls checked ✓</span></li>`;
}
