const state = { chunks: [], health: null, activeCouchOption: 'a', profile: JSON.parse(localStorage.getItem('penske-assistant-profile') || '{}'), timeline: JSON.parse(localStorage.getItem('penske-move-timeline') || '{}'), followupChat: false };
const stopWords = new Set('a an and are as at be before can do for from how i in is it me my of on or should the this to what when with you your'.split(' '));
const $ = (selector) => document.querySelector(selector);

function terms(value) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((term) => term.length > 2 && !stopWords.has(term));
}

function intentTags(query) {
  const value = query.toLowerCase();
  const tags = [];
  if (/pet|dog|cat|animal|vet|crate/.test(value)) tags.push('pets');
  if (/kid|child|school|family/.test(value)) tags.push('kids', 'family');
  if (/truck size|which truck|cubic|room|capacity|mpg/.test(value)) tags.push('trucks', 'capacity');
  if (/drive|driving|route|clearance|parking|fuel|road/.test(value)) tags.push('driving', 'safety');
  if (/box|supply|tape|bubble|pad|packing/.test(value)) tags.push('supplies', 'packing');
  if (/load|loading|formation|heavy/.test(value)) tags.push('loading', 'i-formation');
  if (/storage|labor|helper|unload/.test(value)) tags.push('storage', 'moving-labor');
  if (/tow|car carrier|dolly/.test(value)) tags.push('towing');
  return tags;
}

function scoreChunk(chunk, queryTerms) {
  const title = terms(`${chunk.page_title} ${chunk.section} ${(chunk.category_tags || []).join(' ')}`);
  const body = terms(chunk.text);
  const tags = chunk.category_tags || [];
  const query = queryTerms.join(' ');
  const tagScore = intentTags(query).reduce((score, tag) => score + (tags.includes(tag) ? 12 : 0), 0);
  return tagScore + queryTerms.reduce((score, term) => score + (title.includes(term) ? 5 : 0) + Math.min(4, body.filter((word) => word === term).length), 0);
}

function retrieve(query) {
  const queryTerms = terms(query);
  return state.chunks.map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTerms) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function profileContext() {
  const values = [state.profile.moveFrom, state.profile.moveTo, state.profile.homeSize, state.profile.household].filter(Boolean);
  return values.length ? `\n\nYour saved move profile: ${values.join(' · ')}.` : '';
}

function answer(query) {
  const matches = retrieve(query);
  if (!matches.length) {
    return { text: "I couldn't find a strong match in the Penske source corpus. Try asking about your timeline, supplies, truck sizes, loading, driving, pets, kids, storage or towing.", matches: [] };
  }
  const lead = matches[0].chunk;
  const supporting = matches.slice(1).map((result) => result.chunk);
  const summary = lead.text.replace(/\s+/g, ' ').trim();
  const extra = supporting.length ? `\n\nRelated guidance: ${supporting.map((chunk) => chunk.text.replace(/\s+/g, ' ').trim()).join(' ')}` : '';
  return { text: `${summary}${extra}${profileContext()}`, matches };
}

function addMessage(role, text, matches = [], webResults = [], quickReplies = []) {
  const message = document.createElement('article');
  message.className = `message ${role}`;
  message.textContent = text;
  if (matches.length || webResults.length) {
    const sources = document.createElement('div');
    sources.className = 'sources';
    const label = document.createElement('strong');
    label.textContent = 'Sources';
    sources.appendChild(label);
    matches.forEach(({ chunk }) => {
      const link = document.createElement('a');
      link.href = chunk.source_url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `${chunk.page_title} · ${chunk.section}`;
      sources.appendChild(link);
      sources.appendChild(document.createElement('br'));
    });
    webResults.forEach((result) => {
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `Web: ${result.title}`;
      sources.appendChild(link);
      sources.appendChild(document.createElement('br'));
    });
    message.appendChild(sources);
  }
  if (quickReplies.length) {
    const replies = document.createElement('div');
    replies.className = 'chat-replies';
    quickReplies.forEach(({ label, value }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = () => ask(value);
      replies.appendChild(button);
    });
    message.appendChild(replies);
  }
  const chatLog = state.followupChat ? $('#followup-chat-log') : $('#chat-log');
  chatLog.appendChild(message);
  message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectScenario(name) {
  resetDemoScroll();
  document.querySelectorAll('[data-scenario]').forEach((button) => button.classList.toggle('active', button.dataset.scenario === name));
  $('#chat-log').innerHTML = '';
  $('#followup-chat-log').innerHTML = '';
  state.followupChat = false;
  showWorkspace(null);
  $('#profile-panel').hidden = true;
  const prompt = name === 'couch'
    ? 'My sister and I want to pick up a couch this weekend in Columbus.'
    : 'I am moving in 3 months to a 3-bedroom, 2-bath apartment with a cat and a Saint Bernard.';
  ask(prompt).finally(() => {
    resetDemoScroll();
  });
}

function resetDemoScroll() {
  const reset = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };
  reset();
  requestAnimationFrame(reset);
  setTimeout(reset, 100);
  setTimeout(reset, 500);
}

