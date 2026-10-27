# Moving Assistant

A Penske-focused moving assistant prototype with two guided experiences:

- A three-month apartment move conversation that produces an interactive timeline.
- A Columbus couch pickup conversation with route comparisons, mileage estimates, clearance warnings, and a couch-only 3D truck handoff.

## Run locally

Start the assistant locally:

```powershell
$env:PORT = "4173"
python .\assistant\server.py
```

Open `http://127.0.0.1:4173/`.

For temporary LAN sharing, use the computer's LAN IP and bind to all interfaces:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "4173"
python .\assistant\server.py
```

Allow Python through Windows Firewall if prompted, then share `http://<computer-lan-ip>:4173/`. Start the simulator on port `4182` as shown below and share the same LAN IP for its link.

Start the 3D truck prototype separately:

```powershell
python -m http.server 4173 --directory .\prototype
```

Open `http://127.0.0.1:4173/`.

## RAG architecture

The assistant uses local Penske corpus retrieval with optional Bedrock, SageAI, or OpenAI-compatible generation and web-search fallback. See [assistant/README.md](assistant/README.md) for provider configuration and private-document handling.

Do not commit `.env`, credentials, private move-in documents, or generated Python cache files.
