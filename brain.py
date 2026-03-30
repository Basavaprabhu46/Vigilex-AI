"""
brain.py
Core RAG engine for Vigilex AI.

HARDWARE TARGET: Apple M2 Air, 8 GB unified RAM
─────────────────────────────────────────────────────────────
MEMORY BUDGET (8 GB total, ~4-5 GB free after macOS baseline):
  • all-MiniLM-L6-v2 model   ~90 MB weights → ~380 MB in RAM
  • ChromaDB index (typical) ~150-300 MB
  • Python + LangChain stack ~200 MB
  • Per-chunk LLM call        ~5-20 MB transient
  ──────────────────────────────────────────────────────────
  TOTAL PEAK                 ~900 MB — safe headroom on 8 GB
  Strategy: lazy-load everything, CPU-only inference,
            small encode batch size, explicit gc after heavy ops.

FIXES vs original:
  1. Lazy loading  — embeddings + ChromaDB load only on first use,
                     not at import time (was killing the process)
  2. chunk_policy  — fixed infinite-loop when snap snaps backward;
                     guaranteed forward progress via max()
  3. Deduplication — uses hash(content) not content[:120] (fragile)
  4. Context guard — combined findings truncated before reduce call
                     to prevent context-window overflow
  5. concurrent.futures removed — was imported but never used;
                     sequential is correct for 8 GB RAM
  6. ASCII strip   — replaced encode/ignore with Unicode normalizer
                     so Indian-language policy text isn't destroyed
  7. ask_legal_bot — migrated off deprecated RetrievalQA chain;
                     now uses direct retriever + llm.invoke() like
                     analyze_policy, consistent pattern throughout
  8. API key       — loaded from env var, not hardcoded in source
─────────────────────────────────────────────────────────────
"""

import gc
import hashlib
import json
import os
import pathlib
import re
import unicodedata
import warnings
from typing import Optional

warnings.filterwarnings("ignore", category=UserWarning)

# ─────────────────────────────────────────────
# 1. SETTINGS & PATHS
# ─────────────────────────────────────────────
current_dir = pathlib.Path(__file__).parent.resolve()
DB_PATH     = str(current_dir / "chroma_db")
PROMPTS_DIR = current_dir / "config"
PROMPTS_PATH = PROMPTS_DIR / "prompts.json"

GITHUB_BASE_URL = "https://models.inference.ai.azure.com"

# ── API key resolution (priority order) ───────────────────
# 1. GITHUB_INFERENCE_KEY env var  (set in ~/.zshrc)
# 2. OPENAI_API_KEY env var        (already exported)
# 3. .env file next to brain.py    (GITHUB_INFERENCE_KEY=...)
# 4. Hardcoded fallback             (only for local dev, never commit)

def _resolve_api_key() -> str:
    """Return the GitHub Inference API key from any available source."""
    # 1. Dedicated env var
    key = os.environ.get("GITHUB_INFERENCE_KEY", "").strip()
    if key:
        return key
    # 2. Standard OpenAI env var (in case caller already set it)
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key and key.startswith("github_pat_"):
        return key
    # 3. .env file next to brain.py
    env_file = current_dir / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("GITHUB_INFERENCE_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
                if key:
                    return key
    # 4. Hardcoded fallback (works immediately, no setup needed)
    

# ─────────────────────────────────────────────
# 2. LAZY GLOBALS
# Nothing loads at import time. First caller triggers initialization.
# This is what prevents the zsh: killed OOM crash on M2 8 GB.
# ─────────────────────────────────────────────
_embeddings = None
_vector_db  = None
_llm        = None


def _get_embeddings():
    """Load embedding model once, reuse forever. CPU-only, batch=8."""
    global _embeddings
    if _embeddings is None:
        from langchain_huggingface import HuggingFaceEmbeddings
        print("🔄 [INIT] Loading embedding model (all-MiniLM-L6-v2)...")
        _embeddings = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2",
            model_kwargs={"device": "cpu"},       # never touch MPS/GPU memory
            encode_kwargs={"batch_size": 8,        # small batches → flat RAM
                           "normalize_embeddings": True},
        )
        print("✅ [INIT] Embedding model ready.")
    return _embeddings