async function ask(query) {
  const value = query.trim();
  if (!value) return;
  addMessage('user', value);
  if (/moving in 3 months|saint bernard|3-bedroom,? 2-bath/i.test(value)) return startFamilyConversation();
  if (/couch.*weekend.*columbus|weekend.*couch/i.test(value)) return startCouchConversation();
  if (/apartment.*letter|providers.*documents|utility.*insurance/i.test(value)) return continueFamilyConversation();
  if (/grandview.*(bexley|upper arlington|dublin)|(bexley|upper arlington|dublin).*grandview/i.test(value)) return continueCouchConversation();
  if (/create.*timeline|build.*timeline/i.test(value)) return finishFamilyConversation();
  if (/build.*pickup|show.*pickup|compare.*routes/i.test(value)) return finishCouchConversation();
  let result;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: value, profile: state.profile }) });
    if (!response.ok) throw new Error('API unavailable');
    result = await response.json();
  } catch {
    result = answer(value);
  }
  addMessage('assistant', result.text, result.matches, result.webResults || []);
}

function startFamilyConversation() {
  addMessage('assistant', 'I can help with that. First I need a little more information so I can shape the plan around your move. What city are you moving from and where are you headed?');
  addMessage('user', 'We are moving from 109 Commerce Drive, Exton, PA 19341 to 181 N Pottstown Pike, Exton, PA 19341.');
  addMessage('assistant', 'Thanks. I have the route. It looks like you are moving from Ashbridge Apartments to The Point at Exton. Good choice. How many people will be moving, and should I include utilities, renters insurance, address changes and move-in documents? I will also account for your cat and Saint Bernard.');
  addMessage('user', 'There are 3 of us plus 4 friends helping. Please include utilities, insurance and move-in documents.');
  addMessage('assistant', 'Perfect. One more thing before I build the timeline: what furniture and larger items should I plan for in the truck? You can describe them naturally, including approximate quantities.');
  addMessage('user', 'It is a 3-bedroom apartment with 3 queen mattresses, 3 box springs, 2 sofas, a dresser, a dining table and 6 dining chairs. Please plan for 20 medium moving boxes.');
  addMessage('assistant', 'Got it. I will use the three mattresses, three box springs, two sofas and 20 medium boxes to prepopulate the Truck Wizard when you open the inventory task. I will also plan for the seven-person crew, pet care, utilities, insurance, address changes and move-in access. Your interactive timeline is ready.');
  addMessage('assistant', 'Each task opens the relevant next step when you need it.');
  applyRelocationDemo();
}

function continueFamilyConversation() {
  addMessage('assistant', 'Great. I will add utility setup, renters insurance, address change and move-in access checks alongside the Penske planning milestones. I can now turn this into a dated, interactive timeline.', [], [], [{ label: 'Create my interactive timeline', value: 'Create my interactive timeline.' }]);
}

function finishFamilyConversation() {
  addMessage('assistant', 'Your personalized move plan is ready. Each task opens the relevant next step when you need it.');
  applyRelocationDemo();
}

function startCouchConversation() {
  addMessage('assistant', 'I can compare the pickup options. First, here are Columbus Penske locations so we can choose a pickup point before building the route loop.');
  const location = document.createElement('article');
  location.className = 'message assistant location-message';
  location.innerHTML = '<img src="assets/columbus-penske-locations.png" alt="Columbus Penske truck rental locations" /><a href="https://www.pensketruckrental.com/locations/us/ohio/columbus/" target="_blank" rel="noreferrer">View Columbus Penske locations</a>';
  $('#chat-log').appendChild(location);
  addMessage('user', 'She lives in Grandview Heights and the couch options are Bexley, Upper Arlington and Dublin.');
  addMessage('assistant', "Let's compare your two closest locations, Penske Columbus and Gateway Self Storage. Please note that Gateway Self Storage has no 12' trucks available during your requested time period.", [], columbusLocationLinks);
  addMessage('assistant', 'Your moving-day pickup comparison is ready. Choose a pickup source and preview each route.');
  applyCouchDemo();
}

function continueCouchConversation() {
  addMessage('assistant', "Let's compare your two closest locations, Penske Columbus and Gateway Self Storage. Please note that Gateway Self Storage has no 12' trucks available during your requested time period.", [], columbusLocationLinks, [{ label: 'Build my pickup comparison', value: 'Build my pickup comparison.' }]);
}

