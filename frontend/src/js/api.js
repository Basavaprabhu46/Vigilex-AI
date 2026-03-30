/**
 * api.js
 * All HTTP calls to the Flask backend (server.py on port 5001).
 * Single source of truth for FLASK_BASE — no other file should hardcode it.
 */

export const FLASK_BASE = "http://localhost:5001";

/**
 * Chat panel — RAG Q&A pipeline.
 * → POST /api/chat → brain.ask_legal_bot() → ChromaDB → LLM
 *
 * @param {string} question
 * @returns {Promise<{answer: string, sources: string[]}>}
 */
export async function askRAG(question) {
  const res = await fetch(`${FLASK_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { answer: data.answer, sources: data.sources || [] };
}

/**
 * Policy Analyzer — full RAG compliance analysis.
 * → POST /api/analyze-rag → brain.analyze_policy() → map-reduce → JSON
 *
 * FIX: was sending { prompt } (giant instruction string + truncated policy).
 *      Now sends { policy_text } (clean text only).
 *      brain.py owns all chunking, retrieval, and prompt engineering.
 *
 * @param {string} policyText  - Full clean policy text (no truncation)
 * @returns {Promise<{answer: string, sources: string[]}>}
 */
export async function analyzeWithRAG(policyText) {
  const res = await fetch(`${FLASK_BASE}/api/analyze-rag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policy_text: policyText }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { answer: data.answer, sources: data.sources || [] };
}

/**
 * Compliance panel — direct LLM, no RAG.
 * → POST /api/analyze → LLM with system prompt
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
export async function callLLM(messages) {
  const res = await fetch(`${FLASK_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.answer;
}

/**
 * Upload a PDF or TXT file for server-side text extraction.
 * → POST /api/upload-policy (multipart) → PyPDFLoader → clean text
 *
 * @param {File} file
 * @returns {Promise<{text: string, char_count: number, filename: string, pages?: number}>}
 */
export async function uploadPolicy(file) {
  const formData = new FormData();
  formData.append("file", file);

  // Do NOT set Content-Type — browser sets it with the multipart boundary
  const res = await fetch(`${FLASK_BASE}/api/upload-policy`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function getPromptSettings() {
  const res = await fetch(`${FLASK_BASE}/api/prompts`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.prompts || {};
}

export async function savePromptSettings(prompts) {
  const res = await fetch(`${FLASK_BASE}/api/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompts }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.prompts || {};
}

export async function resetPromptSettings(key = null) {
  const res = await fetch(`${FLASK_BASE}/api/prompts/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(key ? { key } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.prompts || {};
}
