const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

loadEnv(path.join(__dirname, '..', '.env'));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4174);
const CORPUS_PATH = path.join(ROOT, 'Context Docs', 'penske_rag_corpus_expanded.json');
const PUBLIC_DIR = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const stopWords = new Set('a an and are as at be before can do for from how i in is it me my of on or should the this to what when with you your'.split(' '));

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
function terms(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((term) => term.length > 2 && !stopWords.has(term)); }
function intentTags(value) {
  const query = value.toLowerCase(); const tags = [];
  if (/pet|dog|cat|animal|vet|crate/.test(query)) tags.push('pets');
  if (/kid|child|school|family/.test(query)) tags.push('kids', 'family');
  if (/truck size|which truck|cubic|room|capacity|mpg/.test(query)) tags.push('trucks', 'capacity');
  if (/drive|driving|route|clearance|parking|fuel|road/.test(query)) tags.push('driving', 'safety');
  if (/box|supply|tape|bubble|pad|packing/.test(query)) tags.push('supplies', 'packing');
  if (/load|loading|formation|heavy/.test(query)) tags.push('loading', 'i-formation');
  if (/storage|labor|helper|unload/.test(query)) tags.push('storage', 'moving-labor');
  if (/tow|car carrier|dolly/.test(query)) tags.push('towing');
  return tags;
}
function retrieve(chunks, query, limit = 5) {
  const queryTerms = terms(query); const tags = intentTags(query);
  return chunks.map((chunk) => {
    const title = terms(`${chunk.page_title} ${chunk.section} ${(chunk.category_tags || []).join(' ')}`);
    const body = terms(chunk.text); const tagScore = tags.reduce((sum, tag) => sum + ((chunk.category_tags || []).includes(tag) ? 12 : 0), 0);
    const termScore = queryTerms.reduce((sum, term) => sum + (title.includes(term) ? 5 : 0) + Math.min(4, body.filter((word) => word === term).length), 0);
    return { chunk, score: tagScore + termScore };
  }).filter((result) => result.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', (part) => { body += part; if (body.length > 1000000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } }); req.on('error', reject); }); }
function promptFor(query, profile, matches, webResults) {
  const sourceText = matches.map(({ chunk }) => `[${chunk.page_title} | ${chunk.section}]\n${chunk.text}\nSource: ${chunk.source_url}`).join('\n\n');
  const webText = webResults?.length ? `\n\nWEB BACKUP RESULTS. Treat these as less trusted and cite them separately:\n${webResults.map((item) => `${item.title}\n${item.snippet}\n${item.url}`).join('\n\n')}` : '';
  return `You are a personal moving assistant. Answer only from the supplied Penske sources, optional web results, and the user's profile. Be concise and actionable. Distinguish source-backed facts from suggestions. Never invent prices, availability, legal requirements, medical advice, route restrictions, or apartment requirements. For safety, recommend confirming current details with Penske, the property manager, authorities, or a veterinarian as appropriate.\n\nUser profile: ${JSON.stringify(profile || {})}\nQuestion: ${query}\n\nPenske sources:\n${sourceText || '(none)'}${webText}`;
}
async function callLlm(prompt) {
  if (!process.env.OPENAI_API_KEY) return null;
  const endpoint = `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`;
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: 'Return plain text with short headings and bullets when useful.' }, { role: 'user', content: prompt }] }) });
  if (!response.ok) throw new Error(`LLM request failed: ${response.status}`);
  const data = await response.json(); return data.choices?.[0]?.message?.content || null;
}
async function webSearch(query) {
  if (!process.env.BING_SEARCH_API_KEY) return [];
  const endpoint = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(`${query} site:pensketruckrental.com`)}&count=5&safeSearch=Strict`;
  const response = await fetch(endpoint, { headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_API_KEY } });
  if (!response.ok) throw new Error(`Search request failed: ${response.status}`);
  const data = await response.json(); return (data.webPages?.value || []).map((item) => ({ title: item.name, snippet: item.snippet, url: item.url }));
}
function fallbackAnswer(query, matches) {
  if (!matches.length) return { text: 'I could not find a strong match in the Penske corpus. Try a question about planning, supplies, trucks, loading, driving, pets, kids, storage or towing.', matches: [] };
  return { text: matches.map(({ chunk }) => chunk.text).join('\n\n'), matches };
}

const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname === '/api/health') return json(res, 200, { corpusChunks: corpus.chunks.length, llmConfigured: Boolean(process.env.OPENAI_API_KEY), webSearchConfigured: Boolean(process.env.BING_SEARCH_API_KEY) });
    if (requestUrl.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req); const query = String(body.query || '').trim(); if (!query) return json(res, 400, { error: 'query is required' });
      const matches = retrieve(corpus.chunks, query); let webResults = [];
      if (matches.length < 2 && process.env.BING_SEARCH_API_KEY) webResults = await webSearch(query);
      const generated = await callLlm(promptFor(query, body.profile, matches, webResults));
      const result = generated ? { text: generated, matches, webResults, mode: 'llm' } : fallbackAnswer(query, matches);
      return json(res, 200, result);
    }
    if (requestUrl.pathname === '/api/corpus' && req.method === 'GET') return json(res, 200, { chunks: corpus.chunks });
    if (req.method === 'GET') {
      const requested = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      const file = path.normalize(path.join(PUBLIC_DIR, requested));
      if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); return res.end(fs.readFileSync(file)); }
    }
    json(res, 404, { error: 'not found' });
  } catch (error) { json(res, 500, { error: error.message }); }
});
server.listen(PORT, () => console.log(`Personal assistant running at http://127.0.0.1:${PORT}`));