function finishCouchConversation() {
  addMessage('assistant', 'Your moving-day pickup comparison is ready. Choose a pickup source and preview each route.');
  applyCouchDemo();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showWorkspace(name) {
  $('#move-plan-workspace').hidden = name !== 'move';
  $('#couch-workspace').hidden = name !== 'couch';
}

function renderTimeline(tasks) {
  const timeline = $('#timeline');
  timeline.innerHTML = '';
  tasks.forEach((task) => {
    const row = document.createElement('section');
    row.className = `timeline-task${state.timeline[task.id] ? ' done' : ''}`;
    row.innerHTML = `<input type="checkbox" aria-label="Mark ${escapeHtml(task.title)} complete" ${state.timeline[task.id] ? 'checked' : ''} /><span class="timeline-date">${escapeHtml(task.when)}<br />${escapeHtml(task.phase)}</span><button class="timeline-body" type="button"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.detail)}</span></button>`;
    row.querySelector('input').onchange = (event) => {
      state.timeline[task.id] = event.target.checked;
      localStorage.setItem('penske-move-timeline', JSON.stringify(state.timeline));
      row.classList.toggle('done', event.target.checked);
    };
    row.querySelector('.timeline-body').onclick = () => openTask(task, row);
    timeline.appendChild(row);
  });
}

function renderGuidance(title, description, results) {
  const target = $('#task-details');
  target.hidden = false;
  target.innerHTML = '';
  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  heading.innerHTML = `<div><p class="eyebrow">Next step</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><button type="button" aria-label="Close task details">Close</button>`;
  heading.querySelector('button').onclick = () => { target.hidden = true; };
  target.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'local-guidance';
  if (!results.length) list.innerHTML = '<p class="profile-note">No live results returned. Confirm current information directly with the provider.</p>';
  results.slice(0, 5).forEach((result) => {
    const card = document.createElement('section');
    card.className = 'guidance-card';
    card.innerHTML = `<a target="_blank" rel="noreferrer" href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>${result.snippet ? `<p class="guidance-detail">${escapeHtml(result.snippet)}</p>` : ''}`;
    list.appendChild(card);
  });
  target.appendChild(list);
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderSuppliesGuidance() {
  renderArticle('Penske packing supplies for your move', 'You described three mattresses, two sofas and other large furniture. These supplies map directly to that inventory.', '<img class="article-image" src="assets/moving-boxes-chart.png" alt="Penske moving box estimates by room" />', [
    'Start with the 20 medium boxes in your inventory plan; add smaller boxes for dense books or fragile items and wardrobe boxes for hanging clothes if needed.',
    'For the three mattresses, add mattress bags to keep fabric clean during loading, transport and apartment unloading.',
    'For the two sofas and other furniture, use moving pads and stretch wrap; add a hand truck to move heavy, awkward pieces with less lifting.',
    'Keep a separate first-night group for chargers, medications, toiletries, pet supplies, documents and a change of clothes.'
  ], [
    { title: 'Moving boxes and supplies', url: 'https://www.pensketruckrental.com/extras-and-supplies/boxes-supplies/' },
    { title: 'Penske moving supplies', url: 'https://www.pensketruckrental.com/extras-and-supplies/' },
    { title: 'Mattress bags, pads and hand trucks', url: 'https://www.pensketruckrental.com/extras-and-supplies/boxes-supplies/' }
  ]);
}

function renderMovingLaborGuidance() {
  renderArticle('Moving labor for your heavy items', 'Because you have three mattresses, two sofas and other large furniture, consider adding loading and unloading help to your seven-person crew.', '', [
    'Because of your large amount of heavy furniture and mattresses, consider Simple Moving Labor with $25 off for Penske rentals.',
    'Use friends for box staging and lighter tasks while the labor team handles mattresses, sofas, the dresser, dining furniture and the heaviest lifting.',
    'Confirm the service area, crew size, arrival window, equipment and whether the team loads, unloads or does both.'
  ], [
    { title: 'Simple Moving Labor - $25 off for Penske rentals', url: 'https://www.simplemovinglabor.com/' },
    { title: 'How to load a moving truck', url: 'https://www.pensketruckrental.com/plan-your-move/load/learn-how-to-load-a-moving-truck/' }
  ]);
}

function renderPetGuidance() {
  renderArticle('Moving with pets', 'Because this move stays close to home, focus on keeping your cat and Saint Bernard secure during access changes and helping them settle into the new apartment.', '', [
    'Buy new ID tags before moving and add the new address and a current phone number to each collar.',
    'Keep pets secure in a closed room while doors are open and furniture is moving. Loading and unloading create easy escape opportunities, especially at the unfamiliar destination.',
    'Unpack pet belongings early: bedding, food and water bowls, toys, food and any medication. Familiar items can make the new space feel safe sooner.',
    'Pet-proof the new apartment before letting them explore: secure windows, cables and hazards, and check any balcony or yard access if applicable.',
    'Introduce the apartment gradually, maintain feeding and walk routines, and give pets time and comfort if they hide, act unusually or eat less after the move.'
  ], [
    { title: 'Moving with pets', url: 'https://www.pensketruckrental.com/plan-your-move/plan/moving-with-pets/' },
    { title: 'Penske moving-day planning', url: 'https://www.pensketruckrental.com/plan-your-move/plan/' }
  ]);
}

function renderApartmentLogistics() {
  renderGuidance('Apartment move-in logistics', 'Confirm both apartments’ move windows before reserving the truck. Ask about elevator reservations, stairs, loading zones, parking, building clearance, insurance requirements and the time allowed for unloading.', [
    { title: 'Moving to a metropolitan area', url: 'https://www.pensketruckrental.com/plan-your-move/plan/metropolitan-areas/', snippet: 'Use a city-style move checklist for access, traffic, parking and apartment delivery constraints.' },
    { title: 'Tips for driving a moving truck', url: 'https://www.pensketruckrental.com/plan-your-move/drive/', snippet: 'Review clearance, turning room, route planning and safe stopping before driving the truck to either apartment.' },
    { title: 'Penske loading and unloading guidance', url: 'https://www.pensketruckrental.com/plan-your-move/load/learn-how-to-load-a-moving-truck/', snippet: 'Keep the loading path clear, load heavy furniture securely and reserve enough time for the seven-person crew.' },
  ]);
}

function renderPhillyGuide() {
  const target = $('#task-details');
  target.hidden = false;
  target.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">Philadelphia metro guide</p><h3>Plan your move through the Philadelphia area</h3><p>Use this city-style guide to organize access, driving, loading and move-day questions before reserving.</p></div><button type="button" aria-label="Close Philadelphia guide">Close</button></div><div class="article-body philly-guide"><section><h4>1. Tips for Moving</h4><ol><li>Ask your Philadelphia-area building or property manager about move windows, freight elevators, loading docks and temporary parking.</li><li>For Center City, rowhouse blocks and dense neighborhoods, plan where the truck can legally stop without blocking SEPTA routes, intersections or fire access.</li><li>Protect floors, walls and elevator interiors, and reserve enough loading time for stairs, long hallways and tight turns.</li></ol></section><section><h4>2. Tips for Driving</h4><ol><li>Use a truck-safe route around narrow streets, historic districts, low bridges, bridge approaches and streets with truck restrictions.</li><li>Expect congestion on I-76, I-95, US 1 and major Schuylkill or Delaware River crossings; build buffer time into the delivery window.</li><li>Verify current clearance, construction, lane and parking restrictions before departure rather than relying only on a standard car route.</li></ol></section><section><h4>3. 10 Things To Know When You Move to Philadelphia</h4><ol><li>Parking rules differ across Philadelphia, suburbs and individual building blocks.</li><li>Center City and rowhouse neighborhoods can have narrow curb access and limited staging space.</li><li>SEPTA routes, bus lanes and trolley corridors may affect where a truck can stop.</li><li>Many buildings require advance elevator or loading-dock reservations.</li><li>Historic streets and tight turns may require a smaller or carefully routed truck.</li><li>Schuylkill Expressway and I-95 traffic can change a short trip into a long delivery window.</li><li>Bridge and underpass clearances must be checked for the selected truck.</li><li>Building staff may require certificates, access contacts or proof of insurance.</li><li>Apartment unloading may require a scheduled window and a crew plan for stairs or long carries.</li><li>Confirm city, township, property and neighborhood requirements immediately before move day.</li></ol></section><section><h4>4. Frequently Asked Questions</h4><p><strong>Where can the truck stop?</strong> Confirm legal curb, loading-zone and building rules for the exact block; do not assume a car parking space works for a moving truck.</p><p><strong>Should I avoid Center City?</strong> Not necessarily, but plan the access window, route, truck dimensions and unloading crew carefully.</p><p><strong>How should I handle bridges and highways?</strong> Check truck clearance and current restrictions, then add traffic time for I-76, I-95 and river crossings.</p></section><section class="checklist-sources"><strong>Recommended reading</strong><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/plan-your-move/plan/metropolitan-areas/">Philadelphia-area moving guidance</a><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/plan-your-move/drive/">Tips for driving a moving truck</a><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/plan-your-move/load/learn-how-to-load-a-moving-truck/">How to load a moving truck</a></section></div>`;
  const references = target.querySelector('.checklist-sources');
  references.insertAdjacentHTML('beforeend', '<a target="_blank" rel="noreferrer" href="https://www.phila.gov/services/cars-parking-transportation/">Philadelphia parking and curb rules</a><a target="_blank" rel="noreferrer" href="https://www.septa.org/">SEPTA routes and service</a>');
  target.querySelector('button').onclick = () => { target.hidden = true; };
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderArticle(title, description, media, points, sources) {
  const target = $('#task-details');
  target.hidden = false;
  target.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">Move guide</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><button type="button" aria-label="Close article">Close</button></div><div class="article-body">${media || ''}<ol>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ol><section class="checklist-sources"><strong>Recommended reading</strong>${sources.map((source) => `<a target="_blank" rel="noreferrer" href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>`).join('')}</section></div>`;
  target.querySelector('button').onclick = () => { target.hidden = true; };
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderLegacyMoveInChecklist() {
  const target = $('#task-details');
  target.hidden = false;
  target.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">Welcome-home checklist</p><h3>Complete these move-in steps</h3><p>Keep the welcome-home letter or move-in email nearby and send each requested confirmation to your property team.</p></div><button type="button" aria-label="Close move-in checklist">Close</button></div><div class="move-in-checklist"><ol><li><strong>Set up your PECO account.</strong> Provide the account number to the property team. Call PECO at <a href="tel:18004944000">1-800-494-4000</a> between 7 a.m. and 7 p.m. weekdays, or set up service through the <a target="_blank" rel="noreferrer" href="https://www.peco.com/">PECO website</a>. Email your PECO account number.</li><li><strong>Set up renters insurance.</strong> Check the welcome letter for the required policy details. List the interested party as The Point at Exton, Pantzer Operations LLC and its Affiliates, P.O. Box 115009, Carrollton, TX 75011-5009. Email the declarations page.</li><li><strong>Sign the lease.</strong> Watch your inbox for the lease contract, then review and sign it through the property team's requested process.</li><li><strong>Schedule the move-in appointment and freight elevator/loading dock.</strong> Request a 4-hour weekday block from 9 a.m. to 5 p.m., Saturday from 10 a.m. to 4 p.m., or Sunday from 11 a.m. to 3 p.m. Confirm the preferred day and time with the property team.</li><li><strong>Send pet information.</strong> For the cat and Saint Bernard, email breed, sex, color, age, weight, photo and veterinary records.</li><li><strong>Provide move-in funds.</strong> Prepare certified checks or money orders for the required move-in monies. Confirm the exact amount and payee in the welcome-home letter before sending or delivering them.</li></ol><section class="checklist-sources"><strong>Reference sources</strong><a target="_blank" rel="noreferrer" href="https://www.peco.com/">PECO</a><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/plan-your-move/plan/">Penske move planning guidance</a><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/plan-your-move/drive/">Penske truck driving guidance</a></section></div>`;
  target.querySelector('button').onclick = () => { target.hidden = true; };
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderMoveInChecklist() {
  const target = $('#task-details');
  target.hidden = false;
  target.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">Move-in checklist</p><h3>Complete the four P's</h3><p><strong>Power, Policy, Paperwork and Property access.</strong> Use the welcome letter or move-in email as the source of truth. Some steps may be optional depending on the property, lease and move type.</p></div><button type="button" aria-label="Close move-in checklist">Close</button></div><div class="move-in-checklist"><div class="checklist-item"><input type="checkbox" aria-label="Mark utilities complete" /><div><strong>1. Utilities</strong><p>Set up the required electricity, water, gas or internet accounts if needed. For this Exton move, start with <a target="_blank" rel="noreferrer" href="https://www.peco.com/">PECO</a> at <a href="tel:18004944000">1-800-494-4000</a>; save the account number and send the confirmation your property team requests.</p></div></div><div class="checklist-item"><input type="checkbox" aria-label="Mark renters insurance complete" /><div><strong>2. Renters insurance</strong><p>Compare a few providers available in the move area, such as <a target="_blank" rel="noreferrer" href="https://www.lemonade.com/renters">Lemonade</a>, <a target="_blank" rel="noreferrer" href="https://www.statefarm.com/insurance/renters">State Farm</a> and <a target="_blank" rel="noreferrer" href="https://www.progressive.com/renters/">Progressive</a>. Confirm coverage limits, effective date, deductible and any interested-party wording with the property before purchasing.</p></div></div><div class="checklist-item"><input type="checkbox" aria-label="Mark lease complete" /><div><strong>3. Lease and documents</strong><p>Watch for the lease, welcome letter, insurance instructions and building policies. Review, sign and return the documents by the requested deadline if applicable.</p></div></div><div class="checklist-item"><input type="checkbox" aria-label="Mark move-in appointment complete" /><div><strong>4. Move-in appointment and access</strong><p>If the property requires it, schedule the move-in appointment, elevator, loading dock, loading zone or parking window. Confirm the date, time block, access instructions and any fees.</p></div></div><div class="checklist-item"><input type="checkbox" aria-label="Mark pet information complete" /><div><strong>5. Pet information, if needed</strong><p>If pets are part of the move, send the requested breed, sex, color, age, weight, photo, identification and veterinary records. Confirm destination pet rules before move day.</p></div></div><div class="checklist-item"><input type="checkbox" aria-label="Mark move-in funds complete" /><div><strong>6. Move-in funds</strong><p>If required, prepare the specified certified check, money order or other approved payment. Confirm the exact amount, payee and delivery method from the current property instructions.</p></div></div><section class="checklist-sources"><strong>Useful references</strong><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/plan-your-move/plan/">Penske move planning guidance</a><a target="_blank" rel="noreferrer" href="https://www.pensketruckrental.com/extras-and-supplies/coverage/">Moving coverage information</a></section></div>`;
  target.querySelector('button').onclick = () => { target.hidden = true; };
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadTaskSources(sourceType, title, description) {
  renderGuidance(title, description, []);
  $('#task-details').querySelector('.local-guidance').innerHTML = '<p class="profile-note">Finding current, cited local information...</p>';
  try {
    const response = await fetch('/api/demo/task-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: state.profile.moveTo, sourceType }) });
    if (!response.ok) throw new Error('Task sources unavailable');
    const data = await response.json();
    renderGuidance(title, description, data.results || []);
  } catch {
    renderGuidance(title, description, []);
  }
}

async function openTask(task, row) {
  if (task.action === 'wizard') {
    const inventory = state.profile.furniture ? `&inventory=${encodeURIComponent(state.profile.furniture)}` : '';
    const simulatorHost = window.location.hostname || '127.0.0.1';
    window.open(`http://${simulatorHost}:4182/?reset=1${inventory}`, '_blank', 'noopener');
    return;
  }
  const details = $('#task-details');
  row.appendChild(details);
  row.classList.add('expanded');
  if (task.action === 'supplies') return renderSuppliesGuidance();
  if (task.action === 'moving-labor') return renderMovingLaborGuidance();
  if (task.action === 'pet-care') return renderPetGuidance();
  if (task.action === 'move-in-checklist') return renderMoveInChecklist();
  if (task.action === 'philly-guide') return renderPhillyGuide();
  if (task.action === 'truck-pickup') return renderArticle('Truck pickup and final packing', 'Finish the inventory, protect the load and bring the documents Penske needs for pickup.', '', ['Label boxes by room: bedroom, living room, kitchen and first night. Keep the 20 medium boxes together by room and mark the three mattresses, three box springs and two sofas for the furniture load plan.', 'Use mattress bags for all three mattresses, moving pads for both sofas and the dresser, and stretch wrap or tie-downs to secure drawers, doors and loose parts. Keep the dining table and six chairs protected and walkways clear.', 'Bring the Penske reservation confirmation, valid driver license, payment method and any additional identification or reservation documents requested in the pickup instructions.', 'Confirm the reserved truck size, pickup time, return location, fuel expectations and truck-safe route before leaving the location.'], [{ title: 'Penske planning guidance', url: 'https://www.pensketruckrental.com/plan-your-move/plan/' }, { title: 'Penske supplies', url: 'https://www.pensketruckrental.com/extras-and-supplies/boxes-supplies/' }]);
  if (task.action === 'move-day') return renderArticle('Move-day loading and driving', 'Use the apartment inventory and the local Exton route to keep the move organized and clearance-aware.', '<img class="article-image" src="assets/exton-clearance-map.png" alt="Exton clearance map with low-clearance warnings" />', ['Load the three mattresses and three box springs securely, then protect and stage the two sofas, dresser, dining table and six chairs before loading the 20 medium boxes.', 'Keep pets in a secured, closed room away from open doors while the crew loads and unloads. They should not be placed in the truck cab or cargo area.', 'Review the Exton clearance map before departure. Watch the low-clearance warnings near the Penske pickup route and do not follow a route beneath a bridge or underpass below the truck height.', 'At the destination, stage the unloading path, protect apartment floors and walls, and confirm elevator or loading access before the seven-person crew starts carrying furniture.'], [{ title: 'Learn how to load a moving truck', url: 'https://www.pensketruckrental.com/plan-your-move/load/learn-how-to-load-a-moving-truck/' }, { title: 'Tips for driving a moving truck', url: 'https://www.pensketruckrental.com/plan-your-move/drive/' }]);
  if (task.action === 'providers') return loadTaskSources('providers', 'Utilities and internet', 'Use these official sources to confirm start-service steps, account setup and current contact details.');
  if (task.action === 'apartment-logistics') return renderApartmentLogistics();
  renderGuidance(task.title, task.detail, task.source_url ? [{ title: 'Open Penske guidance', url: task.source_url, snippet: task.detail }] : []);
}

async function loadMovePlan() {
  showWorkspace('move');
  $('#timeline').innerHTML = '<p class="profile-note">Building your dated checklist and local reference cards...</p>';
  try {
    const response = await fetch('/api/demo/move-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: state.profile }) });
    if (!response.ok) throw new Error('Move plan unavailable');
    const plan = await response.json();
    $('#move-summary').innerHTML = `<strong>Move at a glance:</strong> Three months to move a 3-bedroom apartment in Exton with a cat, a Saint Bernard and a seven-person crew. Start with your inventory and truck fit, then confirm utilities, pet care and move-day access.`;
    renderTimeline(plan.timeline);
    $('#task-details').hidden = true;
  } catch {
    $('#timeline').innerHTML = '<p class="profile-note">The plan could not load. Confirm the local API and web-search connection, then try the scenario again.</p>';
  }
}

const couchOptions = [
  { id: 'a', name: 'Option A', destination: 'Dublin, OH', highwayMiles: 30.8, noHighwayMiles: 26.1, coordinates: [40.0992, -83.1141], color: '#1d4ed8' },
  { id: 'b', name: 'Option B', destination: 'Upper Arlington, OH', highwayMiles: 16.9, noHighwayMiles: 16.1, coordinates: [39.9945, -83.0624], color: '#147d64' },
  { id: 'c', name: 'Option C', destination: 'Bexley, OH', highwayMiles: 29.1, noHighwayMiles: 25.2, coordinates: [39.9689, -82.9377], color: '#b45309' },
];

const pickup = { label: 'Penske Truck Rental, 2470 Westbelt Dr, Columbus, OH 43228', coordinates: [39.9451, -83.1215] };
const selfStoragePickup = { label: 'Gateway Self Storage, 750 E 11th Ave, Columbus, OH 43211', coordinates: [39.9973, -83.0017] };
const home = { label: 'Grandview Heights, OH', coordinates: [39.9809, -83.0402] };
const sampleClearanceHazards = [
  { label: 'Sample: West Goodale St rail bridge · 13 ft 9 in', coordinates: [39.9692, -83.0718] },
  { label: 'Sample: Low-clearance check near Dublin · verify', coordinates: [40.095, -83.13] },
];
const columbusLocationLinks = [
  { title: 'Penske Columbus', url: 'https://www.pensketruckrental.com/locations/us/ohio/columbus/008610/' },
  { title: 'Gateway Self Storage', url: 'https://www.pensketruckrental.com/locations/us/ohio/columbus/008687/' },
];

function setMapFallback() {
  const map = $('#columbus-map');
  if (!map) return;
  map.className = 'map-screenshot';
  const source = $('#pickup-source')?.value === 'self-storage' ? 'Gateway Self Storage' : 'Penske Westbelt';
  const destination = couchOptions.find((option) => option.id === state.activeCouchOption)?.destination || 'Dublin, OH';
  const highwayMode = $('#avoid-highways')?.checked ? 'Avoid highways' : 'Fastest route';
  const sourceKey = $('#pickup-source')?.value === 'self-storage' ? 'self-storage' : 'penske';
  const destinationKey = destination.toLowerCase().replace(/, oh/i, '').replace(/\s+/g, '-');
  const modeKey = $('#avoid-highways')?.checked ? 'no-highway' : 'highway';
  const imagePath = `assets/${sourceKey}-${destinationKey}-${modeKey}.png`;
  const hazard = $('#show-clearance')?.checked ? '<div class="clearance-demo"><img class="clearance-icon" src="assets/clearance-icon.png" alt="Clearance hazard marker" /><img class="clearance-overlay" src="assets/clearance-warning.png" alt="Low-clearance warning" /></div>' : '';
  map.innerHTML = `<img class="route-screenshot" src="${imagePath}" alt="${source} to ${destination} ${highwayMode} route" onerror="this.onerror=null;this.src='assets/clearance-map.png';" /><div class="screenshot-caption"><strong>${source} → ${destination}</strong><span>${highwayMode} · Route image</span></div>${hazard}`;
}

function setMapMode(useFallback) {
  const map = $('#columbus-map');
  if (!map) return;
  map.classList.toggle('map-fallback', useFallback);
  if (useFallback) map.innerHTML = '<div class="map-fallback-label">Columbus route preview<br /><small>Use the Google route links below for live routing.</small></div>';
}

function renderColumbusMap() {
  setMapFallback();
  return;
  setMapMode(false);
  if (!state.map) {
    state.map = L.map('columbus-map', { zoomControl: true, scrollWheelZoom: false }).setView([39.985, -83.055], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(state.map);
  }
  state.mapLayers.forEach((layer) => layer.remove());
  state.mapLayers = [];
  const activePickup = $('#pickup-source')?.value === 'self-storage' ? selfStoragePickup : pickup;
  const addMarker = (coordinates, label, color) => {
    const marker = L.circleMarker(coordinates, { radius: 8, color, fillColor: color, fillOpacity: 0.95, weight: 2 }).bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -7] }).addTo(state.map);
    state.mapLayers.push(marker);
  };
  addMarker(activePickup.coordinates, $('#pickup-source')?.value === 'self-storage' ? 'Self-storage pickup · 16 ft' : 'Penske pickup', '#b7791f');
  addMarker(home.coordinates, 'Grandview home', '#147d64');
  couchOptions.forEach((option) => {
    addMarker(option.coordinates, option.destination.replace(', OH', ''), option.color);
    state.mapLayers.push(L.polyline([activePickup.coordinates, option.coordinates, home.coordinates, activePickup.coordinates], { color: option.color, weight: 3, opacity: 0.75, dashArray: '8 7' }).addTo(state.map));
  });
  if ($('#show-clearance').checked) sampleClearanceHazards.forEach((hazard) => {
    const marker = L.circleMarker(hazard.coordinates, { radius: 7, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.95, weight: 2 }).bindTooltip(hazard.label, { direction: 'top', offset: [0, -7] }).addTo(state.map);
    state.mapLayers.push(marker);
  });
  state.map.invalidateSize();
}

function renderCouchOptions() {
  const target = $('#couch-options');
  const avoidHighways = $('#avoid-highways').checked;
  const unloadMinutes = Math.max(0, Number($('#unload-minutes').value) || 0);
  const activePickup = $('#pickup-source').value === 'self-storage' ? selfStoragePickup : pickup;
  const useSelfStorage = $('#pickup-source').value === 'self-storage';
  target.innerHTML = '';
  couchOptions.forEach((option) => {
    const routeMiles = Math.max(0, Number(avoidHighways ? option.noHighwayMiles : option.highwayMiles) || 0);
    const fixedCost = 29.99;
    const truckLabel = useSelfStorage ? '16-foot truck' : '12-foot truck';
    const mileageRate = 1.19;
    const mpg = 12;
    const fuelPrice = 3.97;
    const mileageCost = routeMiles * mileageRate;
    const fuelCost = routeMiles / mpg * fuelPrice;
    const drivingMinutes = Math.round(routeMiles / (avoidHighways ? 30 : 42) * 60);
    const stopMinutes = unloadMinutes * 2;
    const totalCost = fixedCost + mileageCost + fuelCost;
    const totalMinutes = drivingMinutes + stopMinutes;
    const row = document.createElement('section');
    row.className = 'couch-option';
    const routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(activePickup.label)}&destination=${encodeURIComponent(activePickup.label)}&waypoints=${encodeURIComponent(`${option.destination}|${$('#couch-start').value}`)}&travelmode=driving${avoidHighways ? '&avoid=highways' : ''}`;
    row.innerHTML = `<div><strong>${option.name}</strong><input class="couch-destination" value="${escapeHtml(option.destination)}" aria-label="${option.name} destination" /><button class="preview-route" type="button">${state.activeCouchOption === option.id ? 'Previewing route' : 'Preview route'}</button><span class="route-sequence">${truckLabel}: Penske pickup → couch → Grandview Heights home → Penske return</span></div><label>Google mi<input class="couch-miles" type="number" min="1" step="0.1" value="${routeMiles.toFixed(1)}" aria-label="${option.name} Google Maps reference miles" /></label><div><span class="cost-label">Total estimate</span><br /><span class="cost-value">$${totalCost.toFixed(2)}</span><span class="cost-detail">$${fixedCost.toFixed(2)} daily + $${mileageCost.toFixed(2)} mileage + $${fuelCost.toFixed(2)} fuel</span></div><div><span class="cost-label">Est. time</span><br /><span class="cost-value">${totalMinutes} min</span><span class="cost-detail">${drivingMinutes}m driving + ${stopMinutes}m unloading</span></div><div class="availability"><span>Fuel: ${routeMiles.toFixed(1)} mi ÷ ${mpg} mpg × $${fuelPrice.toFixed(2)}/gal</span><span>Mileage: ${routeMiles.toFixed(1)} mi × $${mileageRate.toFixed(2)}/mi</span><span>${useSelfStorage ? 'Self-storage constraint: 16-foot truck only.' : 'Fixed and mileage rates; mileage is Google Maps reference data.'}</span><a target="_blank" rel="noreferrer" href="https://app.lowclearancemap.com/app/map">Open Low Clearance Map</a><a target="_blank" rel="noreferrer" href="${routeUrl}">Open full Google route</a></div>`;
    row.querySelector('.couch-destination').onchange = (event) => { option.destination = event.target.value.trim() || option.destination; if (state.activeCouchOption === option.id) setMapFallback(); };
    row.querySelector('.couch-miles').onchange = (event) => { const displayedMiles = Math.max(1, Number(event.target.value) || routeMiles); if (avoidHighways) option.noHighwayMiles = displayedMiles; else option.highwayMiles = displayedMiles; renderCouchOptions(); renderColumbusMap(); };
    row.querySelector('.preview-route').onclick = () => { state.activeCouchOption = option.id; renderCouchOptions(); renderColumbusMap(); };
    target.appendChild(row);
  });
}

function applyRelocationDemo() {
  state.profile = { moveDate: '2026-09-11', moveFrom: '109 Commerce Drive, Exton, PA 19341', moveTo: '181 N Pottstown Pike, Exton, PA 19341', homeSize: '4-5 rooms', household: '3-bedroom, 2-bath apartment; one cat, one Saint Bernard; three household movers and four friends', furniture: '3-bedroom apartment with 3 queen mattresses, 3 box springs, 2 sofas, 1 dresser, 1 dining table, 6 dining chairs and 20 medium moving boxes' };
  setProfileMode('relocation');
  $('#profile-panel').hidden = false;
  setProfileMode('relocation');
  localStorage.setItem('penske-assistant-profile', JSON.stringify(state.profile));
  loadProfile();
  state.followupChat = true;
  loadMovePlan();
}

function applyCouchDemo() {
  state.profile = { moveDate: '2026-09-11', moveFrom: 'Penske Truck Rental · 2470 Westbelt Dr, Columbus, OH', moveTo: 'Grandview Heights, OH', homeSize: 'Couch', household: 'Weekend pickup; compare Dublin, Upper Arlington and Bexley; 15 minutes unloading per stop' };
  localStorage.setItem('penske-assistant-profile', JSON.stringify(state.profile));
  setProfileMode('couch');
  $('#profile-panel').hidden = false;
  loadProfile();
  state.followupChat = true;
  showWorkspace('couch');
  $('#couch-start').value = 'Grandview Heights, OH';
  renderCouchOptions();
  setTimeout(renderColumbusMap, 0);
}

function setProfileMode(mode) {
  const couch = mode === 'couch';
  $('#profile-heading').textContent = couch ? 'Pickup plan' : 'Make this useful to you';
  $('#move-date-label').textContent = couch ? 'Pickup date' : 'Move date';
  $('#move-from-label').textContent = couch ? 'Pickup location' : 'Moving from';
  $('#move-to-label').textContent = couch ? 'Return location' : 'Moving to';
  $('#home-size-label').textContent = couch ? 'Item' : 'Home size';
  $('#household-label').textContent = couch ? 'Pickup options' : 'Household details';
  if (couch) {
    $('#home-size').innerHTML = '<option>Couch</option><option>Loveseat</option><option>Sectional</option>';
    $('#home-size').value = 'Couch';
    $('#household').placeholder = 'Destinations, stairs, item dimensions...';
  } else {
    $('#home-size').innerHTML = '<option value="">Choose one</option><option>Studio / 1 room</option><option>2-3 rooms</option><option>4-5 rooms</option><option>6+ rooms</option>';
    $('#household').placeholder = 'Pets, kids, fragile items, towing...';
  }
}

function loadProfile() {
  $('#move-date').value = state.profile.moveDate || '';
  $('#move-from').value = state.profile.moveFrom || '';
  $('#move-to').value = state.profile.moveTo || '';
  $('#home-size').value = state.profile.homeSize || '';
  $('#household').value = state.profile.household || '';
  $('#profile-summary').textContent = state.profile.moveDate || state.profile.moveFrom || state.profile.household
    ? 'Profile saved. I’ll use it as context for future answers.'
    : 'Tell me a little about the move and I’ll focus the guidance.';
}

$('#save-profile').onclick = () => {
  state.profile = { moveDate: $('#move-date').value, moveFrom: $('#move-from').value.trim(), moveTo: $('#move-to').value.trim(), homeSize: $('#home-size').value, household: $('#household').value.trim() };
  localStorage.setItem('penske-assistant-profile', JSON.stringify(state.profile));
  loadProfile();
  addMessage('assistant', 'Got it. I’ll use your move profile when I answer questions.');
};

$('#chat-form').onsubmit = (event) => { event.preventDefault(); ask($('#chat-input').value); $('#chat-input').value = ''; };
document.querySelectorAll('#suggestions button').forEach((button) => { button.onclick = () => { resetDemoScroll(); ask(button.textContent).finally(resetDemoScroll); }; });
document.querySelectorAll('[data-scenario]').forEach((button) => { button.onclick = () => selectScenario(button.dataset.scenario); });
$('#avoid-highways').onchange = () => { renderCouchOptions(); renderColumbusMap(); };
$('#recalculate-couch').onclick = renderCouchOptions;
$('#unload-minutes').onchange = renderCouchOptions;
$('#show-clearance').onchange = () => { renderCouchOptions(); renderColumbusMap(); };
$('#pickup-source').onchange = () => { renderCouchOptions(); renderColumbusMap(); };

fetch('/api/health').then((response) => response.json()).then((health) => {
  state.health = health;
  $('#corpus-status').textContent = `${health.corpusChunks} sources · ${health.llmConfigured ? 'AI configured' : 'local retrieval'}${health.webSearchConfigured ? ' · web lookup ready' : ''}`;
}).catch(() => {});

fetch('/api/corpus')
  .then((response) => response.json())
  .then((corpus) => {
    state.chunks = corpus.chunks || [];
    const health = state.health;
    $('#corpus-status').textContent = `${state.chunks.length} sources · ${health?.llmConfigured ? 'AI configured' : 'local retrieval'}${health?.webSearchConfigured ? ' · web lookup ready' : ''}`;
    addMessage('assistant', 'Hi. I can help turn Penske’s moving guidance into a plan. Tell me what you’re moving, where you’re going, or what feels uncertain.');
  })
  .catch(() => { $('#corpus-status').textContent = 'Sources unavailable'; addMessage('assistant', 'I could not load the local source corpus. Start the workspace server and try again.'); });
loadProfile();