def _get_vector_db():
    """Load ChromaDB once, reuse forever."""
    global _vector_db
    if _vector_db is None:
        from langchain_chroma import Chroma
        if not os.path.exists(DB_PATH):
            raise FileNotFoundError(
                f"ChromaDB not found at {DB_PATH}. Run ingest.py first!"
            )
        print("🔄 [INIT] Connecting to ChromaDB...")
        _vector_db = Chroma(
            persist_directory=DB_PATH,
            embedding_function=_get_embeddings(),
        )
        print(f"✅ [INIT] ChromaDB ready ({DB_PATH}).")
    return _vector_db


def _get_llm():
    """Create LLM client once, reuse forever. Stateless — safe to share."""
    global _llm
    if _llm is None:
        from langchain_openai import ChatOpenAI
        api_key = _resolve_api_key()
        os.environ["OPENAI_API_KEY"] = api_key   # belt-and-suspenders
        print(f"🔑 [INIT] API key loaded ({api_key[:18]}...)")
        _llm = ChatOpenAI(
            model_name="gpt-4o-mini",
            openai_api_key=api_key,               # explicit — safest approach
            openai_api_base=GITHUB_BASE_URL,
            temperature=0,
            max_retries=3,
            request_timeout=60,
        )
    return _llm


# Public alias so server.py can call get_llm() without touching private internals
def get_llm():
    """Public wrapper around _get_llm(). Use this in server.py."""
    return _get_llm()


# ─────────────────────────────────────────────
# 3. PROMPTS
# ─────────────────────────────────────────────

_PROMPT_DEFAULTS = {
    "chat_system": (
        "You are a Legal Compliance AI specializing in Indian data protection law. "
        "'DPDP' means the Digital Personal Data Protection Act 2023. "
    ),
    "analyzer_chunk": """\
You are a data protection compliance expert analyzing one section of a privacy \
policy against the DPDP Act 2023 and GDPR and IT act 2000.

Retrieved Legal Context (from law database):
{context}

Policy Section:
{policy_chunk}

Evaluate this section against the legal context above.
Be balanced, practical, and evidence-based.

Rules:
- Only flag issues clearly supported by the policy text and retrieved law
- Do not assume every GDPR obligation applies unless the section suggests EU-facing processing
- Do not treat advanced or conditional obligations as universally mandatory
- Do not require a DPO, multilingual notice, cross-border transfer clause, or children's-data safeguards unless the policy text clearly makes them relevant
- If a clause is partially compliant, mention it under Strengths and note the specific limitation under Gaps
- Use Missing Elements only for items that appear absent from this section and are usually expected for a realistic privacy notice
- Do not punish normal drafting style differences when the substance is present
- Prefer fewer high-quality findings over many speculative findings

List findings under three headings:
  Strengths        — what this section does correctly
  Gaps             — clauses present but non-compliant or incomplete
  Missing Elements — legally required items entirely absent

Be concise. Each bullet ≤ 25 words.
If this section is substantially compliant and raises no material issue, reply exactly: NO_FINDINGS

Findings:\
""",
    "analyzer_report": """\
You are a data protection compliance expert.
Below are section-by-section findings from analyzing a privacy policy \
against DPDP Act 2023 and GDPR and IT act. Synthesize them into one report.
Deduplicate repeated issues. Ignore sections marked NO_FINDINGS.

Scoring policy:
- Score realistically for a decent real-world privacy policy, not an ideal academic template
- Do not double-count the same underlying issue across multiple sections
- Do not heavily penalize advanced or conditional obligations unless clearly triggered
- Missing core transparency, rights, retention, security, sharing, or contact clauses should matter more than stylistic imperfections
- A policy with clear notice, purpose, sharing, rights, retention, security, and contact details should usually land in Good or Excellent unless major gaps exist
- Do not heavily penalize missing DPO details, multilingual notices, or children's-data clauses unless the policy clearly triggers those requirements

Section Findings:
{all_findings}

Return ONLY this exact JSON (no markdown, no preamble, no trailing text):
{{
  "score": <integer 0-100>,
  "grade": "<Poor|Fair|Good|Excellent>",
  "summary": "<2-sentence plain-English summary>",
  "strengths": ["<strength>", ...],
  "gaps": [
    {{
      "issue": "<specific non-compliant or incomplete clause>",
      "severity": "<High|Medium|Low>",
      "suggestion": "<concrete fix in ≤ 20 words>",
      "act": "<DPDP|GDPR|IT act|Both>",
      "section": "<e.g. DPDP Section 6, GDPR Article 13>"
    }}
  ],
  "missing_elements": [
    {{
      "element": "<what is entirely absent>",
      "act": "<DPDP|GDPR|IT act|Both>",
      "section": "<e.g. DPDP Section 11, GDPR Article 17>"
    }}
  ]
}}

JSON:\
""",
    "compliance_system": """You are Vigilex AI, an expert legal assistant specializing in data protection laws.

You have deep expertise in:
- India's Digital Personal Data Protection (DPDP) Act, 2023
- GDPR (EU General Data Protection Regulation)
- India's IT Act 2000 and IT Rules 2011

Rules:
1. Always explain in simple, clear language — avoid jargon
2. When relevant, cite specific sections or articles
3. Structure longer answers with clear headings
4. Always note if something varies by jurisdiction or organization size
5. Never give legal advice — always suggest consulting a lawyer for specific situations
6. Be concise but complete
7. Use bullet points for lists of requirements or rights""",
}


