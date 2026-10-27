# Personal Moving Assistant

The assistant has a retrieval-first API and browser prototype.

## Run locally

Node is optional. This workspace includes a standard-library Python server:

```powershell
$env:PORT = "4176"
python .\assistant\server.py
```

Open `http://127.0.0.1:4176/`.

Copy `.env.example` to `.env` and add provider credentials locally. Never commit `.env`.

- `OPENAI_API_KEY` enables grounded LLM answers.
- `OPENAI_BASE_URL` supports OpenAI-compatible providers.
- `OPENAI_MODEL` selects the model.
- `BRAVE_SEARCH_API_KEY` enables the preferred Penske-scoped web fallback. `BRAVE_API_KEY` is also accepted as an alias.
- `BRAVE_SEARCH_URL` optionally overrides the Brave endpoint; the default is `https://api.search.brave.com/res/v1/web/search`.
- `SERPER_API_KEY` enables Google-result search through Serper and takes priority over Brave and legacy Bing when configured.
- `BING_SEARCH_API_KEY` remains a legacy fallback if Brave is not configured.
- `SAGE_*` variables configure the internal SageAI provider. The adapter uses the client-credentials token endpoint and Sage converse endpoint from the supplied `sageai.py` implementation.

Without keys, `/api/chat` still retrieves from the local Penske corpus.

The Sage credentials pasted into chat should be rotated because they are exposed. After rotation, configure replacement values only in a local `.env` file. The adapter receives retrieved Penske chunks and the private move profile, while web search remains a fallback for missing public information.

## Private move-in documents

Apartment welcome letters, lease instructions, payment amounts, utility account numbers, insurance requirements, pet records and contact details are private user data. They must not be added to the public Penske corpus or sent to web search.

`move-in-document.schema.json` defines the normalized form for turning a private letter into an editable checklist. A future document-ingestion route should parse the uploaded PDF locally, ask the user to verify extracted dates and money, and then store the normalized document separately from public RAG chunks.
