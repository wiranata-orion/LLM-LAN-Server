# Local LLM Agent Server

Backend Node.js + TypeScript untuk Agentic RAG dan tool calling di atas Ollama.

## Arsitektur

```text
agent-server/
  src/
    config.ts              # Validated environment configuration
    types.ts               # Shared domain contracts
    ollama.ts              # Ollama chat, embeddings, health client
    chunker.ts             # Paragraph/sentence-aware chunking
    vector-store.ts        # Persistent local JSON vector store
    memory-core.ts         # SQLite raw log + hybrid long-term memory
    ingestion.ts           # Documents -> chunks -> embeddings
    retriever.ts           # Similarity search
    orchestrator.ts        # RAG + tool decision/execution loop
    routes.ts              # HTTP endpoints and validation
    server.ts              # Express composition root
    tools/
      registry.ts          # JSON tool schemas sent to Ollama
      executor.ts          # Allowlisted tool handlers
  data/                    # Created at runtime, ignored by git
    memory_core.sqlite     # Portable raw conversation database
    vector-store.json      # Rebuildable semantic index
```

The vector store is local JSON, so no hosted vector database credentials are required. Ollama provides both chat and embedding models. The Vue UI calls this server at `http://127.0.0.1:8787/api` by default.

## Portable long-term memory

`data/memory_core.sqlite` is the source of truth for raw conversations. It contains the durable table:

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT NOT NULL
);
```

Every `/api/chat` request appends the latest user turn before inference and the final assistant turn after tool execution. The local vector store is a rebuildable acceleration layer; changing the LLM provider does not change the SQLite data.

Retrieval is hybrid: semantic cosine similarity from Ollama embeddings is combined with exact token overlap. If the embedding model is unavailable, exact keyword retrieval still works.

## Setup

```powershell
cd agent-server
Copy-Item .env.example .env
npm install
ollama pull llama3.2:latest
ollama pull nomic-embed-text:latest
npm run dev
```

Set `OLLAMA_CHAT_MODEL` to a chat-capable model installed on your Ollama engine. Do not use `nomic-embed-text` as the chat model.

## API

### Health

```powershell
curl http://127.0.0.1:8787/api/health
```

### Ingest documents

```powershell
curl -X POST http://127.0.0.1:8787/api/ingest `
  -H "Content-Type: application/json" `
  -d '{"documents":[{"source":"notes/profile.txt","content":"Local LLM deployments use Ollama on a private network.","metadata":{"category":"notes"}}]}'
```

The endpoint chunks each document, creates embeddings with `OLLAMA_EMBED_MODEL`, and persists records in `VECTOR_STORE_PATH`.

### Agent chat

```powershell
curl -X POST http://127.0.0.1:8787/api/chat `
  -H "Content-Type: application/json" `
  -d '{"messages":[{"role":"user","content":"What do my local deployment notes say? Calculate (18 + 6) / 3 too."}]}'
```

The response contains `message`, `toolRounds`, and `retrievedChunks`. The orchestrator sends declared tools to Ollama, executes only registered tools, appends tool results, and asks Ollama for the final answer.

### Export memory

```powershell
curl http://127.0.0.1:8787/api/memory/export -o memory.jsonl
```

The export is newline-delimited JSON and contains every SQLite conversation row, including metadata.

### Import memory on another machine

```powershell
curl -X POST http://127.0.0.1:8787/api/memory/import `
  -H "Content-Type: application/jsonl" `
  --data-binary "@memory.jsonl"
```

Import is idempotent by record ID and regenerates semantic vectors when `nomic-embed-text` is available. Copying `memory_core.sqlite` directly is also supported when SQLite versions and filesystem permissions are compatible.

## Configuration

Copy `.env.example` to `.env` and adjust:

- `OLLAMA_BASE_URL`: active Ollama server.
- `OLLAMA_CHAT_MODEL`: chat-capable model.
- `OLLAMA_EMBED_MODEL`: embedding model, normally `nomic-embed-text:latest`.
- `MEMORY_ROOT`: reserved local data root.
- `VECTOR_STORE_PATH`: persistent vector JSON path.
- `MAX_RETRIEVED_CHUNKS` and `RAG_MIN_SCORE`: retrieval controls.
- `MAX_TOOL_ROUNDS`: loop safety limit.
- `CORS_ORIGIN`: allowed frontend origin.

## Validation

```powershell
npm run typecheck
npm run build
```
