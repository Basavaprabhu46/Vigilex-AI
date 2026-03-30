import os
import re
import glob
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document

# 1. SETTINGS
DATA_PATH = "data/"
DB_PATH = "chroma_db/"

def clean_legal_text(text):
    """
    Cleans noise specifically found in Indian Gazette and legal PDFs.
    Removes Hindi and non-ASCII characters to keep the database English-only.
    """
    # Remove Gazette Headers and Registration numbers
    text = re.sub(r"(REGISTERED NO\.|भारत का राजपत्र|THE GAZETTE OF INDIA|असाधारण|EXTRAORDINARY).*", "", text)
    
    # Remove bilingual Part/Section markers
    text = re.sub(r"\[भाग II—खण्ड.*?\]", "", text)
    
    # Remove random page numbers floating in newlines
    text = re.sub(r"\n\s*\d+\s*\n", "\n", text)
    
    # Join words split across lines
    text = re.sub(r"(\w+)-\s*\n\s*(\w+)", r"\1\2", text)
    
    # Remove Hindi characters (Keep only ASCII)
    text = text.encode("ascii", "ignore").decode()
    
    # Collapse multiple whitespaces and newlines
    text = re.sub(r'\s+', ' ', text)
    
    return text.strip()

def process_pdfs():
    # Looks for all PDFs in your data folder
    pdf_files = sorted(glob.glob(os.path.join(DATA_PATH, "*.pdf")))

    if not pdf_files:
        print(f"❌ No PDF files found in {DATA_PATH}. Please check your folder.")
        return

    all_cleaned_chunks = []
    # Standard legal chunk size
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)

    for file_path in pdf_files:
        file_name = os.path.basename(file_path)
        print(f"📖 Processing: {file_name}...")
        
        try:
            loader = PyPDFLoader(file_path)
            pages = loader.load()
            
            for page in pages:
                cleaned_content = clean_legal_text(page.page_content)
                
                # Skip pages that became empty (Hindi-only pages)
                if len(cleaned_content) < 50:
                    continue
                    
                page_chunks = text_splitter.split_text(cleaned_content)
                
                for chunk in page_chunks:
                    all_cleaned_chunks.append(
                        Document(
                            page_content=chunk, 
                            metadata={
                                "source": file_name, 
                                "page": page.metadata.get("page", "unknown")
                            }
                        )
                    )
        except Exception as e:
            print(f"⚠️ Error processing {file_name}: {e}")

    # 2. CREATE VECTOR DATABASE
    if all_cleaned_chunks:
        print(f"🚀 Creating Vector DB with {len(all_cleaned_chunks)} chunks...")
        
        # LOCAL EMBEDDINGS (No API Key Required, Runs on Mac)
        # 'all-MiniLM-L6-v2' is small, fast, and excellent for RAG
        embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        
        # Batching logic to keep memory stable on Mac
        batch_size = 100
        vector_db = None

        for i in range(0, len(all_cleaned_chunks), batch_size):
            batch = all_cleaned_chunks[i : i + batch_size]
            print(f"📦 Storing batch {i//batch_size + 1}...")
            
            if vector_db is None:
                vector_db = Chroma.from_documents(
                    documents=batch,
                    embedding=embeddings,
                    persist_directory=DB_PATH
                )
            else:
                vector_db.add_documents(documents=batch)
        
        print(f"✅ Success! Database saved to {DB_PATH}")
    else:
        print("❌ No content extracted. Database not created.")

if __name__ == "__main__":
    process_pdfs()