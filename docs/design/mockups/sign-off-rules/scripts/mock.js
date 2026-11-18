// Mocks, injected into the real running app: real shell, real CSS, mocked content.
const { chromium } = require('@playwright/test');

const I = {
  rules: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  seal: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  draft: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/><path d="m15 5 3 3"/>',
  waiting: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  cr: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  add: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
const svg = (k, size = 'sm') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="var(--brand-icon-${size})" height="var(--brand-icon-${size})" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--brand-icon-stroke)" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

const face = (initials, tone) =>
  `<span class="mk-face mk-face--${tone}" title="${initials}">${initials}</span>`;
const faces = (list) => `<span class="mk-faces">${list.map(([i, t]) => face(i, t)).join('')}</span>`;

const CSS = `
.mk-faces{display:inline-flex}
.mk-face{display:inline-grid;place-items:center;width:var(--brand-space-6);height:var(--brand-space-6);border-radius:var(--brand-radius-full);font:500 var(--brand-text-ui-xs)/1 var(--brand-font-sans);color:var(--bs-text-primary);border:2px solid var(--bs-surface-1);margin-left:var(--brand-space-0-5)}
.mk-face:first-child{margin-left:0}
.mk-face--1{background:var(--bs-status-info-bg)} .mk-face--2{background:var(--bs-status-ok-bg)} .mk-face--3{background:var(--bs-status-warn-bg)} .mk-face--4{background:var(--bs-surface-3)}
.mk-rule{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--brand-space-1) var(--brand-space-2-5);align-items:center;padding:var(--brand-space-2-5) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm)}
.mk-rule:first-of-type{border-top:none}
.mk-rule-icon{color:var(--bs-text-muted);display:inline-flex}
.mk-rule-name{font:500 var(--brand-text-ui-md)/1.3 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-rule-why{grid-column:2/4;font:400 var(--brand-text-ui-xs)/1.4 var(--brand-font-sans);color:var(--bs-text-muted);margin-top:calc(-1 * var(--brand-space-1))}
.mk-rule-why a{color:var(--bs-coral-text);text-decoration:none}
.mk-rule--added{background:var(--bs-status-ok-bg);box-shadow:inset 3px 0 0 var(--bs-status-ok-fg)}
.mk-rule--added .mk-rule-why{color:var(--bs-status-ok-fg)}
.mk-lead{margin:0;padding:var(--brand-space-2-5) var(--brand-space-3) var(--brand-space-1);font:400 var(--brand-text-ui-sm)/1.45 var(--brand-font-sans);color:var(--bs-text-secondary)}
.mk-foot{display:flex;flex-direction:column;gap:var(--brand-space-1-5);align-items:flex-start}
.mk-footnote{font:400 var(--brand-text-ui-xs)/1.4 var(--brand-font-sans);color:var(--bs-text-muted)}
.mk-table{width:100%;border-collapse:collapse;font-family:var(--brand-font-sans)}
.mk-table th{text-align:left;font:500 var(--brand-text-ui-xs)/1 var(--brand-font-sans);color:var(--bs-text-muted);padding:var(--brand-space-2-5) var(--brand-space-3);border-bottom:1px solid var(--bs-rule-warm)}
.mk-table td{padding:var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);font-size:var(--brand-text-ui-sm);color:var(--bs-text-secondary);vertical-align:middle}
.mk-table tr:first-child td{border-top:none}
.mk-table td.mk-docname{color:var(--bs-text-primary);font-size:var(--brand-text-ui-lg);font-weight:500}
.mk-docname span{display:inline-flex;align-items:center;gap:var(--brand-space-2)}
.mk-docname svg{color:var(--bs-text-muted)}
.mk-ver{display:inline-flex;align-items:center;gap:var(--brand-space-1);color:var(--bs-status-ok-fg);font-weight:500}
.mk-sub{display:block;font-size:var(--brand-text-ui-xs);color:var(--bs-text-muted);margin-top:var(--brand-space-0-5)}
.mk-titlerow{display:flex;align-items:center;gap:var(--brand-space-2-5)}
.mk-titlerow svg{color:var(--bs-text-muted)}
.mk-meta{margin:var(--brand-space-1-5) 0 0;color:var(--bs-text-muted);font:400 var(--brand-text-ui-sm)/1.4 var(--brand-font-sans)}
.mk-callout{position:fixed;z-index:9999;max-width:260px;padding:var(--brand-space-2) var(--brand-space-3);border-radius:var(--brand-radius-md);background:var(--brand-ink);color:var(--brand-on-brand);font:400 var(--brand-text-ui-xs)/1.45 var(--brand-font-sans);box-shadow:var(--bs-shadow-lg)}
.mk-callout b{display:block;font-weight:600;margin-bottom:var(--brand-space-0-5);color:var(--brand-coral-mid)}
.mk-callout::before{content:attr(data-n);position:absolute;left:calc(-1 * var(--brand-space-3));top:calc(-1 * var(--brand-space-3));width:var(--brand-space-6);height:var(--brand-space-6);border-radius:var(--brand-radius-full);background:var(--brand-coral);color:var(--brand-on-coral);display:grid;place-items:center;font-weight:700}
/* editor */
.mk-folder-sheet{width:min(100%, 880px);margin:var(--brand-space-6) auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:var(--brand-space-5);align-items:start}
.mk-folder-sheet .bs-panel{background:var(--bs-surface-1)}
.mk-sheet-head{grid-column:1/3;background:var(--bs-surface-1);border:1px solid var(--bs-rule);border-radius:var(--brand-radius-xl);padding:var(--brand-space-5) var(--brand-space-6);display:flex;justify-content:space-between;align-items:flex-start;gap:var(--brand-space-4)}
.mk-sheet-head h1{margin:0;font:600 var(--brand-text-h3)/1.2 var(--brand-font-serif);color:var(--bs-text-primary)}
.mk-ribbon-locked{opacity:.45;pointer-events:none}
.mk-tag{display:inline-flex;align-items:center;gap:var(--brand-space-1);padding:var(--brand-space-0-5) var(--brand-space-2);border-radius:var(--brand-radius-sm);font:500 var(--brand-text-ui-xs)/1.4 var(--brand-font-sans)}
.mk-tag--draft{background:var(--bs-status-info-bg);color:var(--bs-status-info-fg);border:1px solid var(--bs-status-info-border)}
.mk-tag--added{background:var(--bs-status-ok-bg);color:var(--bs-status-ok-fg);border:1px solid var(--bs-status-ok-border)}
.mk-x{margin-left:auto;color:var(--bs-text-muted);display:inline-flex}
.mk-addrow{display:flex;gap:var(--brand-space-2);align-items:center;padding:var(--brand-space-2) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);color:var(--bs-coral-text);font:500 var(--brand-text-ui-sm)/1 var(--brand-font-sans)}
/* change */
.mk-rulechange{border:1px solid var(--bs-status-warn-border);border-radius:var(--brand-radius-lg);background:var(--bs-surface-1);overflow:hidden}
.mk-rulechange-bar{display:flex;align-items:center;gap:var(--brand-space-2);padding:var(--brand-space-2-5) var(--brand-space-3);background:var(--bs-status-warn-bg);color:var(--bs-status-warn-fg);font:600 var(--brand-text-ui-md)/1.3 var(--brand-font-sans)}
.mk-rulechange-bar .mk-sp{flex:1}
.mk-rulechange-bar .mk-small{font-weight:400;font-size:var(--brand-text-ui-xs)}
.mk-rc-row{display:grid;grid-template-columns:200px minmax(0,1fr);gap:var(--brand-space-3);padding:var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);align-items:start}
.mk-rc-row:first-of-type{border-top:none}
.mk-rc-where{display:flex;gap:var(--brand-space-2);align-items:center;font:500 var(--brand-text-ui-md)/1.3 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-rc-where svg{color:var(--bs-text-muted)}
.mk-rc-who{display:flex;flex-wrap:wrap;gap:var(--brand-space-1-5);align-items:center}
.mk-chip{display:inline-flex;align-items:center;gap:var(--brand-space-1);padding:var(--brand-space-0-5) var(--brand-space-2);border-radius:var(--brand-radius-sm);border:1px solid var(--bs-rule);background:var(--bs-surface-2);font:500 var(--brand-text-ui-sm)/1.4 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-chip--add{background:var(--bs-status-ok-bg);border-color:var(--bs-status-ok-border);color:var(--bs-status-ok-fg)}
.mk-chip--del{background:var(--bs-status-danger-bg);border-color:var(--bs-status-danger-border);color:var(--bs-status-danger-fg);text-decoration:line-through}
.mk-rc-effect{grid-column:2;font:400 var(--brand-text-ui-xs)/1.45 var(--brand-font-sans);color:var(--bs-text-muted)}
.mk-rc-note{margin:0;padding:var(--brand-space-2-5) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);background:var(--bs-surface-2);font:400 var(--brand-text-ui-xs)/1.5 var(--brand-font-sans);color:var(--bs-text-secondary)}
.mk-rc-note strong{color:var(--bs-text-primary)}
.mk-tree-rules .bs-row-icon{color:var(--bs-status-warn-fg)}
`;

