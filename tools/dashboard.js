// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
// Animation admission is shared with the regression tests. History never pulses.
function newHandoffIds(edges, seen, { continuous = false, nowMs = Date.now() } = {}) {
  if (!continuous) return [];
  return edges.filter(e => e.observed === true && e.kind === 'prerequisite' && typeof e.id === 'string' && !seen.has(e.id) && Number.isFinite(Date.parse(e.at)) && nowMs >= Date.parse(e.at) && nowMs - Date.parse(e.at) <= 15000).map(e => e.id);
}
if (typeof module !== 'undefined') module.exports = { newHandoffIds };
if (typeof document !== 'undefined') (() => {
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const vendors = ['openai', 'anthropic', 'google'];
  const names = { openai: 'Melchior', anthropic: 'Balthasar', google: 'Casper' };
  let data = null, selected = 'all', paused = false, connected = false, pending = false, timer, selectedDispatch = null, fingerprint = '';
  let selectedHandoff = null, followHandoffs = true, seenHandoffs = new Set(), pulsing = new Set(), pulseTimer, observationEpoch = 0;
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
    data.edges.filter(e => e.to === id && e.kind === 'prerequisite' && e.observed).forEach(e => {
      list.append(el('dt', '', 'Upstream handoff · ' + text(e.from)), el('dd', '', 'Launch recorded ' + fullTime(e.at) + ' · Consumer attempt ' + text(e.attemptNumber)));
      list.append(el('dt', '', 'Upstream proof reference'), el('dd', '', e.proofId), el('dt', '', 'Upstream transaction reference'), el('dd', '', e.transactionSha256), el('dt', '', 'Handoff source'), el('dd', '', e.source));
    });
    if (!$('detail').open) $('detail').showModal();
  }
  const edgeKey = edge => edge.id || [edge.kind, edge.from, edge.to].join(':');
  function stopPulses() {
    clearTimeout(pulseTimer); pulsing.clear();
    document.querySelectorAll('.handoff-pulse').forEach(node => node.classList.remove('handoff-pulse'));
  }
  function renderHandoffs(rows) {
    const ids = new Set(rows.map(d => d.id));
    const recordedPairs = new Set(data.edges.filter(e => e.kind === 'prerequisite' && e.observed).map(e => e.from + ':' + e.to));
    const edges = data.edges.filter(e => ['prerequisite', 'planned_dependency'].includes(e.kind) && (e.observed || !recordedPairs.has(e.from + ':' + e.to)) && (ids.has(e.from) || ids.has(e.to)))
      .sort((a, b) => Number(b.observed) - Number(a.observed) || (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    const visible = edges.slice(0, 40);
    if (followHandoffs || !visible.some(e => edgeKey(e) === selectedHandoff)) selectedHandoff = visible.length ? edgeKey(visible[0]) : null;
    const active = visible.find(e => edgeKey(e) === selectedHandoff);
    const from = data.dispatches.find(d => d.id === active?.from), to = data.dispatches.find(d => d.id === active?.to);
    $('handoff-count').textContent = edges.length > 40 ? '40 of ' + edges.length : edges.length;
    $('follow-handoffs').setAttribute('aria-pressed', String(followHandoffs));
    $('handoff-focus').hidden = !active; $('handoff-route').classList.toggle('visible', Boolean(from && to && vendors.includes(from.vendor) && vendors.includes(to.vendor)));
    const focused = document.activeElement?.dataset.handoff;
    $('edges').replaceChildren();
    for (const edge of visible) {
      const a = data.dispatches.find(d => d.id === edge.from), b = data.dispatches.find(d => d.id === edge.to);
      const item = el('button', 'edge' + (edge.observed ? ' observed' : '') + (pulsing.has(edgeKey(edge)) ? ' handoff-pulse' : ''));
      item.type = 'button'; item.dataset.handoff = edgeKey(edge); item.setAttribute('aria-pressed', String(edgeKey(edge) === selectedHandoff));
      item.append(el('span', 'edge-route', (names[a?.vendor] || edge.from) + ' → ' + (names[b?.vendor] || edge.to)), el('span', 'edge-label', edge.observed ? 'Recorded · ' + time(edge.at) : 'Planned'), el('span', 'edge-task', edge.from + ' → ' + edge.to));
      item.addEventListener('click', () => { followHandoffs = false; selectedHandoff = edgeKey(edge); renderHandoffs(filtered(data.dispatches)); });
      $('edges').append(item); if (focused === edgeKey(edge)) item.focus({ preventScroll: true });
    }
    if (!visible.length) $('edges').append(el('p', 'empty', 'No task dependencies for this selection. Independent seats can work in parallel.'));
    for (const vendor of vendors) {
      const node = document.querySelector('.map-seat[data-vendor="' + vendor + '"]');
      node.classList.toggle('route-from', vendor === from?.vendor); node.classList.toggle('route-to', vendor === to?.vendor);
    }
    if (!active || !from || !to) return;
    $('handoff-state').textContent = active.observed ? 'Recorded handoff' : 'Planned dependency';
    $('handoff-state').className = 'status ' + (active.observed ? 'pass' : '');
    $('handoff-time').textContent = active.observed ? fullTime(active.at) : 'Waiting for a launch record';
    $('handoff-from').textContent = names[from.vendor] || from.vendor; $('handoff-to').textContent = names[to.vendor] || to.vendor;
    $('handoff-from-task').textContent = from.id + ' · ' + text(from.role); $('handoff-to-task').textContent = to.id + ' · ' + text(to.role);
    $('handoff-unit').textContent = from.unitId === to.unitId ? 'Unit · ' + from.unitId : 'Units · ' + from.unitId + ' → ' + to.unitId;
    $('handoff-note').textContent = active.observed ? 'The receiving launch records the upstream result as a prerequisite. This does not prove a direct seat message.' : 'The sealed plan declares this dependency. No receiving launch has recorded this handoff.';
    $('handoff-focus').classList.toggle('observed', active.observed); $('handoff-focus').classList.toggle('handoff-pulse', pulsing.has(edgeKey(active)));
    $('handoff-route').classList.toggle('observed', active.observed); $('handoff-route').classList.toggle('handoff-pulse', pulsing.has(edgeKey(active)));
    const positions = { openai: 166, anthropic: 500, google: 834 };
    // Offset inbound/outbound lanes so a same-seat handoff still has two directions.
    $('handoff-in').setAttribute('d', 'M' + (positions[from.vendor] - 10) + ' 189 V137 H490 V126');
    $('handoff-out').setAttribute('d', 'M510 126 V153 H' + (positions[to.vendor] + 10) + ' V189');
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
    renderHandoffs(rows);
    if ($('detail').open && selectedDispatch) showDetail(selectedDispatch);
  }
  function render(snapshot, continuous) {
    const samePlan = data && data.run.id === snapshot.run.id && data.run.planHash === snapshot.run.planHash;
    if (!samePlan) { seenHandoffs.clear(); stopPulses(); selectedHandoff = null; fingerprint = ''; }
    const arrived = newHandoffIds(snapshot.edges, seenHandoffs, { continuous: Boolean(samePlan && continuous) });
    snapshot.edges.forEach(e => seenHandoffs.add(edgeKey(e)));
    if (arrived.length) {
      stopPulses(); pulsing = new Set(arrived);
      $('handoff-announcement').textContent = arrived.length + (arrived.length === 1 ? ' new handoff recorded.' : ' new handoffs recorded.');
      pulseTimer = setTimeout(stopPulses, 4800);
    }
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
    const continuous = connected && !paused && !document.hidden;
    const epoch = observationEpoch;
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/snapshot', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Dashboard link expired or access was refused. Use the current terminal link.' : 'Run data could not be read. Check the dashboard terminal and run directory.');
      const snapshot = await response.json();
      if (snapshot.schemaVersion !== 1 || !snapshot.run || !Array.isArray(snapshot.dispatches) || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.edges)) throw new Error('The dashboard received an incomplete snapshot.');
      connected = !paused && !document.hidden && epoch === observationEpoch; document.body.classList.toggle('stale', paused); connection(paused ? 'Updates paused' : 'Observing', paused ? '' : 'online');
      const warnings = (snapshot.run.warnings || []).filter(w => w !== 'Observer only: recorded execution markers are not revalidated acceptance or current process liveness.');
      notice(warnings.join(' '), false); render(snapshot, continuous && epoch === observationEpoch && !paused && !document.hidden);
    } catch (error) {
      connected = false; stopPulses(); document.body.classList.add('stale'); connection('Connection interrupted', 'error');
      notice((error.name === 'AbortError' ? 'The snapshot request timed out.' : error.message) + (data ? ' Showing the last snapshot from ' + time(data.observedAt) + '.' : ''), true);
    } finally {
      clearTimeout(timeout); pending = false; $('refresh').disabled = false;
      if (!paused && !document.hidden) timer = setTimeout(refresh, 2000);
    }
  }
  document.querySelectorAll('[data-vendor]').forEach(button => button.addEventListener('click', () => selectVendor(button.dataset.vendor)));
  $('search').addEventListener('input', renderWork); $('refresh').addEventListener('click', refresh);
  $('follow-handoffs').addEventListener('click', () => { followHandoffs = !followHandoffs; if (data) renderHandoffs(filtered(data.dispatches)); });
  $('handoff-from').addEventListener('click', () => { const edge = data?.edges.find(e => edgeKey(e) === selectedHandoff); if (edge) showDetail(edge.from); });
  $('handoff-to').addEventListener('click', () => { const edge = data?.edges.find(e => edgeKey(e) === selectedHandoff); if (edge) showDetail(edge.to); });
  $('pause').addEventListener('click', () => {
    paused = !paused; $('pause').setAttribute('aria-pressed', String(paused)); $('pause').textContent = paused ? 'Resume updates' : 'Pause updates';
    $('footer-state').textContent = paused ? 'Updates paused · Refresh reads one snapshot' : 'Auto-refresh every 2 seconds';
    if (paused) { observationEpoch++; clearTimeout(timer); stopPulses(); connected = false; connection('Updates paused'); document.body.classList.add('stale'); } else refresh();
  });
  $('close-detail').addEventListener('click', () => $('detail').close());
  $('detail').addEventListener('close', () => { selectedDispatch = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { observationEpoch++; clearTimeout(timer); stopPulses(); connected = false; } else if (!paused) refresh(); });
  // Keep the private fragment intact when using in-page keyboard navigation.
  document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); $('work').scrollIntoView(); $('work').focus({ preventScroll: true }); });
  refresh();
})();