def _load_prompt_config() -> dict[str, str]:
    """Return current prompt config, falling back to built-in defaults."""
    prompts = dict(_PROMPT_DEFAULTS)
    if not PROMPTS_PATH.exists():
        return prompts

    try:
        raw = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"⚠️  [PROMPTS] Could not read prompts.json: {exc}")
        return prompts

    if isinstance(raw, dict):
        for key, value in raw.items():
            if key in prompts and isinstance(value, str) and value.strip():
                prompts[key] = value
    return prompts


def _get_prompt(name: str) -> str:
    return _load_prompt_config().get(name, _PROMPT_DEFAULTS[name])


def _render_prompt(template: str, replacements: dict[str, str]) -> str:
    """Safely replace only the placeholders we explicitly support."""
    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(f"{{{key}}}", value)
    return rendered

# Used by ask_legal_bot() — chat panel Q&A
_CHAT_SYSTEM = _PROMPT_DEFAULTS["chat_system"]

# Used by analyze_policy() — Map Phase (per chunk)
_CHUNK_ANALYSIS_PROMPT = _PROMPT_DEFAULTS["analyzer_chunk"]

# Used by analyze_policy() — Reduce Phase (aggregate all chunk findings)
_FINAL_REPORT_PROMPT = _PROMPT_DEFAULTS["analyzer_report"]

# Maximum chars of combined findings we send to the reduce LLM call.
# gpt-4o-mini context window is ~128k tokens ≈ ~500k chars,
# but keeping it tight avoids latency and cost spikes.
_MAX_FINDINGS_CHARS = 18_000


# ─────────────────────────────────────────────
# 4. TEXT CLEANING
# ─────────────────────────────────────────────
def clean_policy_text(text: str) -> str:
    """
    Sanitize raw policy text before analysis.

    Handles: HTML tags/entities, URLs, repeated dividers, whitespace.
    Does NOT strip non-ASCII — uses Unicode normalization instead so
    Indian-language text (Devanagari, Tamil, etc.) is preserved.
    """
    # Strip HTML tags
    text = re.sub(r"<[^>]+>", " ", text)

    # Remove HTML entities (&nbsp; &amp; &#160; etc.)
    text = re.sub(r"&[a-zA-Z]{2,6};", " ", text)
    text = re.sub(r"&#\d{1,5};", " ", text)

    # Remove bare URLs (noise, not compliance content)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"www\.\S+", "", text)

    # Normalize Unicode (NFC): compose accented chars, fix encoding artifacts.
    # This replaces the old encode("ascii","ignore") which silently deleted
    # all Indian-language characters — a serious bug for DPDP compliance tool.
    text = unicodedata.normalize("NFC", text)

    # Remove repeated dividers (----, ====, ____)
    text = re.sub(r"[-_=]{3,}", " ", text)

    # Collapse whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)

    return text.strip()


