/**
 * compliance.js
 * Renders the Compliance Assessment panel and scoring logic.
 */

import { generateReportMessage } from "./chat.js";
import { switchTab } from "./tabs.js";

const CHECKS = [
  // [id, weight, law, title, description]
  // Data Collection & Consent
  {
    id: "c1",
    w: 10,
    law: "both",
    title: "Explicit Consent Mechanism",
    desc: "You obtain clear, affirmative consent before collecting personal data",
  },
  {
    id: "c2",
    w: 8,
    law: "dpdp",
    title: "Consent Notice in Simple Language",
    desc: "Your consent notice is in plain, easily understandable language",
  },
  {
    id: "c3",
    w: 7,
    law: "both",
    title: "Purpose Limitation",
    desc: "Data is only used for the purpose explicitly stated at collection",
  },
  {
    id: "c4",
    w: 6,
    law: "gdpr",
    title: "Lawful Basis Documentation",
    desc: "You have documented the lawful basis for each processing activity",
  },
  // Data Security
  {
    id: "c5",
    w: 10,
    law: "both",
    title: "Data Encryption",
    desc: "Personal data is encrypted at rest and in transit",
  },
  {
    id: "c6",
    w: 9,
    law: "both",
    title: "Access Controls",
    desc: "Role-based access control is in place for all personal data systems",
  },
  {
    id: "c7",
    w: 7,
    law: "both",
    title: "Data Retention Policy",
    desc: "You have defined and enforced retention periods for personal data",
  },
  {
    id: "c8",
    w: 5,
    law: "dpdp",
    title: "Data Localization",
    desc: "Sensitive personal data is stored within India as required",
  },
  // Individual Rights
  {
    id: "c9",
    w: 8,
    law: "both",
    title: "Right to Access",
    desc: "Users can request and receive a copy of their personal data",
  },
  {
    id: "c10",
    w: 8,
    law: "both",
    title: "Right to Erasure / Withdraw Consent",
    desc: "Users can delete their data or withdraw consent at any time",
  },
  {
    id: "c11",
    w: 5,
    law: "gdpr",
    title: "Data Portability",
    desc: "Users can export their data in a machine-readable format",
  },
  {
    id: "c12",
    w: 6,
    law: "dpdp",
    title: "Grievance Officer",
    desc: "A Grievance Officer is appointed and their contact is published",
  },
  // Breach Management
  {
    id: "c13",
    w: 9,
    law: "both",
    title: "Breach Notification Process",
    desc: "You have a process to notify authorities and users of a data breach",
  },
  {
    id: "c14",
    w: 8,
    law: "gdpr",
    title: "72-Hour GDPR Reporting",
    desc: "Breaches are reported to the supervisory authority within 72 hours",
  },
  {
    id: "c15",
    w: 6,
    law: "both",
    title: "Incident Response Plan",
    desc: "A documented incident response plan exists and is tested regularly",
  },
  // Documentation & Governance
  {
    id: "c16",
    w: 9,
    law: "both",
    title: "Privacy Policy Published",
    desc: "A clear, up-to-date privacy policy is publicly available",
  },
  {
    id: "c17",
    w: 6,
    law: "gdpr",
    title: "Records of Processing (RoPA)",
    desc: "Article 30 Records of Processing Activities are maintained",
  },
  {
    id: "c18",
    w: 4,
    law: "gdpr",
    title: "DPIA Process",
    desc: "Data Protection Impact Assessments are conducted for high-risk processing",
  },
  {
    id: "c19",
    w: 6,
    law: "both",
    title: "Vendor / Processor Agreements",
    desc: "Data processing agreements are signed with all third-party vendors",
  },
  {
    id: "c20",
    w: 4,
    law: "both",
    title: "Staff Privacy Training",
    desc: "All staff handling personal data receive regular privacy training",
  },
];

