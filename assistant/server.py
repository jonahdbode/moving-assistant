import json
import os
import re
import base64
from datetime import date, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ASSISTANT = Path(__file__).resolve().parent
PORT = int(os.getenv('PORT', '4174'))
HOST = os.getenv('HOST', '127.0.0.1')
CORPUS = json.loads((ROOT / 'Context Docs' / 'penske_rag_corpus_expanded.json').read_text(encoding='utf-8'))
SAGE_TOKEN = None
STOP_WORDS = set('a an and are as at be before can do for from how i in is it me my of on or should the this to what when with you your'.split())

def load_env():
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        match = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
        if match and match.group(1) not in os.environ:
            os.environ[match.group(1)] = match.group(2).strip('"\'')

def terms(value):
    return [term for term in re.sub(r'[^a-z0-9\s-]', ' ', str(value or '').lower()).split() if len(term) > 2 and term not in STOP_WORDS]

def intent_tags(value):
    query = value.lower(); tags = []
    patterns = [('pets', r'pet|dog|cat|animal|vet|crate'), ('kids', r'kid|child|school|family'), ('trucks', r'truck size|which truck|cubic|room|capacity|mpg'), ('driving', r'drive|driving|route|clearance|parking|fuel|road'), ('supplies', r'box|supply|tape|bubble|pad|packing'), ('loading', r'load|loading|formation|heavy'), ('storage', r'storage|labor|helper|unload'), ('towing', r'tow|car carrier|dolly')]
    for tag, pattern in patterns:
        if re.search(pattern, query): tags.append(tag)
    if 'loading' in tags: tags.append('i-formation')
    if 'driving' in tags: tags.append('safety')
    if 'kids' in tags: tags.append('family')
    return tags

def retrieve(query, limit=5):
    query_terms = terms(query); tags = intent_tags(query); results = []
    for chunk in CORPUS['chunks']:
        title = terms(' '.join([chunk.get('page_title', ''), chunk.get('section', ''), ' '.join(chunk.get('category_tags', []))]))
        body = terms(chunk.get('text', ''))
        score = sum(12 for tag in tags if tag in chunk.get('category_tags', []))
        score += sum((5 if term in title else 0) + min(4, body.count(term)) for term in query_terms)
        if score: results.append({'chunk': chunk, 'score': score})
    return sorted(results, key=lambda result: result['score'], reverse=True)[:limit]

