/**
 * chat.js
 * Renders the Chat panel and handles all chat logic.
 * API key removed — all calls go through the Flask backend.
 */

import { askRAG, callLLM } from "./api.js";

let chatHistory = [];

const HTML = /* html */ `
  <div class="section-header">
    <div>
      <div class="section-title">Legal Assistant</div>
      <div class="section-sub">Ask anything about DPDP Act 2023, GDPR, or IT Act in plain language</div>
    </div>
    <button class="btn-outline" id="clearChatBtn">Clear history</button>
  </div>

  <div class="chat-layout">
    <div class="chat-main">
      <div class="chat-header">
        <div class="status-dot"></div>
        <div class="chat-header-text">
          <strong>Vigilex Legal AI</strong>
          <span>Expert in DPDP · GDPR · IT Act</span>
        </div>
      </div>
      <div class="messages" id="messages"></div>
      <div class="chat-input-area">
        <textarea
          class="chat-input"
          id="chatInput"
          placeholder="Ask about DPDP, GDPR, data rights, consent requirements..."
          rows="1"
        ></textarea>
        <button class="send-btn" id="sendBtn">
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M2 21L23 12 2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>

    <div class="chat-sidebar">
      <div class="sidebar-card">
        <h4>Quick Questions</h4>
        <button class="quick-btn" data-q="What is the DPDP Act 2023?">What is the DPDP Act 2023?</button>
        <button class="quick-btn" data-q="What is a Data Fiduciary under DPDP?">What is a Data Fiduciary?</button>
        <button class="quick-btn" data-q="What are data subject rights under GDPR?">Data rights under GDPR?</button>
        <button class="quick-btn" data-q="What is a Data Protection Officer and when is one required?">When is a DPO required?</button>
        <button class="quick-btn" data-q="What are the penalties under DPDP Act for non-compliance?">DPDP penalties?</button>
      </div>
      <div class="sidebar-card">
        <h4>Coverage</h4>
        <div class="info-row"><span>DPDP Act 2023</span><span>INDIA</span></div>
        <div class="info-row"><span>GDPR</span><span>EU</span></div>
        <div class="info-row"><span>IT Act 2000</span><span>INDIA</span></div>
        <div class="info-row"><span>IT Rules 2011</span><span>INDIA</span></div>
      </div>
    </div>
  </div>

  <div class="disclaimer">⚠️ For informational purposes only. This is not legal advice. Consult a qualified legal professional for specific compliance decisions.</div>
`;

export function initChat(container) {
  container.innerHTML = HTML;
  addMessage(
    "ai",
    'Hello! I\'m your AI legal assistant for data protection compliance. I can help you understand the <strong>DPDP Act 2023</strong>, <strong>GDPR</strong>, and <strong>IT Act</strong> in simple terms.<br><br>Ask me anything — like "What is the DPDP Act?" or "What data rights do users have under GDPR?"',
  );
  bindEvents();
}

function bindEvents() {
  document.getElementById("sendBtn").addEventListener("click", sendMessage);
  document.getElementById("clearChatBtn").addEventListener("click", clearChat);

  const input = document.getElementById("chatInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => quickAsk(btn.dataset.q));
  });
}

function addMessage(role, html) {
  const msgs = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = "msg " + role;
  const avatar = role === "ai" ? "🛡️" : "U";
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${role === "ai" ? "<strong>Vigilex AI</strong>" : ""}${html}</div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function formatText(text) {
  return text
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}

function addTyping() {
  const msgs = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = "msg ai";
  div.id = "typing-indicator";
  div.innerHTML = `
    <div class="msg-avatar">🛡️</div>
    <div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  document.getElementById("typing-indicator")?.remove();
}

async function sendMessage() {
  // requireApiKey() always returns true now — kept for structural consistency
  if (!requireApiKey()) return;

  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  addMessage("user", formatText(text));
  input.value = "";
  input.style.height = "auto";
  chatHistory.push({ role: "user", content: text });

  const btn = document.getElementById("sendBtn");
  btn.disabled = true;
  addTyping();

  try {
    // Goes to Flask /ask → RAG pipeline in brain.py
    const { answer, sources } = await askRAG(text);
    removeTyping();

    let html = formatText(answer);
    if (sources.length) {
      const pills = sources
        .map((s) => {
          // Strip folder path, keep just the filename
          const name = s.split(/[\\/]/).pop();
          return `<span class="source-pill">📄 ${name}</span>`;
        })
        .join("");
      html += `
        <div class="sources-strip">
          <span class="sources-label">Sources used</span>
          <div class="sources-pills">${pills}</div>
        </div>`;
    }
    addMessage("ai", html);
    chatHistory.push({ role: "assistant", content: answer });
  } catch (e) {
    removeTyping();
    addMessage(
      "ai",
      `⚠️ Error: ${e.message}<br><br>Make sure the Flask server is running (<code>python brain.py</code>).`,
    );
  }

  btn.disabled = false;
}

function quickAsk(q) {
  document.getElementById("chatInput").value = q;
  sendMessage();
}

function clearChat() {
  chatHistory = [];
  document.getElementById("messages").innerHTML = "";
  addMessage(
    "ai",
    "Chat cleared. How can I help you with data protection compliance today?",
  );
}

/**
 * Exported so the Compliance tab can trigger a report via chat.
 * Goes to Flask /chat → direct LLM call in brain.py.
 */
export async function generateReportMessage(score, failedItems) {
  if (!requireApiKey()) return;

  const prompt = `Based on a compliance assessment with score ${score}/100:
Missing items: ${failedItems.join(", ")}
Provide a brief executive compliance report (3-4 paragraphs) covering:
1. Overall compliance posture
2. Top 3 critical gaps to fix immediately
3. Recommended next steps
Keep it actionable and concise.`;

  addMessage(
    "user",
    `Please generate a compliance report. My score is ${score}/100. Missing: ${failedItems.slice(0, 5).join(", ")}${failedItems.length > 5 ? "..." : ""}`,
  );
  chatHistory.push({ role: "user", content: prompt });
  addTyping();

  try {
    // Goes to Flask /chat → direct LLM in brain.py (no RAG needed for reports)
    const reply = await callLLM(chatHistory);
    removeTyping();
    addMessage("ai", formatText(reply));
    chatHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    removeTyping();
    addMessage("ai", "⚠️ Error generating report: " + e.message);
  }
}