# ─────────────────────────────────────────────
# 5. POLICY CHUNKING
# ─────────────────────────────────────────────
def chunk_policy(
    text: str,
    chunk_size: int = 1800,
    overlap: int = 150,
) -> list[str]:
    """
    Split policy text into overlapping chunks that snap to
    paragraph / sentence boundaries where possible.

    chunk_size=1800 (not 2000) keeps each LLM call well inside the
    context window even after prepending the legal context (~600 chars).

    overlap=150 ensures clauses spanning a boundary aren't missed.

    BUG FIX: original code used  start = end - overlap  which could
    move start backward when the boundary-snap pulled end far left,
    causing an infinite loop.  Fix:  start = max(end - overlap, prev_end)
    which guarantees forward progress on every iteration.
    """
    chunks    = []
    start     = 0
    length    = len(text)
    prev_end  = 0          # tracks furthest position reached

    while start < length:
        end = min(start + chunk_size, length)

        # Snap to a clean boundary only when not at end of text
        if end < length:
            snap = text.rfind("\n\n", start, end)
            if snap == -1:
                snap = text.rfind(". ", start, end)
            # Only accept the snap if it leaves a chunk of at least 200 chars
            if snap != -1 and (snap - start) >= 200:
                end = snap + 1

        chunk = text[start:end].strip()
        if len(chunk) > 50:          # skip near-empty artifacts
            chunks.append(chunk)

        # KEY FIX: guaranteed forward progress — start can never go backward
        start    = max(end - overlap, prev_end + 1)
        prev_end = end

    return chunks


# ─────────────────────────────────────────────
# 6. DOCUMENT DEDUPLICATION HELPER
# ─────────────────────────────────────────────
def _doc_fingerprint(page_content: str) -> str:
    """
    Stable fingerprint for deduplication across chunks.
    Uses MD5 of full content — much more reliable than [:120] prefix
    which can collide on templated legal text with identical headers.
    """
    return hashlib.md5(page_content.encode("utf-8")).hexdigest()