def call_json(url, payload, headers):
    request = Request(url, data=json.dumps(payload).encode(), headers={**headers, 'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())

def call_llm(prompt):
    if os.getenv('MANAGED_INFERENCE_PROFILE_ARNS'):
        try:
            return call_bedrock(prompt)
        except Exception as error:
            print(f'Bedrock request failed: {type(error).__name__}: {str(error)[:180]}')
    if os.getenv('LLM_PROVIDER', 'sage').lower() == 'sage' and os.getenv('SAGE_APIGEE_KEY') and os.getenv('SAGE_APIGEE_SECRET'):
        try:
            return call_sage(prompt)
        except Exception as error:
            print(f'SageAI request failed: {type(error).__name__}: {str(error)[:180]}')
            if not os.getenv('OPENAI_API_KEY'):
                return None
    key = os.getenv('OPENAI_API_KEY')
    if not key: return None
    try:
        endpoint = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/') + '/chat/completions'
        data = call_json(endpoint, {'model': os.getenv('OPENAI_MODEL', 'gpt-4o-mini'), 'temperature': 0.2, 'messages': [{'role': 'system', 'content': 'Return concise plain text with short headings and bullets when useful.'}, {'role': 'user', 'content': prompt}]}, {'Authorization': f'Bearer {key}'})
        return data.get('choices', [{}])[0].get('message', {}).get('content')
    except Exception as error:
        print(f'OpenAI request failed: {type(error).__name__}: {str(error)[:180]}')
        return None

def call_bedrock(prompt):
    import boto3
    raw = json.loads(os.getenv('MANAGED_INFERENCE_PROFILE_ARNS'))
    model_id = raw[0] if isinstance(raw, list) else next(iter(raw.values()))
    region = os.getenv('AWS_REGION') or os.getenv('AWS_DEFAULT_REGION') or 'us-east-1'
    profile = os.getenv('AWS_PROFILE')
    session = boto3.Session(profile_name=profile, region_name=region) if profile else boto3.Session(region_name=region)
    response = session.client('bedrock-runtime').converse(
        modelId=model_id,
        messages=[{'role': 'user', 'content': [{'text': prompt}]}],
        inferenceConfig={'maxTokens': 1200, 'temperature': 0.2},
    )
    return response.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '')

def call_sage(prompt):
    global SAGE_TOKEN
    if not SAGE_TOKEN:
        credentials = f"{os.getenv('SAGE_APIGEE_KEY')}:{os.getenv('SAGE_APIGEE_SECRET')}".encode()
        token_request = Request(os.getenv('SAGE_TOKEN_URL', 'https://auth.apiqa.gopenske.com/oauth2/token'), data=b'grant_type=client_credentials', headers={'Authorization': 'Basic ' + base64.b64encode(credentials).decode(), 'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
        with urlopen(token_request, timeout=30) as response:
            SAGE_TOKEN = json.loads(response.read().decode()).get('access_token')
    payload = {
        'sso_id': os.getenv('SAGE_SSO_ID', ''),
        'app_id': os.getenv('SAGE_APP_ID', 'marketing'),
        'role_id': int(os.getenv('SAGE_ROLE_ID', '5')),
        'topic_name': os.getenv('SAGE_TOPIC_NAME', 'Personal Moving Assistant'),
        'query': prompt,
    }
    request = Request(os.getenv('SAGE_API_URL', 'https://aiplatform-internal.apiqa.penskeaws.com/v1/sage/converse/generative'), data=json.dumps(payload).encode(), headers={'Authorization': f'Bearer {SAGE_TOKEN}', 'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode())
    return data.get('response', {}).get('response', '')

def web_search(query):
    serper_key = os.getenv('SERPER_API_KEY')
    if serper_key:
        request = Request('https://google.serper.dev/search', data=json.dumps({'q': query}).encode(), headers={'X-API-KEY': serper_key, 'Content-Type': 'application/json'}, method='POST')
        with urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode())
        return [{'title': item.get('title'), 'snippet': item.get('snippet', ''), 'url': item.get('link')} for item in data.get('organic', [])[:5]]
    brave_key = os.getenv('BRAVE_SEARCH_API_KEY') or os.getenv('BRAVE_API_KEY')
    if brave_key:
        url = os.getenv('BRAVE_SEARCH_URL', 'https://api.search.brave.com/res/v1/web/search') + '?q=' + quote(query) + '&count=5&safesearch=strict'
        request = Request(url, headers={'X-Subscription-Token': brave_key, 'Accept': 'application/json'})
        with urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode())
        return [{'title': item.get('title'), 'snippet': item.get('description', ''), 'url': item.get('url')} for item in data.get('web', {}).get('results', [])]
    key = os.getenv('BING_SEARCH_API_KEY')
    if not key: return []
    url = 'https://api.bing.microsoft.com/v7.0/search?q=' + quote(query) + '&count=5&safeSearch=Strict'
    request = Request(url, headers={'Ocp-Apim-Subscription-Key': key})
    with urlopen(request, timeout=15) as response:
        data = json.loads(response.read().decode())
    return [{'title': item.get('name'), 'snippet': item.get('snippet'), 'url': item.get('url')} for item in data.get('webPages', {}).get('value', [])]

def search_plan(query, profile):
    value = query.lower()
    destination = str((profile or {}).get('moveTo', '')).strip()
    if 'pensketruckrental.com' in value or re.search(r'\bpenske\b', value):
        return {'intent': 'penske-content', 'query': f'{query} site:pensketruckrental.com'}
    if re.search(r'\b(city\s+(?:move\s+)?guide|city profile|moving to|relocat|traffic|parking permit|truck route)\b', value):
        if not destination:
            return {'intent': 'needs-destination', 'query': None}
        return {'intent': 'city-guide', 'query': f'moving to {destination} moving truck routes traffic parking unloading permits'}
    if re.search(r'\b(vets?|veterinary|animal care|emergency animal|pet hospital)\b', value):
        if not destination:
            return {'intent': 'needs-destination', 'query': None}
        return {'intent': 'pet-care', 'query': f'emergency veterinary hospitals {destination} phone number'}
    if re.search(r'\b(provider|providers|utility|utilities|electric|electricity|gas service|water service|internet service|internet provider)\b', value):
        if not destination:
            return {'intent': 'needs-destination', 'query': None}
        return {'intent': 'local-providers', 'query': f'electric gas water internet utility providers {destination}'}
    return None

def prompt_for(query, profile, matches, web_results, web_intent=None):
    sources = '\n\n'.join(f"[{item['chunk']['page_title']} | {item['chunk']['section']}]\n{item['chunk']['text']}\nSource: {item['chunk']['source_url']}" for item in matches)
    web = '\n\n'.join(f"{item['title']}\n{item['snippet']}\n{item['url']}" for item in web_results)
    return f"""You are a personal moving assistant. Answer only from the supplied Penske sources, permitted web results, and the user's profile. Be concise and actionable. Distinguish source-backed facts from suggestions. For city guides, organize practical moving, loading and driving considerations. For provider and pet-care results, list named organizations, address/area and phone only when stated in the search results; do not invent contact details. Never invent prices, availability, legal requirements, medical advice, route restrictions, or apartment requirements. Recommend confirming current details with Penske, the property manager, authorities, providers, or a veterinarian as appropriate.\n\nUser profile: {json.dumps(profile or {})}\nQuestion: {query}\nExternal search intent: {web_intent or 'none'}\n\nPenske sources:\n{sources or '(none)'}\n\nPermitted web results:\n{web or '(none)'}"""

def fallback(query, matches, web_results=None):
    live_results = web_results or []
    web_summary = ''
    if live_results:
        web_summary = '\n\nCurrent web results to verify:\n' + '\n'.join(f"- {item.get('title', 'Untitled result')}: {item.get('snippet', 'Open the source for current details.')}" for item in live_results)
    if not matches:
        text = 'I could not find a strong match in the Penske corpus.' + (web_summary or ' Try planning, supplies, trucks, loading, driving, pets, kids, storage or towing.')
        return {'text': text, 'matches': [], 'webResults': live_results, 'mode': 'local-fallback'}
    return {'text': '\n\n'.join(item['chunk']['text'] for item in matches) + web_summary, 'matches': matches, 'webResults': live_results, 'mode': 'local-fallback'}

def render_move_in_document(document):
    lines = [f"# {document.get('title') or 'Move-In Checklist'}", '']
    if document.get('residentNames'): lines.append(f"Welcome home, {document['residentNames']}!")
    if document.get('propertyName') or document.get('unit'):
        lines.append(f"**Property:** {document.get('propertyName', 'Your new home')}  **Unit:** {document.get('unit', 'Not provided')}")
    if document.get('moveInDate'): lines.append(f"**Move-in date:** {document['moveInDate']}")
    if document.get('fundsDueDate'): lines.append(f"**Funds due:** {document['fundsDueDate']}")
    if document.get('totalDue') is not None: lines.append(f"**Total due:** ${float(document['totalDue']):,.2f}")
    if document.get('paymentInstructions'): lines.extend(['', f"**Payment instructions:** {document['paymentInstructions']}"])
    lines.extend(['', '## Required steps', ''])
    for step in document.get('steps', []):
        marker = 'x' if step.get('completed') else ' '
        line = f"- [{marker}] **Step {step.get('step')}: {step.get('title', 'Required task')}** {step.get('task', '')}"
        if step.get('dueDate'): line += f" Due: {step['dueDate']}."
        if step.get('contact'): line += f" Contact: {step['contact']}."
        lines.append(line)
        for item in step.get('documentsToSend', []): lines.append(f"  - Send/bring: {item}")
    lines.extend(['', '> Verify dates, amounts, contact details and property requirements against the original letter before relying on this checklist.', ''])
    return '\n'.join(lines)

def move_timeline(profile):
    try:
        move_date = date.fromisoformat(str(profile.get('moveDate', '')))
    except ValueError:
        move_date = date.today() + timedelta(days=90)
    def due(days_before):
        target = move_date - timedelta(days=days_before)
        return 'Today' if target <= date.today() else f'{target.strftime("%b")} {target.day}'
    return [
        {'id': 'inventory', 'when': due(90), 'phase': 'Start now', 'title': 'Build your move inventory', 'detail': 'Use the Truck Wizard to estimate volume and compare trucks before reserving.', 'action': 'wizard'},
        {'id': 'help', 'when': due(75), 'phase': 'Start now', 'title': 'Confirm your moving crew', 'detail': 'Coordinate the three household movers and four friends, then compare simple moving labor for loading, heavy lifting and unloading support.', 'action': 'moving-labor'},
        {'id': 'supplies', 'when': due(45), 'phase': 'Six weeks out', 'title': 'Get supplies and start non-essential packing', 'detail': 'Start with 20 medium boxes, then add packing paper, tape, pads and a hand truck from Penske as the apartment inventory becomes final.', 'action': 'supplies'},
        {'id': 'pets', 'when': due(30), 'phase': 'One month out', 'title': 'Prepare the cat and Saint Bernard', 'detail': 'Create a move-day pet plan: records, identification, food, medication, secure carriers, breaks and a quiet closed room at both apartments.', 'action': 'pet-care'},
        {'id': 'address', 'when': due(21), 'phase': 'Three weeks out', 'title': 'Complete your move-in checklist', 'detail': 'Work through the welcome-home requirements: PECO, renters insurance, lease signing, freight elevator, pet records and certified move-in funds.', 'action': 'move-in-checklist'},
        {'id': 'property', 'when': due(14), 'phase': 'Two weeks out', 'title': 'Build a Philadelphia metro move guide', 'detail': 'Review practical city-moving guidance for routes, parking, clearance, access windows and loading or unloading.', 'action': 'philly-guide'},
        {'id': 'finish', 'when': due(1), 'phase': 'Day before', 'title': 'Finish packing and pick up the truck', 'detail': 'Label boxes and furniture, secure drawers and appliance doors, pack a moving-day kit and confirm the rental pickup details.', 'action': 'truck-pickup'},
        {'id': 'move-day', 'when': f'{move_date.strftime("%b")} {move_date.day}', 'phase': 'Move day', 'title': 'Load safely and keep pets secure', 'detail': 'Use the I-formation load order, protect the furniture and keep pets secured away from open doors and the loading path.', 'action': 'move-day'}
    ]

def move_plan_sources(destination, requested=None):
    queries = [
        ('city', f'moving to {destination} moving truck parking loading dock traffic'),
        ('pet-care', f'emergency veterinary hospitals {destination} phone number')
    ]
    if requested:
        queries = [item for item in queries if item[0] == requested]
    results = {}
    for category, query in queries:
        try:
            results[category] = web_search(query)
        except Exception as error:
            print(f'Move-plan search failed ({category}): {type(error).__name__}: {str(error)[:180]}')
            results[category] = []
    if not requested or requested == 'providers':
        provider_results = []
        for query in ['PECO customer service phone number', f'Xfinity customer service phone number {destination}']:
            try:
                provider_results.extend(web_search(query))
            except Exception as error:
                print(f'Move-plan search failed (providers): {type(error).__name__}: {str(error)[:180]}')
        unique = {}
        for result in provider_results:
            if result.get('url') and result['url'] not in unique:
                unique[result['url']] = result
        results['providers'] = list(unique.values())[:5]
    return results

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ASSISTANT), **kwargs)
    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/health': return self.send_json(200, {'corpusChunks': len(CORPUS['chunks']), 'llmConfigured': bool(os.getenv('MANAGED_INFERENCE_PROFILE_ARNS')) or bool(os.getenv('OPENAI_API_KEY')) or bool(os.getenv('SAGE_APIGEE_KEY')), 'bedrockConfigured': bool(os.getenv('MANAGED_INFERENCE_PROFILE_ARNS')), 'sageConfigured': bool(os.getenv('SAGE_APIGEE_KEY')), 'serperConfigured': bool(os.getenv('SERPER_API_KEY')), 'braveConfigured': bool(os.getenv('BRAVE_SEARCH_API_KEY') or os.getenv('BRAVE_API_KEY')), 'webSearchConfigured': bool(os.getenv('SERPER_API_KEY') or os.getenv('BRAVE_SEARCH_API_KEY') or os.getenv('BRAVE_API_KEY') or os.getenv('BING_SEARCH_API_KEY'))})
        if parsed.path == '/api/corpus': return self.send_json(200, {'chunks': CORPUS['chunks']})
        return super().do_GET()
    def do_POST(self):
        endpoint = urlparse(self.path).path
        if endpoint == '/api/move-in-document':
            try:
                length = int(self.headers.get('Content-Length', '0')); body = json.loads(self.rfile.read(length) or '{}')
                if body.get('private') is not True: return self.send_json(400, {'error': 'private must be true'})
                return self.send_json(200, {'markdown': render_move_in_document(body), 'private': True})
            except Exception as error: return self.send_json(400, {'error': str(error)})
        if endpoint == '/api/demo/move-plan':
            try:
                length = int(self.headers.get('Content-Length', '0')); body = json.loads(self.rfile.read(length) or '{}')
                profile = body.get('profile', {})
                destination = str(profile.get('moveTo', '')).strip()
                if not destination: return self.send_json(400, {'error': 'A destination is required.'})
                return self.send_json(200, {'timeline': move_timeline(profile)})
            except Exception as error:
                print(f'Move-plan demo failed: {type(error).__name__}: {str(error)[:180]}')
                return self.send_json(500, {'error': 'Could not create the move plan.'})
        if endpoint == '/api/demo/task-sources':
            try:
                length = int(self.headers.get('Content-Length', '0')); body = json.loads(self.rfile.read(length) or '{}')
                destination = str(body.get('destination', '')).strip()
                source_type = str(body.get('sourceType', '')).strip()
                if not destination or source_type not in {'city', 'providers', 'pet-care'}:
                    return self.send_json(400, {'error': 'A destination and valid source type are required.'})
                return self.send_json(200, {'results': move_plan_sources(destination, source_type).get(source_type, [])})
            except Exception as error:
                print(f'Task source lookup failed: {type(error).__name__}: {str(error)[:180]}')
                return self.send_json(500, {'error': 'Could not retrieve local sources.'})
        if endpoint != '/api/chat': return self.send_json(404, {'error': 'not found'})
        try:
            length = int(self.headers.get('Content-Length', '0')); body = json.loads(self.rfile.read(length) or '{}'); query = str(body.get('query', '')).strip()
            if not query: return self.send_json(400, {'error': 'query is required'})
            profile = body.get('profile', {})
            matches = retrieve(query)
            web_results = []
            plan = search_plan(query, profile)
            if plan and plan['query']:
                try:
                    web_results = web_search(plan['query'])
                except Exception as error:
                    print(f'Web search failed: {type(error).__name__}: {str(error)[:180]}')
            generated = call_llm(prompt_for(query, profile, matches, web_results, plan['intent'] if plan else None))
            result = {'text': generated, 'matches': matches, 'webResults': web_results, 'webSearchIntent': plan['intent'] if plan else None, 'mode': 'llm'} if generated else fallback(query, matches, web_results)
            result['webSearchIntent'] = plan['intent'] if plan else None
            if plan and plan['intent'] == 'needs-destination':
                result['text'] = 'Add your destination city or ZIP to the move profile before I look up local providers, emergency veterinary care, or a destination move guide.'
                result['webSearchIntent'] = plan['intent']
            return self.send_json(200, result)
        except Exception as error:
            print(f'Chat request failed: {type(error).__name__}: {str(error)[:180]}')
            return self.send_json(500, {'error': str(error)})

load_env()
print(f'Personal assistant running at http://{HOST}:{PORT}')
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