const RISK_LABELS = {
  c1: {
    label: "No consent mechanism — HIGH risk of regulatory action",
    level: "high",
  },
  c2: {
    label: "Consent notice may be deemed unclear under DPDP",
    level: "med",
  },
  c3: {
    label: "Data may be used beyond stated purpose — legal violation",
    level: "high",
  },
  c4: {
    label: "Missing lawful basis documentation — GDPR Article 6 gap",
    level: "med",
  },
  c5: {
    label: "Unencrypted data — critical security vulnerability",
    level: "high",
  },
  c6: {
    label: "Insufficient access controls — breach risk elevated",
    level: "high",
  },
  c7: {
    label: "No retention policy — data minimization principle violated",
    level: "med",
  },
  c8: {
    label: "Data localization requirements may not be met (DPDP)",
    level: "low",
  },
  c9: {
    label: "Right to access not supported — regulatory non-compliance",
    level: "high",
  },
  c10: {
    label: "Erasure/withdrawal mechanism missing — DPDP & GDPR violation",
    level: "high",
  },
  c11: {
    label: "Data portability not available — GDPR Article 20 gap",
    level: "med",
  },
  c12: {
    label: "No Grievance Officer — required under DPDP for Significant FIs",
    level: "med",
  },
  c13: {
    label: "No breach notification process — severe penalty risk",
    level: "high",
  },
  c14: {
    label: "72-hour GDPR breach reporting not established",
    level: "high",
  },
  c15: { label: "No incident response plan — reactive risk", level: "med" },
  c16: {
    label: "Missing privacy policy — fundamental compliance failure",
    level: "high",
  },
  c17: {
    label: "No RoPA maintained — GDPR Article 30 violation",
    level: "med",
  },
  c18: {
    label: "No DPIA process — required for high-risk activities (GDPR)",
    level: "low",
  },
  c19: {
    label: "No vendor agreements — third-party data leakage risk",
    level: "med",
  },
  c20: {
    label: "Staff not trained — human error breach risk increased",
    level: "low",
  },
};

const SECTIONS = [
  { title: "📋 Data Collection & Consent", ids: ["c1", "c2", "c3", "c4"] },
  { title: "🔒 Data Security", ids: ["c5", "c6", "c7", "c8"] },
  { title: "👤 Individual Rights", ids: ["c9", "c10", "c11", "c12"] },
  { title: "🚨 Breach Management", ids: ["c13", "c14", "c15"] },
  {
    title: "📁 Documentation & Governance",
    ids: ["c16", "c17", "c18", "c19", "c20"],
  },
];

function buildCheckItem(chk) {
  return /* html */ `
    <div class="check-item">
      <input type="checkbox" id="${chk.id}" class="comp-check" data-weight="${chk.w}">
      <label for="${chk.id}">
        <strong>${chk.title}</strong>
        <span>${chk.desc}</span>
      </label>
      <span class="tag ${chk.law}">${chk.law.toUpperCase()}</span>
    </div>
  `;
}

function buildForm() {
  const checkMap = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
  return SECTIONS.map(
    (sec) => `
    <div class="form-section-title">${sec.title}</div>
    ${sec.ids.map((id) => buildCheckItem(checkMap[id])).join("")}
  `,
  ).join("");
}

const HTML = /* html */ `
  <div class="section-header">
    <div>
      <div class="section-title">Compliance Assessment</div>
      <div class="section-sub">Answer ${CHECKS.length} questions to get your compliance score and risk breakdown</div>
    </div>
    <button class="btn-outline" id="resetBtn">Reset form</button>
  </div>

  <div class="compliance-layout">
    <div class="form-card" id="complianceForm">
      ${buildForm()}
    </div>

    <div class="score-card">
      <div style="font-family:'Fira Code',sans-serif;font-weight:700;font-size:1rem;margin-bottom:4px;">Compliance Score</div>
      <div class="score-ring-wrap">
        <div class="score-ring">
          <svg viewBox="0 0 140 140">
            <circle class="ring-bg"   cx="70" cy="70" r="60"/>
            <circle class="ring-fill" id="ringFill" cx="70" cy="70" r="60"/>
          </svg>
          <div class="score-center">
            <div class="score-num" id="scoreNum">0</div>
            <div class="score-label">/100</div>
          </div>
        </div>
      </div>

      <div class="score-grade" id="scoreGrade" style="color:var(--text3)">🔴 Critical Gaps Found</div>

      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" id="progressBar"></div>
      </div>
      <div style="font-size:.75rem;color:var(--text3);text-align:right;margin-bottom:16px;" id="progressText">0 / ${CHECKS.length}</div>

      <div style="font-family:'DM Mono',monospace;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin-bottom:8px;">Top Risk Gaps</div>
      <ul class="risk-list" id="riskList">
        <li style="font-size:.8rem;color:var(--text3);padding:8px 0;">Check items to see risks</li>
      </ul>

      <button class="calc-btn" id="genReportBtn">Generate AI Report →</button>
    </div>
  </div>
`;