const PO = [['AN', 1], ['PR', 2]];
const IC = [['GI', 3], ['IM', 1]];
const QC = [['PR', 2], ['DW', 4], ['HL', 3]];

const ruleRow = ({ name, why, who, cls = '', icon = 'people', extra = '' }) => `
  <div class="mk-rule ${cls}">
    <span class="mk-rule-icon">${svg(icon)}</span>
    <span class="mk-rule-name">${name}</span>
    ${who}
    <span class="mk-rule-why">${why}</span>${extra}
  </div>`;

const docsTable = `
  <section class="bs-panel">
    <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">Documents</h2><span class="bs-section-count">2</span></div>
    <table class="mk-table">
      <thead><tr><th>Name</th><th>On the record</th><th>Last approved</th></tr></thead>
      <tbody>
        <tr><td class="mk-docname"><span>${svg('doc')}Hand Hygiene</span></td>
          <td><span class="mk-ver">${svg('seal')}Version 2</span></td>
          <td>Nov 9, 2026<span class="mk-sub">Alice Nguyen and Grace Ibori</span></td></tr>
        <tr><td class="mk-docname"><span>${svg('doc')}Sepsis Pathway</span></td>
          <td><span class="mk-ver">${svg('seal')}Version 1</span></td>
          <td>Nov 9, 2026<span class="mk-sub">Alice Nguyen and Ines Moreau</span></td></tr>
      </tbody>
    </table>
  </section>`;

