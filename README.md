# Moving Assistant Demo

A static GitHub Pages bundle containing two browser-only prototypes:

- `assistant/` — guided move planning, timeline, route comparison and local scripted responses
- `wizard/` — 3D packing visualization and truck comparison

The bundle does not require VS Code, Python, Node, an API key or a server. It is intended for demonstration and exploration. Estimates and route examples are illustrative and are not live rental pricing, availability or safety instructions.

## Publish with GitHub Pages

1. Create or open the personal GitHub repository where this demo should live.
2. Copy the contents of this folder into the repository root. Keep `index.html`, `assistant/`, and `wizard/` together.
3. Commit and push the files to the default branch.
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the default branch and the `/ (root)` folder, then save.
7. Wait for the Pages deployment, then open the URL GitHub provides.

The main URL opens `index.html`; the two demo routes are linked relatively, so they also work when the repository is published as a project site such as `https://username.github.io/repository-name/`.

## Local preview

From this folder, run a simple static server if desired:

```powershell
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.
