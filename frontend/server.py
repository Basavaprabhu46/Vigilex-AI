"""
server.py
Flask backend for Vigilex AI.

ROUTES
──────────────────────────────────────────────────────────
GET  /                          → serves index.html
POST /api/chat                  → RAG Q&A  (brain.ask_legal_bot)
POST /api/upload-policy         → file extraction (PDF/TXT → clean text)
POST /api/analyze-rag           → full RAG compliance analysis (brain.analyze_policy)
POST /api/analyze               → direct LLM, no RAG (compliance panel chat)
GET  /api/health                → sanity check
──────────────────────────────────────────────────────────

FIX: server.py no longer imports `llm` or `clean_policy_text` directly from brain.
     brain.py now uses lazy globals — nothing is module-level anymore.
     Instead we import the three public functions:
       ask_legal_bot, analyze_policy, clean_policy_text
     and call _get_llm() through a thin get_llm() helper exposed by brain.
"""

import os
import json
import pathlib
import tempfile

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from brain import ask_legal_bot, analyze_policy, clean_policy_text, get_llm

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT_DIR / "config"
PROMPTS_PATH = PROMPTS_DIR / "prompts.json"
PROMPTS_DEFAULTS_PATH = PROMPTS_DIR / "prompts.defaults.json"
PROMPT_KEYS = (
    "chat_system",
    "analyzer_chunk",
    "analyzer_report",
    "compliance_system",
)
PROMPT_REQUIRED_TOKENS = {
    "analyzer_chunk": ("{context}", "{policy_chunk}"),
    "analyzer_report": ("{all_findings}",),
}
PROMPT_DEFAULTS = {
    "chat_system": "You are a Legal Compliance AI specializing in Indian data protection law. ",
    "analyzer_chunk": "You are a data protection compliance expert analyzing one section of a privacy policy against the DPDP Act 2023 and GDPR.\n\nRetrieved Legal Context (from law database):\n{context}\n\nPolicy Section:\n{policy_chunk}\n\nEvaluate this section against the legal context above.\nBe balanced, practical, and evidence-based.\n\nRules:\n- Only flag issues clearly supported by the policy text and retrieved law\n- Do not assume every GDPR obligation applies unless the section suggests EU-facing processing\n- Do not treat advanced or conditional obligations as universally mandatory\n- Do not require a DPO, multilingual notice, cross-border transfer clause, or children's-data safeguards unless the policy text clearly makes them relevant\n- If a clause is partially compliant, mention it under Strengths and note the specific limitation under Gaps\n- Use Missing Elements only for items that appear absent from this section and are usually expected for a realistic privacy notice\n- Do not punish normal drafting style differences when the substance is present\n- Prefer fewer high-quality findings over many speculative findings\n\nList findings under three headings:\n  Strengths        — what this section does correctly\n  Gaps             — clauses present but non-compliant or incomplete\n  Missing Elements — legally required items entirely absent\n\nBe concise. Each bullet ≤ 25 words.\nIf this section is substantially compliant and raises no material issue, reply exactly: NO_FINDINGS\n\nFindings:",
    "analyzer_report": "You are a data protection compliance expert.\nBelow are section-by-section findings from analyzing a privacy policy against DPDP Act 2023 and GDPR. Synthesize them into one report.\nDeduplicate repeated issues. Ignore sections marked NO_FINDINGS.\n\nScoring policy:\n- Score realistically for a decent real-world privacy policy, not an ideal academic template\n- Do not double-count the same underlying issue across multiple sections\n- Do not heavily penalize advanced or conditional obligations unless clearly triggered\n- Missing core transparency, rights, retention, security, sharing, or contact clauses should matter more than stylistic imperfections\n- A policy with clear notice, purpose, sharing, rights, retention, security, and contact details should usually land in Good or Excellent unless major gaps exist\n- Do not heavily penalize missing DPO details, multilingual notices, or children's-data clauses unless the policy clearly triggers those requirements\n\nSection Findings:\n{all_findings}\n\nReturn ONLY this exact JSON (no markdown, no preamble, no trailing text):\n{\n  \"score\": <integer 0-100>,\n  \"grade\": \"<Poor|Fair|Good|Excellent>\",\n  \"summary\": \"<2-sentence plain-English summary>\",\n  \"strengths\": [\"<strength>\", ...],\n  \"gaps\": [\n    {\n      \"issue\": \"<specific non-compliant or incomplete clause>\",\n      \"severity\": \"<High|Medium|Low>\",\n      \"suggestion\": \"<concrete fix in ≤ 20 words>\",\n      \"act\": \"<DPDP|GDPR|Both>\",\n      \"section\": \"<e.g. DPDP Section 6, GDPR Article 13>\"\n    }\n  ],\n  \"missing_elements\": [\n    {\n      \"element\": \"<what is entirely absent>\",\n      \"act\": \"<DPDP|GDPR|Both>\",\n      \"section\": \"<e.g. DPDP Section 11, GDPR Article 17>\"\n    }\n  ]\n}\n\nJSON:",
    "compliance_system": "You are Vigilex AI, an expert legal assistant specializing in data protection laws.\n\nYou have deep expertise in:\n- India's Digital Personal Data Protection (DPDP) Act, 2023\n- GDPR (EU General Data Protection Regulation)\n- India's IT Act 2000 and IT Rules 2011\n\nRules:\n1. Always explain in simple, clear language — avoid jargon\n2. When relevant, cite specific sections or articles\n3. Structure longer answers with clear headings\n4. Always note if something varies by jurisdiction or organization size\n5. Never give legal advice — always suggest consulting a lawyer for specific situations\n6. Be concise but complete\n7. Use bullet points for lists of requirements or rights",
}