const signsOffPanel = (opts = {}) => `
  <section class="bs-panel" aria-labelledby="mk-signs">
    <div class="bs-panel-bar"><h2 class="bs-panel-bar-title" id="mk-signs">Who signs off here</h2>
      ${opts.draftTag ? '<span class="bs-panel-bar-spacer"></span><span class="mk-tag mk-tag--draft">' + svg('draft', 'xs') + 'Changed in your draft</span>' : ''}</div>
    <p class="mk-lead">${opts.lead || 'Publishing anything in this folder needs one approval from each of:'}</p>
    ${ruleRow({ name: 'Infection Control', who: faces(IC), why: 'Set on this folder' , extra: opts.edit ? '' : ''})}
    ${opts.added ? ruleRow({ name: 'Quality Committee', who: faces(QC), why: 'Added in your draft — applies once it is published', cls: 'mk-rule--added' }) : ''}
    ${ruleRow({ name: 'Policy Office', who: faces(PO), why: 'From the whole binder · <a href="#">Governance</a>' })}
    ${ruleRow({ name: '2 approvals', icon: 'rules', who: '', why: "From the binder's approvers, counted together" })}
    ${opts.edit ? `<div class="mk-addrow">${svg('add')}Add a group or a person</div>` : ''}
    <div class="bs-panel-foot mk-foot">
      ${opts.foot || `<button type="button" class="bs-btn bs-btn--sm bs-btn-secondary">${svg('edit')}Change who signs off</button>
      <span class="mk-footnote">Goes into a draft. Policy Office approves any change to who signs off.</span>`}
    </div>
  </section>`;

