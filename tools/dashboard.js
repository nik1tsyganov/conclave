'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const vendors = ['openai', 'anthropic', 'google'];
  const names = { openai: 'Melchior', anthropic: 'Balthasar', google: 'Casper' };
  let data = null, selected = 'all', paused = false, connected = false, pending = false, timer, selectedDispatch = null, fingerprint = '';
  const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const label = value => text(value).replace(/^RECORDED_/, '').replaceAll('_', ' ');
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const fullTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—';
  const stateClass = status => status === 'PASS' ? 'pass' : /FAIL|ERROR|INCONSISTENT/.test(status || '') ? 'fail' : /RUNNING|AWAITING/.test(status || '') ? 'wait' : '';
  const statusLabel = status => status === 'RUNNING' ? 'Awaiting result' : status === 'AWAITING_ATTESTATION' ? 'Awaiting attestation' : label(status);
  const el = (tag, className, content) => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = text(content); return node; };
  const filtered = rows => rows.filter(d => (selected === 'all' || d.vendor === selected) && (d.id + ' ' + d.unitId + ' ' + d.vendor + ' ' + d.model + ' ' + d.role + ' ' + d.status).toLowerCase().includes($('search').value.trim().toLowerCase()));
  function connection(message, kind) { $('connection').className = 'connection ' + (kind || ''); $('connection').lastElementChild.textContent = message; }
  function notice(message, error) { $('notice').hidden = !message; $('notice').textContent = message || ''; $('notice').className = 'notice' + (error ? ' error' : ''); }
  function selectVendor(vendor) {
    selected = vendor;
    document.querySelectorAll('[data-vendor]').forEach(b => { const match = b.dataset.vendor === vendor; b.setAttribute('aria-pressed', String(match)); b.classList.toggle('selected', match); });
    renderWork();
  }
  function showDetail(id) {
    const d = data?.dispatches.find(row => row.id === id); if (!d) return;
    selectedDispatch = id; $('detail-title').textContent = d.id; const list = $('detail-fields'); list.replaceChildren();
    const fields = [['Seat', names[d.vendor] || d.vendor], ['Unit', d.unitId], ['Role', d.role], ['Task class', d.taskClass], ['Requested model', d.model], ['Requested effort', d.effort], ['Recorded execution', d.status], ['Recorded vote', d.vote], ['Reserved at', fullTime(d.startedAt)], ['Committed at', fullTime(d.completedAt)], ['Last signal', fullTime(d.lastEventAt)], ['Proof reference', d.proofId], ['Recorded issue', d.issue], ['Recorded attempts', Array.isArray(d.attempts) ? d.attempts.length : d.attempts || 0]];
    fields.forEach(([key, value]) => list.append(el('dt', '', key), el('dd', '', value)));
    if (Array.isArray(d.attempts)) d.attempts.forEach(a => list.append(el('dt', '', 'Attempt ' + text(a.number)), el('dd', '', text(a.id) + ' · ' + text(a.status) + ' · ' + fullTime(a.completedAt || a.startedAt))));
    if (!$('detail').open) $('detail').showModal();
  }
  function renderWork() {
    if (!data) return;
    const rows = filtered(data.dispatches); const list = $('dispatches'); const focused = document.activeElement?.dataset.dispatch;
    list.replaceChildren(); $('work-count').textContent = rows.length;
    for (const d of rows) {
      const button = el('button', 'dispatch'); button.type = 'button'; button.dataset.dispatch = d.id;
      const head = el('span', 'dispatch-head'); head.append(el('strong', '', d.id), el('span', 'status ' + stateClass(d.status), statusLabel(d.status)));
      button.append(head, el('span', 'unit', text(d.unitId) + ' / ' + text(d.role)), el('span', 'meta', text(d.model) + ' · ' + text(d.effort) + '   /   Last signal ' + time(d.lastEventAt)));
      button.addEventListener('click', () => showDetail(d.id)); list.append(button);
      if (focused === d.id) button.focus({ preventScroll: true });
    }
    if (!rows.length) list.append(el('p', 'empty', data.dispatches.length ? 'No dispatches match this filter.' : 'No dispatches have been recorded in this plan.'));
    const ids = new Set(rows.map(d => d.id));
    const events = data.events.filter(e => ids.has(e.dispatchId) || (selected === 'all' && !e.dispatchId));
    $('event-count').textContent = events.length; $('events').replaceChildren();
    for (const event of [...events].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 120)) {
      const item = el('li', 'event'); const head = el('header'); const clock = el('time', '', time(event.at)); if (event.at) clock.dateTime = event.at;
      head.append(el('strong', '', event.dispatchId || 'Arbiter'), clock); item.append(head, el('p', '', event.summary || label(event.kind))); $('events').append(item);
    }
    if (!events.length) $('events').append(el('li', 'empty', 'No recorded signals for this selection.'));
    $('edges').replaceChildren();
    const edges = data.edges.filter(e => !['dispatch', 'result'].includes(e.kind) && (ids.has(e.from) || ids.has(e.to)));
    for (const edge of edges.slice(0, 40)) {
      const item = el('div', 'edge' + (edge.observed ? ' observed' : ''));
      item.append(el('span', '', edge.from), el('span', 'arrow', '→'), el('span', '', edge.to), el('span', 'edge-label', edge.observed ? 'Bound prerequisite' : 'Planned dependency')); $('edges').append(item);
    }
    if (!edges.length) $('edges').append(el('p', 'empty', 'No prerequisite handoffs recorded for this selection.'));
    if ($('detail').open && selectedDispatch) showDetail(selectedDispatch);
  }
  function render(snapshot) {
    data = snapshot; $('run-name').textContent = text(data.run.id) + ' / ' + text(data.run.mode);
    $('dispatch-count').textContent = data.dispatches.length; $('all-count').textContent = data.dispatches.length;
    $('execution').textContent = label(data.run.executionStatus); $('approval').textContent = label(data.run.approvalStatus); $('snapshot-time').textContent = time(data.observedAt);
    for (const vendor of vendors) {
      const rows = data.dispatches.filter(d => d.vendor === vendor); const node = document.querySelector('.map-seat[data-vendor="' + vendor + '"]');
      const waiting = rows.filter(d => ['RUNNING', 'AWAITING_ATTESTATION'].includes(d.status)); const passed = rows.filter(d => d.status === 'PASS').length; const failed = rows.filter(d => /FAIL|ERROR|INCONSISTENT/.test(d.status)).length;
      const planned = rows.length > 0 && rows.every(d => d.status === 'NOT_STARTED');
      const notRun = rows.length > 0 && rows.every(d => d.status === 'NOT_RUN');
      const recent = connected && !paused && waiting.some(d => Date.now() - Date.parse(d.lastEventAt) < 60000 && Date.now() >= Date.parse(d.lastEventAt));
      $('' + vendor + '-count').textContent = rows.length; node.classList.toggle('recent', recent);
      node.querySelector('.node-signal').textContent = waiting.length ? recent ? 'Recent signal' : 'Awaiting update' : planned ? 'Planned' : notRun ? 'Not run' : rows.length ? 'Recorded' : 'Not in plan';
      node.querySelector('.node-model').textContent = [...new Set(rows.map(d => d.model))].join(' / ') || 'No dispatch planned';
      node.querySelector('.node-bottom').textContent = planned || notRun ? rows.length + (rows.length === 1 ? ' dispatch ' : ' dispatches ') + (planned ? 'planned' : 'not run') : rows.length ? passed + ' passed · ' + failed + ' failed · ' + waiting.length + ' awaiting result' : 'This seat has no work in this plan';
      const recorded = data.edges.some(e => e.observed && ['dispatch', 'result'].includes(e.kind) && rows.some(d => d.id === e.from || d.id === e.to));
      node.classList.toggle('recorded', recorded); node.classList.toggle('absent', !rows.length);
      $('wire-' + vendor).classList.toggle('recorded', recorded); $('wire-' + vendor).classList.toggle('inactive', !rows.length);
    }
    document.querySelector('.map-seats').classList.toggle('has-recorded', data.edges.some(e => e.observed && ['dispatch', 'result'].includes(e.kind)));
    const next = JSON.stringify([data.dispatches, data.events, data.edges]); if (next !== fingerprint) { fingerprint = next; renderWork(); }
  }
  async function refresh() {
    if (pending) return;
    clearTimeout(timer); pending = true; $('refresh').disabled = true;
    if (!token) { connection('Link required', 'error'); notice('Open the complete dashboard link printed in your terminal. Its private token stays in this browser.', true); pending = false; $('refresh').disabled = false; return; }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/snapshot', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Dashboard link expired or access was refused. Use the current terminal link.' : 'Run data could not be read. Check the dashboard terminal and run directory.');
      const snapshot = await response.json();
      if (snapshot.schemaVersion !== 1 || !snapshot.run || !Array.isArray(snapshot.dispatches) || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.edges)) throw new Error('The dashboard received an incomplete snapshot.');
      connected = true; document.body.classList.remove('stale'); connection(paused ? 'Updates paused' : 'Observing', paused ? '' : 'online');
      const warnings = (snapshot.run.warnings || []).filter(w => w !== 'Observer only: recorded execution markers are not revalidated acceptance or current process liveness.');
      notice(warnings.join(' '), false); render(snapshot);
    } catch (error) {
      connected = false; document.body.classList.add('stale'); connection('Connection interrupted', 'error');
      notice((error.name === 'AbortError' ? 'The snapshot request timed out.' : error.message) + (data ? ' Showing the last snapshot from ' + time(data.observedAt) + '.' : ''), true);
    } finally {
      clearTimeout(timeout); pending = false; $('refresh').disabled = false;
      if (!paused && !document.hidden) timer = setTimeout(refresh, 2000);
    }
  }
  document.querySelectorAll('[data-vendor]').forEach(button => button.addEventListener('click', () => selectVendor(button.dataset.vendor)));
  $('search').addEventListener('input', renderWork); $('refresh').addEventListener('click', refresh);
  $('pause').addEventListener('click', () => {
    paused = !paused; $('pause').setAttribute('aria-pressed', String(paused)); $('pause').textContent = paused ? 'Resume updates' : 'Pause updates';
    $('footer-state').textContent = paused ? 'Updates paused · Refresh reads one snapshot' : 'Auto-refresh every 2 seconds';
    if (paused) { clearTimeout(timer); connection('Updates paused'); document.body.classList.add('stale'); } else refresh();
  });
  $('close-detail').addEventListener('click', () => $('detail').close());
  $('detail').addEventListener('close', () => { selectedDispatch = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (!paused) refresh(); });
  // Keep the private fragment intact when using in-page keyboard navigation.
  document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); $('work').scrollIntoView(); $('work').focus({ preventScroll: true }); });
  refresh();
})();