export function initCompliance(container) {
  container.innerHTML = HTML;
  bindEvents();
}

function bindEvents() {
  document
    .querySelectorAll(".comp-check")
    .forEach((cb) => cb.addEventListener("change", updateScore));
  document
    .getElementById("resetBtn")
    .addEventListener("click", resetCompliance);
  document
    .getElementById("genReportBtn")
    .addEventListener("click", generateReport);
}

function updateScore() {
  const checks = document.querySelectorAll(".comp-check");
  let total = 0,
    earned = 0,
    checked = 0;
  const missing = [];

  checks.forEach((cb) => {
    const w = parseInt(cb.dataset.weight);
    total += w;
    if (cb.checked) {
      earned += w;
      checked++;
    } else {
      missing.push(cb.id);
    }
  });

  const score = Math.round((earned / total) * 100);
  document.getElementById("scoreNum").textContent = score;
  document.getElementById("progressText").textContent =
    `${checked} / ${CHECKS.length}`;
  document.getElementById("progressBar").style.width =
    (checked / CHECKS.length) * 100 + "%";

  const fill = document.getElementById("ringFill");
  const circumference = 377;
  fill.style.strokeDashoffset = circumference - (circumference * score) / 100;
  fill.style.stroke =
    score >= 80
      ? "var(--green)"
      : score >= 60
        ? "var(--yellow)"
        : score >= 40
          ? "var(--warn)"
          : "var(--red)";

  const gradeEl = document.getElementById("scoreGrade");
  if (score >= 85) {
    gradeEl.textContent = "🟢 Strong Compliance";
    gradeEl.style.color = "var(--green)";
  } else if (score >= 65) {
    gradeEl.textContent = "🟡 Moderate Compliance";
    gradeEl.style.color = "var(--yellow)";
  } else if (score >= 40) {
    gradeEl.textContent = "🟠 Partial Compliance";
    gradeEl.style.color = "var(--warn)";
  } else {
    gradeEl.textContent = "🔴 Critical Gaps Found";
    gradeEl.style.color = "var(--red)";
  }

  const topRisks = missing
    .filter((id) => RISK_LABELS[id])
    .sort(
      (a, b) =>
        ({ high: 0, med: 1, low: 2 })[RISK_LABELS[a].level] -
        { high: 0, med: 1, low: 2 }[RISK_LABELS[b].level],
    )
    .slice(0, 6);

  const riskList = document.getElementById("riskList");
  if (topRisks.length === 0) {
    riskList.innerHTML =
      '<li style="font-size:.8rem;color:var(--green);padding:8px 0;">✅ No gaps identified!</li>';
  } else {
    riskList.innerHTML = topRisks
      .map((id) => {
        const r = RISK_LABELS[id];
        return `<li class="risk-item"><div class="risk-dot ${r.level}"></div><span>${r.label}</span></li>`;
      })
      .join("");
  }
}

function resetCompliance() {
  document
    .querySelectorAll(".comp-check")
    .forEach((cb) => (cb.checked = false));
  updateScore();
}

async function generateReport() {
  const checks = document.querySelectorAll(".comp-check");
  const failed = [];
  checks.forEach((cb) => {
    if (!cb.checked) {
      const label =
        cb.nextElementSibling?.querySelector("strong")?.textContent || cb.id;
      failed.push(label);
    }
  });
  const score = document.getElementById("scoreNum").textContent;

  switchTab("chat");
  await generateReportMessage(score, failed);
}