const waitingPanel = `
  <section class="bs-panel">
    <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">Waiting on a decision</h2><span class="bs-section-count bs-section-count--attention">1</span></div>
    <ul class="bs-row-list"><li><a class="bs-row bs-row--tall" href="#"><span class="bs-row-body">
      <span class="bs-row-name bs-row-name--wrap">Change who signs off on this binder</span>
      <span class="bs-row-meta">#8 · Would add the Quality Committee here</span></span></a></li></ul>
  </section>`;

async function callout(p, n, x, y, title, body) {
  await p.evaluate(({ n, x, y, title, body }) => {
    const d = document.createElement('div');
    d.className = 'mk-callout'; d.dataset.n = n; d.style.left = x + 'px'; d.style.top = y + 'px';
    d.innerHTML = `<b>${title}</b>${body}`;
    document.body.appendChild(d);
  }, { n, x, y, title, body });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: 'state.json' });
  const p = await ctx.newPage();
  const G = 'http://localhost:21390/riverside-health/governance';
  const annotate = process.env.NOTES !== '0';

  // ── 1. Folder page, binder view ─────────────────────────────────────────
  await p.goto(G + '/-/blob/main/clinical-standards/hand-hygiene'); await p.waitForTimeout(3500);
  await p.evaluate(({ CSS, docsTable, signs, waiting, folderSvg }) => {
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    history.replaceState(null, '', location.pathname.replace('/-/blob/main/clinical-standards/hand-hygiene', '/-/tree/main/clinical-standards'));
    // Explorer: the folder is what is open now.
    document.querySelectorAll('.app-explorer-item--active').forEach((e) => { e.classList.remove('app-explorer-item--active'); e.removeAttribute('aria-current'); });
    const f = document.querySelector('.app-explorer-folder[aria-expanded="true"]');
    if (f) { f.classList.add('app-explorer-item--active'); f.style.background = 'var(--bs-surface-2)'; f.style.fontWeight = '600'; }
    const crumbs = document.querySelector('.page-path-list');
    if (crumbs) crumbs.innerHTML = '<li class="page-path-step"><a class="page-path-link" href="#">Governance</a></li><li class="page-path-step"><span class="page-path-sep">/</span><span class="page-path-text page-path-text--current">Clinical Standards</span></li>';
    const pane = document.querySelector('.binder-pane');
    pane.innerHTML = `
      <header class="bs-pagehead">
        <div class="bs-pagehead-body">
          <div class="mk-titlerow">${folderSvg}<h1 class="bs-title">Clinical Standards</h1></div>
          <p class="mk-meta">A folder in Governance · 2 documents · last published Nov 9, 2026</p>
        </div>
        <div class="bs-pagehead-actions">
          <button class="bs-btn bs-btn-secondary" type="button">Rename or move</button>
          <button class="bs-btn bs-btn-primary" type="button">Add a document here</button>
        </div>
      </header>
      <div class="doc-workspace">
        <div class="doc-workspace-main">${docsTable}</div>
        <aside class="doc-rail" aria-label="Folder summary">${signs}${waiting}</aside>
      </div>`;
  }, { CSS, docsTable, signs: signsOffPanel(), waiting: waitingPanel, folderSvg: svg('folder', 'lg') });
  if (annotate) {
    await callout(p, '1', 100, 600, 'The name opens the folder', 'The arrow still opens and shuts it in place. Clicking the name puts the folder here, the way Explorer and SharePoint do.');
    await callout(p, '2', 380, 490, 'The surveyor question, per folder', 'What is on the record and when it was approved — for every document in the folder at once.');
    await callout(p, '3', 700, 490, 'Every rule that applies, and where it comes from', 'The binder\'s own rule is shown here too, because rules stack: each one must be met.');
  }
  await p.screenshot({ path: 'shots/mock-1-folder-binder.png' });

  // ── 2. Folder on the editor's desk ──────────────────────────────────────
  await p.goto(G + '/-/blob/main/governance-charter?edit=write&draft=draft%2Falice%2F20261109210257550'); await p.waitForTimeout(6000);
  const fl = p.locator('.app-explorer-folder[data-folder="clinical-standards"]');
  for (let i = 0; i < 3 && (await fl.getAttribute('aria-expanded')) !== 'true'; i++) { await fl.click(); await p.waitForTimeout(700); }
  await p.mouse.move(1300, 850);
  await p.evaluate(({ CSS, docsTable, signs, folderSvg }) => {
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    history.replaceState(null, '', location.pathname.replace('/-/blob/main/governance-charter', '/-/tree/main/clinical-standards') + location.search);
    document.querySelectorAll('.app-explorer-item--active').forEach((e) => e.classList.remove('app-explorer-item--active'));
    const f = document.querySelector('.app-explorer-folder[data-folder="clinical-standards"]');
    f.style.background = 'var(--bs-surface-2)'; f.style.fontWeight = '600';
    // Mark the folder as changed in the draft, the way the panel marks a changed row.
    f.insertAdjacentHTML('beforeend', '<span style="margin-left:auto;width:6px;height:6px;border-radius:9999px;background:var(--bs-status-info-fg)"></span>');
    // Header title: the folder's name.
    const t = [...document.querySelectorAll('header *, .doc-editor-page *')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Governance Charter');
    if (t) t.textContent = 'Clinical Standards';
    // The ribbon is locked, as it is for a Word file on the desk.
    const pm = document.querySelector('.ProseMirror');
    const desk = document.querySelector('.bs-doc-desk');
    let e = pm; while (e && !(e.parentElement && e.parentElement.classList.contains('bs-doc-editor'))) e = e.parentElement;
    const body = document.querySelector('.bs-doc-body');
    [...(body ? body.parentElement.children : [])].forEach((c) => { if (c !== body) c.classList.add('mk-ribbon-locked'); });
    document.querySelectorAll('[role="tablist"], [role="toolbar"]').forEach((x) => x.classList.add('mk-ribbon-locked'));
    const wrap = document.querySelector('.bs-doc-sheetwrap');
    wrap.innerHTML = `
      <div class="mk-folder-sheet">
        <div class="mk-sheet-head">
          <div>
            <div class="mk-titlerow">${folderSvg}<h1>Clinical Standards</h1></div>
            <p class="mk-meta">Folder · 2 documents · in Draft of 9 November</p>
          </div>
          <span class="doc-editor-cover-actions" style="display:flex;gap:var(--brand-space-2)">
            <button class="bs-btn bs-btn-secondary bs-btn--sm" type="button">New folder here</button>
            <button class="bs-btn bs-btn-primary bs-btn--sm" type="button">New document here</button>
          </span>
        </div>
        <div>${docsTable}</div>
        <div>${signs}</div>
      </div>`;
    // Status bar: no page count for a folder.
    document.querySelectorAll('*').forEach((x) => { if (x.children.length === 0 && /^Page 1 of 1$/.test(x.textContent.trim())) x.textContent = 'Folder'; });
    const w = [...document.querySelectorAll('*')].filter((x) => /^\d+\s*words$/.test(x.textContent.trim())).pop(); if (w) w.textContent = '1 change in your draft';
  }, {
    CSS, docsTable, folderSvg: svg('folder', 'lg'),
    signs: signsOffPanel({
      added: true, edit: true, draftTag: true,
      lead: 'Publishing anything in this folder will need one approval from each of:',
      foot: `<span class="mk-footnote">Saved to Draft of 9 November. It applies once the draft is proposed, approved by the Policy Office, and published.</span>`,
    }),
  });
  if (annotate) {
    await callout(p, '1', 330, 580, 'A folder is a place on the desk', 'Ribbon locked, as for a Word file. Your open documents keep their unsaved words; Back returns to the page.');
    await callout(p, '2', 1150, 330, 'Edited in the draft, like everything else', 'Same save model as a rename or a move. Marked as a draft change until it is published.');
  }
  await p.screenshot({ path: 'shots/mock-2-folder-editor.png' });

  // ── 3. A mixed change: one document and a rule ──────────────────────────
  await p.goto('http://localhost:21390/riverside-health/clinical/-/changes/7/diffs'); await p.waitForTimeout(6000);
  await p.evaluate(({ CSS, s }) => {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    history.replaceState(null, '', '/riverside-health/governance/-/changes/9/diffs');
    const swap = (from, to) => document.querySelectorAll('*').forEach((x) => { if (x.children.length === 0 && x.textContent.trim() === from) x.textContent = to; });
    swap('Clinical', 'Governance'); swap('Change 7', 'Change 9');
    document.querySelector('.bs-title').textContent = 'Bare below the elbows for pharmacy, and the Quality Committee signs off clinical standards';
    const by = document.querySelector('.cmp-byline'); if (by) by.innerHTML = by.innerHTML.replace('wants to publish 1 document from', 'wants to publish 1 document and change who signs off, from');
    const sc = document.querySelector('.cmp-scale'); if (sc) sc.textContent = '1 document · 31 words added, 3 words removed · 1 sign-off rule';
    document.querySelectorAll('.doc-tab-count').forEach((c) => (c.textContent = '2'));
    const path = document.querySelector('.cmp-file-path'); if (path) path.textContent = 'clinical-standards/hand-hygiene';
    const step = document.querySelector('.cmp-file-step'); if (step) step.textContent = 'v2 → v3';
    const h = document.querySelector('.cmp-file-body h1, .cmp-file-body h2'); if (h) h.textContent = 'Hand Hygiene and PPE';
    const layout = document.querySelector('.cmp-layout'); layout.classList.add('cmp-layout--tree');
    const stream = document.querySelector('.cmp-stream');
    stream.insertAdjacentHTML('afterbegin', `
      <section class="mk-rulechange" id="cmp-sign-off" aria-label="Who signs off">
        <div class="mk-rulechange-bar">${s.rules}Who signs off<span class="mk-sp"></span><span class="mk-small">Read this before the document</span></div>
        <div class="mk-rc-row">
          <span class="mk-rc-where">${s.folder}Clinical Standards</span>
          <span class="mk-rc-who"><span class="mk-chip">${s.people}Infection Control</span><span class="mk-chip mk-chip--add">${s.add}Quality Committee</span></span>
          <span class="mk-rc-effect">After this is published, every document in Clinical Standards needs an approval from the Quality Committee as well — both of the documents in it today.</span>
        </div>
        <p class="mk-rc-note"><strong>Counted under the rules in force today.</strong> The Policy Office signs off any change to who signs off, so this change needs them whatever else it holds. Hand Hygiene v3 is approved under today's rule; the Quality Committee's rule starts with the next change.</p>
      </section>`);
    layout.insertAdjacentHTML('afterbegin', `
      <aside class="bs-rail cmp-tree"><nav class="bs-panel" aria-label="In this change">
        <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">In this change</h2><span class="bs-row-meta cmp-tree-progress">0 of 2 viewed</span></div>
        <ol class="cmp-tree-list">
          <li><ol class="bs-row-list mk-tree-rules"><li><button class="bs-row bs-row--on" type="button"><span class="bs-row-icon">${s.rules}</span><span class="bs-row-body"><span class="bs-row-name">Who signs off</span></span><span class="bs-row-meta">1 rule</span></button></li></ol></li>
          <li><span class="cmp-tree-folder">${s.folder}clinical-standards</span>
            <ol class="bs-row-list"><li><button class="bs-row" type="button"><span class="bs-row-icon cmp-rail-icon--revised">${s.doc}</span><span class="bs-row-body"><span class="bs-row-name">Hand Hygiene</span></span><span class="cmp-counts"><span class="cmp-counts-add">+31</span> <span class="cmp-counts-del">−3</span></span></button></li></ol></li>
        </ol></nav></aside>`);
  }, { CSS, s: { rules: svg('rules', 'md'), folder: svg('folder'), people: svg('people', 'xs'), add: svg('add', 'xs'), doc: svg('doc') } });
  await p.waitForTimeout(500);
  if (annotate) {
    await callout(p, '1', 252, 590, 'The rule change comes first', 'Above any document, in plain words, never as a CODEOWNERS file. Its own entry in the tree.');
    await callout(p, '2', 252, 740, 'Says which rules count', 'Today\'s rules decide this change, including the Policy Office\'s say over the rules themselves.');
  }
  await p.screenshot({ path: 'shots/mock-3-mixed-change.png' });

  await b.close();
})();