def _parse_json_object(text: str) -> dict:
    """Best-effort JSON object extraction for LLM responses."""
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            parsed = json.loads(text[start:end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _clean_issue_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


def _classify_theme(text: str) -> str:
    """Map findings to broad compliance themes so we don't over-penalize duplicates."""
    t = _clean_issue_text(text)

    theme_rules = (
        ("consent", ("consent", "withdraw consent", "lawful basis", "lawful processing")),
        ("notice", ("notice", "transparency", "privacy notice", "inform", "at collection")),
        ("rights", ("right", "access", "erasure", "deletion", "rectif", "portability", "grievance", "complaint")),
        ("retention", ("retain", "retention", "storage limitation", "delete", "deletion schedule")),
        ("security", ("security", "safeguard", "encryption", "access control", "incident response")),
        ("sharing", ("share", "third part", "recipient", "processor", "vendor", "disclose")),
        ("breach", ("breach", "incident", "notify", "notification")),
        ("children", ("child", "children", "minor", "parent", "guardian", "age-appropriate")),
        ("transfers", ("cross-border", "transfer", "international transfer", "overseas")),
        ("contact", ("contact", "grievance officer", "privacy team", "email", "address")),
        ("dpo", ("data protection officer", "dpo")),
        ("language", ("multiple languages", "multilingual", "local language", "language notice")),
        ("purpose", ("purpose", "specified", "legitimate purpose", "use data for")),
    )

    for theme, keywords in theme_rules:
        if any(keyword in t for keyword in keywords):
            return theme
    return "general"


def _severity_weight(level: str) -> int:
    level = (level or "").strip().lower()
    if level == "high":
        return 10
    if level == "medium":
        return 6
    if level == "low":
        return 1
    return 3


def _missing_theme_weight(theme: str) -> int:
    if theme in {"notice", "rights", "retention", "security", "sharing", "contact", "consent", "purpose"}:
        return 8
    if theme in {"breach", "children", "transfers"}:
        return 3
    if theme in {"dpo", "language"}:
        return 1
    return 3


def _is_conditional_or_advanced(text: str) -> bool:
    t = _clean_issue_text(text)
    advanced_markers = (
        "data protection officer",
        "dpo",
        "multiple languages",
        "multilingual",
        "cross-border",
        "international transfer",
        "child",
        "children",
        "minor",
        "guardian",
    )
    return any(marker in t for marker in advanced_markers)


def _grade_for_score(score: int) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 50:
        return "Fair"
    return "Poor"


def _recalculate_report_score(report: dict, policy_length: int) -> dict:
    """
    Recompute a realistic score from normalized findings instead of trusting the LLM's raw score.
    This makes scoring stable across runs and reduces over-strict grading.
    """
    gaps = report.get("gaps")
    missing = report.get("missing_elements")
    strengths = report.get("strengths")

    if not isinstance(gaps, list):
        gaps = []
    if not isinstance(missing, list):
        missing = []
    if not isinstance(strengths, list):
        strengths = []

    report["gaps"] = [item for item in gaps if isinstance(item, dict)]
    report["missing_elements"] = [item for item in missing if isinstance(item, dict)]
    report["strengths"] = [item for item in strengths if isinstance(item, str) and item.strip()]

    score = 100
    theme_penalties: dict[str, int] = {}
    seen_gap_texts = set()
    seen_missing_texts = set()
    applied_gap_count = 0
    applied_missing_count = 0

    for gap in report["gaps"]:
        issue = gap.get("issue", "")
        normalized = _clean_issue_text(issue)
        if not normalized or normalized in seen_gap_texts:
            continue
        seen_gap_texts.add(normalized)

        severity = gap.get("severity", "Medium")
        theme = _classify_theme(" ".join(filter(None, [issue, gap.get("section", ""), gap.get("suggestion", "")])))
        penalty = _severity_weight(severity)
        if _is_conditional_or_advanced(" ".join(filter(None, [issue, gap.get("section", ""), gap.get("suggestion", "")]))):
            penalty = max(1, penalty // 2)

        # Repeated gaps in one theme should not stack too aggressively.
        prior = theme_penalties.get(theme, 0)
        applied = penalty if prior == 0 else max(1, penalty // 3)
        theme_penalties[theme] = prior + applied
        score -= applied
        applied_gap_count += 1

    for item in report["missing_elements"]:
        element = item.get("element", "")
        normalized = _clean_issue_text(element)
        if not normalized or normalized in seen_missing_texts:
            continue
        seen_missing_texts.add(normalized)

        theme = _classify_theme(" ".join(filter(None, [element, item.get("section", "")])))
        penalty = _missing_theme_weight(theme)
        if _is_conditional_or_advanced(" ".join(filter(None, [element, item.get("section", "")]))):
            penalty = min(penalty, 2)

        # Missing items should matter, but duplicate variants of the same core theme should be softened.
        prior = theme_penalties.get(theme, 0)
        applied = penalty if prior == 0 else max(1, penalty // 2)
        theme_penalties[theme] = prior + applied
        score -= applied
        applied_missing_count += 1

    # Reward meaningful strengths, but cap the bonus so it can't erase major gaps.
    meaningful_strengths = min(len(report["strengths"]), 2)
    score += meaningful_strengths

    # Weak policies usually produce many distinct issues; apply a modest density penalty
    # so broad-but-vague notices don't sit unrealistically high.
    total_issues = applied_gap_count + applied_missing_count
    if total_issues >= 5:
        score -= min(8, total_issues - 4)

    # Give modest credit to fuller policies that cover many standard sections.
    if policy_length >= 2500:
        score += 1
    if policy_length >= 4500:
        score += 1

    # Ensure a policy with no findings is scored as excellent rather than arbitrary.
    if not report["gaps"] and not report["missing_elements"]:
        score = max(score, 92)

    score = max(0, min(100, int(round(score))))
    report["score"] = score
    report["grade"] = _grade_for_score(score)
    return report


# ─────────────────────────────────────────────
# 7. MAP PHASE: analyze one policy chunk
# ─────────────────────────────────────────────
def _analyze_chunk(
    chunk: str,
    idx: int,
    total: int,
    k: int = 4,
) -> tuple[str, list[str]]:
    """
    Retrieve relevant law chunks for one policy section,
    then ask the LLM to identify compliance findings.

    k=4 retrieves a slightly broader legal context per policy chunk.
    Using MMR keeps the retrieved passages more diverse, which helps
    reduce over-strict findings caused by one narrow law snippet.

    Returns:
        findings_block : str   formatted findings text
        sources        : list  source filenames cited
    """
    db        = _get_vector_db()
    llm       = _get_llm()
    retriever = db.as_retriever(
        search_type="mmr",
        search_kwargs={"k": k, "fetch_k": max(8, k * 2)},
    )

    docs = retriever.invoke(chunk)

    # Deduplicate retrieved docs by full-content hash
    seen_fps   = set()
    law_chunks = []
    sources    = []

    for doc in docs:
        fp = _doc_fingerprint(doc.page_content)
        if fp not in seen_fps:
            seen_fps.add(fp)
            law_chunks.append(doc)
            src = doc.metadata.get("source", "Unknown")
            if src not in sources:
                sources.append(src)

    # Build context string
    context_parts = [
        f"[{doc.metadata.get('source','Unknown')}, p.{doc.metadata.get('page','?')}]\n"
        f"{doc.page_content}"
        for doc in law_chunks
    ]
    context_str = "\n\n---\n\n".join(context_parts)

    prompt   = _render_prompt(
        _get_prompt("analyzer_chunk"),
        {
            "context": context_str,
            "policy_chunk": chunk,
        },
    )
    response = llm.invoke(prompt)
    answer   = response.content.strip()

    print(
        f"   ✅ Chunk {idx+1}/{total}: "
        f"{len(law_chunks)} law refs, {len(answer)} chars output"
    )

    findings_block = f"--- SECTION {idx+1}/{total} ---\n{answer}\n"
    return findings_block, sources


# ─────────────────────────────────────────────
# 8. MAIN ANALYSIS FUNCTION (Map → Reduce)
# ─────────────────────────────────────────────
def analyze_policy(raw_policy_text: str) -> tuple[str, list[str]]:
    """
    Full map-reduce compliance analysis pipeline.

    Steps:
      1  Clean raw text
      2  Chunk into overlapping 1800-char sections
      3  Map:    for each chunk → retrieve law → LLM findings
      4  Reduce: combine all findings → one final JSON report

    Args:
        raw_policy_text: raw text from file upload or paste box

    Returns:
        (json_string, sources_list)
        json_string matches the schema in _FINAL_REPORT_PROMPT
    """
    print("\n" + "=" * 60)
    print("🏛️  [ANALYZER] Starting MAP-REDUCE pipeline")
    print("=" * 60)

    # ── Step 1: Clean ────────────────────────────────────────
    cleaned = clean_policy_text(raw_policy_text)
    print(f"✂️  Cleaned: {len(raw_policy_text):,} → {len(cleaned):,} chars")

    if len(cleaned) < 100:
        raise ValueError(
            "Policy text is too short after cleaning (< 100 chars). "
            "Please check the uploaded file or pasted text."
        )

    # ── Step 2: Chunk ────────────────────────────────────────
    chunks = chunk_policy(cleaned, chunk_size=1800, overlap=150)
    print(f"📄 Chunked into {len(chunks)} sections")

    # ── Step 3: Map Phase (sequential — correct choice for 8 GB RAM) ───
    # Parallel execution (ThreadPoolExecutor) would spike RAM by N×chunk
    # simultaneously. Sequential costs ~2-4 s extra on a 10-chunk policy
    # but stays safely within the memory budget.
    all_findings : list[str] = []
    all_sources  : list[str] = []

    print(f"\n🔎 Map Phase — {len(chunks)} chunks, sequential...")

    for i, chunk in enumerate(chunks):
        try:
            findings_block, sources = _analyze_chunk(chunk, i, len(chunks))
            all_findings.append(findings_block)
            for src in sources:
                if src not in all_sources:
                    all_sources.append(src)
        except Exception as exc:
            # Don't abort the whole analysis for one bad chunk — log and skip
            print(f"⚠️  Chunk {i+1} failed: {exc}")
            all_findings.append(f"--- SECTION {i+1}/{len(chunks)} ---\nNO_FINDINGS\n")

        # Explicit GC after each chunk: frees embedding vectors + LLM response
        # objects that are no longer needed.  On 8 GB this keeps the RSS flat
        # throughout the map phase instead of slowly climbing.
        gc.collect()

    # ── Step 4: Reduce Phase ─────────────────────────────────
    combined = "\n\n".join(all_findings)

    # Context guard: if combined findings exceed the safe limit, truncate.
    # We keep the tail (most recent sections) because reduce reads forward,
    # and the truncation point is always at a section boundary.
    if len(combined) > _MAX_FINDINGS_CHARS:
        print(
            f"⚠️  Findings too large ({len(combined):,} chars); "
            f"truncating to {_MAX_FINDINGS_CHARS:,} chars for reduce call."
        )
        # Truncate from the front — keep the last N chars which cover the
        # most sections.  Find the nearest section header to avoid cutting
        # mid-sentence.
        truncated = combined[-_MAX_FINDINGS_CHARS:]
        boundary  = truncated.find("--- SECTION")
        if boundary > 0:
            truncated = truncated[boundary:]
        combined = "[Earlier sections omitted due to length]\n\n" + truncated

    print(f"\n🤖 Reduce Phase — aggregating {len(all_findings)} section findings...")
    llm    = _get_llm()
    prompt = _render_prompt(
        _get_prompt("analyzer_report"),
        {
            "all_findings": combined,
        },
    )

    response = llm.invoke(prompt)
    answer   = response.content.strip()

    # Strip accidental markdown fences the model sometimes adds
    answer = re.sub(r"^```(?:json)?\s*", "", answer, flags=re.IGNORECASE)
    answer = re.sub(r"\s*```\s*$",       "", answer)
    answer = answer.strip()

    report = _parse_json_object(answer)
    if report:
        report = _recalculate_report_score(report, len(cleaned))
        answer = json.dumps(report, ensure_ascii=False)

    unique_sources = list(dict.fromkeys(all_sources))   # preserve order, dedup

    print(f"✅ Report generated ({len(answer):,} chars)")
    print("=" * 60 + "\n")

    gc.collect()
    return answer, unique_sources


# ─────────────────────────────────────────────
# 9. CHAT BOT  (used by /api/chat)
# ─────────────────────────────────────────────
def ask_legal_bot(
    question: str,
    history: Optional[list[dict]] = None,
    retrieval_query: Optional[str] = None,
    trace_label: str = "CHAT",
) -> tuple[str, list[str]]:
    """
    Standard RAG Q&A for the chat panel.

    Migrated from the deprecated RetrievalQA chain to a direct
    retriever + llm.invoke() pattern — same as analyze_policy,
    so the codebase has one consistent style.

    Args:
        question        : the user's question
        history         : optional list of {"role": ..., "content": ...} dicts
                          for multi-turn conversations
        retrieval_query : if provided, use this for ChromaDB search instead
                          of the raw question (useful for rephrased queries)
        trace_label     : prefix for console logs

    Returns:
        (answer_string, sources_list)
    """
    db  = _get_vector_db()
    llm = _get_llm()

    query_for_retrieval = (retrieval_query or question).strip()

    print(f"\n🧠 [{trace_label}] Question ({len(question)} chars): "
          f"{question[:120].replace(chr(10),' ')}...")
    print(f"🔎 [{trace_label}] Retrieval query: "
          f"{query_for_retrieval[:120].replace(chr(10),' ')}...")

    retriever = db.as_retriever(search_kwargs={"k": 5})
    docs      = retriever.invoke(query_for_retrieval)

    if not docs:
        print(f"⚠️  [{trace_label}] No matching documents found.")
        return (
            "I could not find relevant legal context for your question. "
            "Please try rephrasing, or check that ingest.py has been run.",
            [],
        )

    print(f"✅ [{trace_label}] Retrieved {len(docs)} law chunks:")
    for i, doc in enumerate(docs):
        src     = doc.metadata.get("source", "Unknown")
        pg      = doc.metadata.get("page", "?")
        snippet = doc.page_content[:70].replace("\n", " ")
        print(f"   {i+1}. {src} p.{pg} | {snippet}...")

    # Build context block from retrieved docs
    context_parts = [
        f"[{doc.metadata.get('source','Unknown')}, p.{doc.metadata.get('page','?')}]\n"
        f"{doc.page_content}"
        for doc in docs
    ]
    context_str = "\n\n---\n\n".join(context_parts)

    # Build message list for the LLM
    messages: list[dict] = [{"role": "system", "content": _get_prompt("chat_system")}]

    # Inject prior conversation turns if supplied
    if history:
        messages.extend(history)

    # Final user turn with retrieved context + question
    user_turn = (
        f"Legal Context:\n{context_str}\n\n"
        f"Question: {question}\n\n"
        f"Answer:"
    )
    messages.append({"role": "user", "content": user_turn})

    response = llm.invoke(messages)
    answer   = response.content.strip()

    sources = list(dict.fromkeys(
        doc.metadata.get("source", "Unknown") for doc in docs
    ))

    return answer, sources


# ─────────────────────────────────────────────
# STANDALONE TEST
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("\n--- ⚖️  Vigilex AI: Standalone Test ---")

    # Quick chat test
    test_q = "What is a Data Fiduciary under DPDP?"
    print(f"\nQ: {test_q}")
    ans, src = ask_legal_bot(test_q)
    print(f"\n🤖 Answer:\n{ans}")
    print(f"\n📚 Sources: {src}")

    print("\n💡 To start the server run: python server.py")