def load_prompt_defaults():
    defaults = dict(PROMPT_DEFAULTS)
    if PROMPTS_DEFAULTS_PATH.exists():
        try:
            raw = json.loads(PROMPTS_DEFAULTS_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for key in PROMPT_KEYS:
                    value = raw.get(key)
                    if isinstance(value, str) and value.strip():
                        defaults[key] = value
        except Exception as exc:
            print(f"⚠️  [PROMPTS] Could not read defaults: {exc}")
    return defaults


def load_prompts():
    prompts = load_prompt_defaults()
    if PROMPTS_PATH.exists():
        try:
            raw = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for key in PROMPT_KEYS:
                    value = raw.get(key)
                    if isinstance(value, str) and value.strip():
                        prompts[key] = value
        except Exception as exc:
            print(f"⚠️  [PROMPTS] Could not read prompts.json: {exc}")
    return prompts


def validate_prompt(key, prompt_text):
    if key not in PROMPT_KEYS:
        raise ValueError(f"Unknown prompt key: {key}")
    if not isinstance(prompt_text, str) or not prompt_text.strip():
        raise ValueError(f"Prompt '{key}' cannot be empty")

    for token in PROMPT_REQUIRED_TOKENS.get(key, ()):
        if token not in prompt_text:
            raise ValueError(f"Prompt '{key}' must include {token}")


def save_prompts(prompts):
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {key: prompts[key] for key in PROMPT_KEYS}
    PROMPTS_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ─────────────────────────────────────────────
# STATIC SERVING
# ─────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/src/<path:path>')
def send_src(path):
    return send_from_directory('src', path)


# ─────────────────────────────────────────────
# /api/prompts — prompt editor support
# ─────────────────────────────────────────────
@app.route('/api/prompts', methods=['GET'])
def get_prompts():
    return jsonify({"prompts": load_prompts()})


@app.route('/api/prompts', methods=['POST'])
def update_prompts():
    try:
        data = request.get_json(force=True)
        updates = data.get("prompts") if isinstance(data, dict) else None

        if not isinstance(updates, dict) or not updates:
            return jsonify({"error": "Provide a non-empty 'prompts' object"}), 400

        prompts = load_prompts()
        for key, value in updates.items():
            validate_prompt(key, value)
            prompts[key] = value.strip()

        save_prompts(prompts)
        return jsonify({"status": "success", "prompts": prompts})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        print(f"❌ /api/prompts POST error: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route('/api/prompts/reset', methods=['POST'])
def reset_prompts():
    try:
        data = request.get_json(silent=True) or {}
        key = data.get("key")
        defaults = load_prompt_defaults()
        prompts = load_prompts()

        if key:
            if key not in PROMPT_KEYS:
                raise ValueError(f"Unknown prompt key: {key}")
            validate_prompt(key, defaults[key])
            prompts[key] = defaults[key]
        else:
            prompts = defaults

        save_prompts(prompts)
        return jsonify({"status": "success", "prompts": prompts})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        print(f"❌ /api/prompts/reset error: {exc}")
        return jsonify({"error": str(exc)}), 500


# ─────────────────────────────────────────────
# /api/chat — RAG Q&A for the chat panel
# ─────────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Request  : { "message": "What is DPDP?" }
    Response : { "answer": "...", "sources": [...] }
    """
    try:
        data = request.get_json(force=True)
        user_query = (data.get("message") or "").strip()

        if not user_query:
            return jsonify({"error": "No message provided"}), 400

        answer, sources = ask_legal_bot(user_query)
        return jsonify({"answer": answer, "sources": sources, "status": "success"})

    except Exception as e:
        print(f"❌ /api/chat error: {e}")
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# /api/analyze — direct LLM, compliance panel chat (no RAG)
# ─────────────────────────────────────────────
@app.route('/api/analyze', methods=['POST'])
def analyze():
    """
    Request  : { "messages": [{"role": "user", "content": "..."}] }
    Response : { "answer": "..." }

    Uses get_llm() — the public wrapper around brain's lazy _get_llm().
    Never imports `llm` directly (that module-level global no longer exists).
    """
    try:
        data = request.get_json(force=True)
        messages = data.get("messages", [])

        if not messages:
            return jsonify({"error": "No messages provided"}), 400

        lc_messages = [SystemMessage(content=load_prompts()["compliance_system"])]
        for m in messages:
            role    = m.get("role", "user")
            content = m.get("content", "")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            elif role == "system":
                lc_messages.append(SystemMessage(content=content))

        llm      = get_llm()          # lazy — initializes on first call
        response = llm.invoke(lc_messages)
        return jsonify({"answer": response.content})

    except Exception as e:
        print(f"❌ /api/analyze error: {e}")
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# /api/upload-policy — file extraction only (no analysis)
# ─────────────────────────────────────────────
@app.route('/api/upload-policy', methods=['POST'])
def upload_policy():
    """
    Accepts multipart file upload (.pdf or .txt).
    Returns clean text — no analysis yet.
    Frontend stores this and sends it when user clicks Analyze.

    Request  : multipart/form-data, field name "file"
    Response : { "text": "...", "char_count": N, "filename": "...", "pages"?: N }
    """
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded. Use field name 'file'."}), 400

        file     = request.files["file"]
        filename = file.filename or "uploaded_file"
        ext      = pathlib.Path(filename).suffix.lower()

        if ext not in (".pdf", ".txt"):
            return jsonify({"error": f"Unsupported file type '{ext}'. Use .pdf or .txt"}), 400

        print(f"\n📁 [UPLOAD] Received: {filename} ({ext})")

        # ── TXT: read directly ────────────────────────────────────
        if ext == ".txt":
            raw_text = file.read().decode("utf-8", errors="ignore")
            cleaned  = clean_policy_text(raw_text)
            print(f"✅ [UPLOAD] TXT: {len(cleaned):,} chars after cleaning")
            return jsonify({"text": cleaned, "char_count": len(cleaned), "filename": filename})

        # ── PDF: save to temp, use PyPDFLoader ───────────────────
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = tmp.name
            file.save(tmp_path)

        try:
            from langchain_community.document_loaders import PyPDFLoader
            pages    = PyPDFLoader(tmp_path).load()
            raw_text = "\n\n".join(p.page_content for p in pages)
            cleaned  = clean_policy_text(raw_text)
            print(f"✅ [UPLOAD] PDF: {len(pages)} pages → "
                  f"{len(raw_text):,} raw → {len(cleaned):,} cleaned chars")
            return jsonify({
                "text":       cleaned,
                "char_count": len(cleaned),
                "filename":   filename,
                "pages":      len(pages),
            })
        finally:
            os.unlink(tmp_path)

    except Exception as e:
        print(f"❌ /api/upload-policy error: {e}")
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# /api/analyze-rag — full RAG compliance analysis
# ─────────────────────────────────────────────
@app.route('/api/analyze-rag', methods=['POST'])
def analyze_rag():
    """
    Receives clean policy text, runs the full map-reduce pipeline.

    Request  : { "policy_text": "<full policy text>" }
    Response : { "answer": "<pure JSON string>", "sources": [...] }
    """
    try:
        data = request.get_json(force=True)

        # Support both new "policy_text" and old "prompt" field for compat
        policy_text = (data.get("policy_text") or data.get("prompt") or "").strip()

        if not policy_text:
            return jsonify({"error": "No policy_text provided"}), 400

        # Strip old-style prompt header if frontend hasn't been updated yet
        if "Privacy Policy Text:" in policy_text:
            print("⚠️  [ANALYZER] Old-style prompt detected — extracting policy text...")
            policy_text = policy_text.split("Privacy Policy Text:")[-1].strip()

        print(f"\n🏛️  [ANALYZER] Policy received: {len(policy_text):,} chars")

        answer, sources = analyze_policy(policy_text)
        return jsonify({"answer": answer, "sources": sources})

    except Exception as e:
        print(f"❌ /api/analyze-rag error: {e}")
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# /api/health
# ─────────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
def health():
    db_path = pathlib.Path(__file__).parent / "chroma_db"
    return jsonify({"status": "ok", "db_found": db_path.exists()})


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
if __name__ == '__main__':
    print("\n🚀 Vigilex AI backend starting on http://localhost:5001")
    print("   POST /api/chat            RAG Q&A")
    print("   POST /api/upload-policy   PDF/TXT extraction")
    print("   POST /api/analyze-rag     Full compliance analysis")
    print("   POST /api/analyze         Direct LLM chat")
    print("   GET  /api/health          Sanity check\n")
    app.run(host='0.0.0.0', port=5001, debug=True)
