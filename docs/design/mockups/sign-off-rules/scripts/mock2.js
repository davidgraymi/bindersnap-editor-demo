// Round two of the mocks: every decision from the conversation, injected into the real app.
// Throwaway: reuses mock.js's icons, CSS and helpers (my own local file).
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/mock.js', 'utf8');
eval(src.slice(0, src.indexOf('(async () => {')).replace("const { chromium } = require('@playwright/test');", '').replace(/^const /gm, 'var ').replace(/^async function /gm, 'var callout = async function '));
const { chromium } = require('@playwright/test');

I.chev = '<path d="m9 18 6-6-6-6"/>';
I.upload = '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>';
I.binder = '<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M15 2v20"/><path d="M15 7h5"/><path d="M15 12h5"/><path d="M15 17h5"/>';
I.preview = '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';
I.download = '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>';
I.approved = '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>';
I.addPerson = '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>';

const MORE_CSS = `
.mk-subhead{display:flex;align-items:center;gap:var(--brand-space-1-5);padding:var(--brand-space-2-5) var(--brand-space-3) var(--brand-space-1);font:500 var(--brand-text-ui-xs)/1.3 var(--brand-font-sans);color:var(--bs-text-muted);border-top:1px solid var(--bs-rule-warm)}
.mk-subhead:first-of-type{border-top:none}
.mk-subhead .mk-sp{flex:1}
.mk-rule + .mk-subhead{border-top:1px solid var(--bs-rule-warm)}
.mk-subhead + .mk-rule{border-top:none}
a.mk-rule{text-decoration:none;color:inherit}
a.mk-rule:hover{background:var(--bs-surface-2)}
.mk-rule--above .mk-rule-name{font-weight:400;color:var(--bs-text-secondary)}
.mk-from{display:inline-flex;align-items:center;gap:var(--brand-space-1);color:var(--bs-coral-text)!important;text-decoration:none}
.mk-rule-go{grid-row:1/3;grid-column:4;color:var(--bs-text-faint);display:inline-flex}
.mk-rule.mk-has-go{grid-template-columns:auto minmax(0,1fr) auto auto}
.mk-rule.mk-has-go .mk-rule-why{grid-column:2/4}
.mk-empty{margin:0;padding:var(--brand-space-1) var(--brand-space-3) var(--brand-space-2-5);font:400 var(--brand-text-ui-sm)/1.45 var(--brand-font-sans);color:var(--bs-text-muted)}
.mk-grouplink{color:inherit;text-decoration:underline;text-decoration-color:var(--bs-rule);text-underline-offset:3px}
.mk-grouplink:hover{text-decoration-color:currentColor}
.mk-hovercard{position:fixed;z-index:9998;width:240px;padding:var(--brand-space-3);border-radius:var(--brand-radius-lg);background:var(--bs-surface-1);border:1px solid var(--bs-rule);box-shadow:var(--bs-elevation-menu);display:grid;grid-template-columns:auto 1fr;gap:var(--brand-space-0-5) var(--brand-space-2-5);align-items:center;font-family:var(--brand-font-sans)}
.mk-hovercard .mk-face{width:var(--brand-space-10);height:var(--brand-space-10);font-size:var(--brand-text-ui-md);grid-row:1/3;margin:0}
.mk-hc-name{font:600 var(--brand-text-ui-md)/1.25 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-hc-login{font:400 var(--brand-text-ui-sm)/1.25 var(--brand-font-mono);color:var(--bs-text-muted)}
.mk-hc-role{grid-column:1/3;margin-top:var(--brand-space-2);padding-top:var(--brand-space-2);border-top:1px solid var(--bs-rule-warm);font-size:var(--brand-text-ui-xs);color:var(--bs-text-secondary)}
.mk-hc-role a{color:var(--bs-text-primary)}
.mk-face--ring{outline:2px solid var(--bs-coral-border);outline-offset:1px}
.mk-tr-link{color:var(--bs-coral-text);text-decoration:none;font:500 var(--brand-text-ui-xs)/1.4 var(--brand-font-sans);white-space:nowrap}
.mk-railrow{display:grid;grid-template-columns:96px 1fr;gap:var(--brand-space-2);padding:var(--brand-space-2) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);font:400 var(--brand-text-ui-sm)/1.4 var(--brand-font-sans);color:var(--bs-text-primary);align-items:center}
.mk-railrow:first-of-type{border-top:none}
.mk-railrow > span:first-child{color:var(--bs-text-muted);font-size:var(--brand-text-ui-xs)}
.mk-railrow .mk-who{display:inline-flex;gap:var(--brand-space-1-5);align-items:center}
.mk-draftchip{display:inline-flex;align-items:center;gap:var(--brand-space-1);padding:var(--brand-space-0-5) var(--brand-space-1-5);border-radius:var(--brand-radius-sm);background:var(--bs-status-info-bg);color:var(--bs-status-info-fg);font-size:var(--brand-text-ui-xs)}
.mk-railaction{display:grid;gap:var(--brand-space-2);padding:var(--brand-space-3)}
.mk-railaction p{margin:0;font:400 var(--brand-text-ui-xs)/1.45 var(--brand-font-sans);color:var(--bs-text-muted)}
.mk-railaction .bs-btn{width:100%;justify-content:center}
.mk-modal-note{display:flex;gap:var(--brand-space-2-5);align-items:flex-start;padding:var(--brand-space-3);border-radius:var(--brand-radius-lg);border:1px solid var(--bs-status-warn-border);background:var(--bs-status-warn-bg);color:var(--bs-text-primary);font:400 var(--brand-text-ui-sm)/1.5 var(--brand-font-sans);margin:var(--brand-space-3) 0}
.mk-modal-note svg{color:var(--bs-status-warn-fg);flex:none;margin-top:var(--brand-space-0-5)}
.mk-modal-p{margin:0 0 var(--brand-space-2);font:400 var(--brand-text-ui-sm)/1.5 var(--brand-font-sans);color:var(--bs-text-secondary)}
.mk-modal-check{display:flex;gap:var(--brand-space-2);align-items:center;padding:var(--brand-space-1) 0;font:400 var(--brand-text-ui-sm)/1.45 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-modal-check svg{color:var(--bs-status-ok-fg)}
.mk-modal-check .mk-sub{display:inline;margin:0 0 0 var(--brand-space-1)}
.mk-group-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:var(--brand-space-6);align-items:start}
.mk-group-col{display:grid;gap:var(--brand-space-4)}
.mk-member{display:grid;grid-template-columns:auto 1fr auto;gap:var(--brand-space-2-5);align-items:center;padding:var(--brand-space-2-5) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);font-family:var(--brand-font-sans)}
.mk-member:first-of-type{border-top:none}
.mk-member .mk-face{width:var(--brand-space-8);height:var(--brand-space-8);margin:0}
.mk-member-name{font:500 var(--brand-text-ui-md)/1.3 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-member-login{display:block;font:400 var(--brand-text-ui-xs)/1.3 var(--brand-font-mono);color:var(--bs-text-muted)}
.mk-member-act{color:var(--bs-text-muted);font-size:var(--brand-text-ui-xs)}
.mk-signs-row{display:grid;grid-template-columns:auto 1fr auto;gap:var(--brand-space-2-5);align-items:center;padding:var(--brand-space-2-5) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);text-decoration:none;color:inherit;font-family:var(--brand-font-sans)}
.mk-signs-row:first-of-type{border-top:none}
.mk-signs-row svg{color:var(--bs-text-muted)}
.mk-signs-where{font:500 var(--brand-text-ui-md)/1.3 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-signs-where .mk-sub{font-weight:400}
.mk-level{font:500 var(--brand-text-ui-xs)/1 var(--brand-font-sans);padding:var(--brand-space-1) var(--brand-space-2);border-radius:var(--brand-radius-sm);background:var(--bs-surface-2);color:var(--bs-text-secondary)}
.mk-cover-actions{display:flex;gap:var(--brand-space-2);flex-wrap:wrap}
.mk-iconbtn-new{outline:2px solid var(--bs-coral-border);outline-offset:2px;border-radius:var(--brand-radius-sm)}
`;
const EXTRA = `
.mk-rules-head{display:flex;align-items:center;gap:var(--brand-space-2);padding:var(--brand-space-3);font:600 var(--brand-text-ui-md)/1.35 var(--brand-font-sans);color:var(--bs-text-primary);border-bottom:1px solid var(--bs-rule-warm)}
.mk-rules-head svg{color:var(--bs-status-info-fg)}
.mk-rules-head .mk-sp{flex:1}
.mk-rules-head .mk-small{font-weight:400;font-size:var(--brand-text-ui-xs);color:var(--bs-text-muted)}
.mk-why{display:block;margin-top:var(--brand-space-0-5);font:400 var(--brand-text-ui-xs)/1.4 var(--brand-font-sans);color:var(--bs-text-muted)}
.mk-rules-foot{margin:0;padding:var(--brand-space-2-5) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);background:var(--bs-surface-2);font:400 var(--brand-text-ui-xs)/1.5 var(--brand-font-sans);color:var(--bs-text-secondary)}
.mk-rules-foot strong{color:var(--bs-text-primary)}
.mk-rc-cta{display:flex;justify-content:space-between;align-items:center;gap:var(--brand-space-3);padding:var(--brand-space-2-5) var(--brand-space-3);border-top:1px solid var(--bs-rule-warm);font:400 var(--brand-text-ui-sm)/1.45 var(--brand-font-sans);color:var(--bs-text-secondary)}
.mk-rc-cta strong{color:var(--bs-text-primary)}
.mk-rc-cta a{color:var(--bs-coral-text);text-decoration:none;font-weight:500;white-space:nowrap}
.mk-does-icon{color:var(--bs-status-warn-fg)}
.mk-count{font:500 var(--brand-text-ui-sm)/1 var(--brand-font-mono);color:var(--bs-text-secondary);white-space:nowrap}
`;
const EDITOR_WIDE = `
/* The folder on the desk: the list takes the room, the rules sit at the desk's right edge. */
/* The file panel floats over the desk's left edge (about 260px open), so the folder starts past it. */
.mk-folder-sheet{width:auto;max-width:none;margin:var(--brand-space-6) var(--brand-space-6) var(--brand-space-6) calc(260px + var(--brand-space-6));grid-template-columns:minmax(0,1fr) 300px;gap:var(--brand-space-6)}
`;
const ALL_CSS = CSS + MORE_CSS + EXTRA + EDITOR_WIDE;

// People, by login: initials, tone, full name.
const P = {
  alice: ['AN', 1, 'Alice Nguyen'], priya: ['PR', 2, 'Priya Raman'], grace: ['GI', 3, 'Grace Ibori'],
  ines: ['IM', 1, 'Ines Moreau'], dan: ['DW', 4, 'Dan Whitfield'], hugo: ['HL', 3, 'Hugo Lindqvist'], bob: ['BO', 2, 'Bob Okafor'],
};
const who = (...logins) => `<span class="mk-faces">${logins.map((l) => `<span class="mk-face mk-face--${P[l][1]}" data-login="${l}" title="${P[l][2]} · @${l}">${P[l][0]}</span>`).join('')}</span>`;
const G = (name, slug) => `<a class="mk-grouplink" href="/riverside-health/-/groups/${slug}">${name}</a>`;

/** "Set here" can be edited (in the editor, into the draft); "From above" links to where each rule lives. */
function signsPanel({ here = [], above = [], hereEmpty = '', editable = false, draftTag = false, lead, foot }) {
  const hereRows = here.map((r) => `
    <div class="mk-rule ${r.cls || ''}">
      <span class="mk-rule-icon">${svg(r.icon || 'people')}</span>
      <span class="mk-rule-name">${r.name}</span>${r.who || ''}
      <span class="mk-rule-why">${r.why}</span>
    </div>`).join('');
  // Not one big link: the group name inside is a link of its own, and links do not nest.
  const aboveRows = above.map((r) => `
    <div class="mk-rule mk-rule--above">
      <span class="mk-rule-icon">${svg(r.icon || 'people')}</span>
      <span class="mk-rule-name">${r.name}</span>${r.who || '<span></span>'}
      <a class="mk-rule-why mk-from" href="#">${r.why} ${svg('chev', 'xs')}</a>
    </div>`).join('');
  return `
  <section class="bs-panel" aria-label="Who signs off here">
    <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">Who signs off here</h2>
      ${draftTag ? '<span class="bs-panel-bar-spacer"></span><span class="mk-tag mk-tag--draft">' + svg('draft', 'xs') + 'Changed in your draft</span>' : ''}</div>
    ${lead ? `<p class="mk-lead">${lead}</p>` : ''}
    <div class="mk-subhead">Set here</div>
    ${hereRows || `<p class="mk-empty">${hereEmpty}</p>`}
    ${editable ? `<div class="mk-addrow">${svg('add')}Add a group or a person</div>` : ''}
    ${above.length ? `<div class="mk-subhead">From above<span class="mk-sp"></span><span>${editable ? 'Read only here' : ''}</span></div>${aboveRows}` : ''}
    ${foot ? `<div class="bs-panel-foot mk-foot">${foot}</div>` : ''}
  </section>`;
}

const IC_HERE = { name: G('Infection Control', 'infection-control'), who: who('grace', 'ines'), why: 'Set on this folder' };
const PO_BINDER = { name: G('Policy Office', 'policy-office'), who: who('alice', 'priya'), why: 'The whole binder · Governance' };
const APPROVALS_BINDER = { name: '2 approvals', icon: 'rules', why: "From the binder's approvers · Governance" };

async function hovercard(p, login, x, y, role) {
  await p.evaluate(({ login, x, y, role, person }) => {
    const face = document.querySelector(`.mk-face[data-login="${login}"]`);
    if (face) face.classList.add('mk-face--ring');
    const d = document.createElement('div');
    d.className = 'mk-hovercard'; d.style.left = x + 'px'; d.style.top = y + 'px';
    d.innerHTML = `<span class="mk-face mk-face--${person[1]}">${person[0]}</span><span class="mk-hc-name">${person[2]}</span><span class="mk-hc-login">@${login}</span><span class="mk-hc-role">${role}</span>`;
    document.body.appendChild(d);
  }, { login, x, y, role, person: P[login] });
}

const ORG = 'http://localhost:21390/riverside-health';
const GOV = ORG + '/governance';
const DRAFT = '?edit=write&draft=draft%2Falice%2F20261109210257550';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: __dirname + '/state.json' });
  const p = await ctx.newPage();
  const notes = process.env.NOTES !== '0';
  const inject = (fn, arg) => p.evaluate(fn, arg);
  const style = () => p.addStyleTag({ content: ALL_CSS });

  // The binder page's own list, cut down to Clinical Standards: the folder page lists the way the binder does.
  await p.goto(GOV); await p.waitForTimeout(3500);
  const csRow = p.locator('.binder-tree-row--folder', { hasText: 'Clinical Standards' });
  if ((await p.locator('.binder-tree-row', { hasText: 'Sepsis Pathway' }).count()) === 0) { await csRow.locator('button').first().click(); await p.waitForTimeout(800); }
  const folderList = await p.evaluate(() => {
    const count = [...document.querySelectorAll('.binder-count')].find((x) => /documents in/.test(x.textContent));
    const panel = count.closest('.bs-panel').cloneNode(true);
    panel.querySelector('.binder-count').textContent = '2 documents';
    const input = panel.querySelector('input'); if (input) input.setAttribute('placeholder', 'Filter this folder…');
    panel.querySelectorAll('.binder-tree-row').forEach((r) => {
      const t = r.textContent;
      if (r.classList.contains('binder-tree-row--folder') || /Governance Charter/.test(t)) (r.closest('li') || r).remove();
      else r.style.paddingLeft = '0px';
    });
    // Rows nested under the folder sit in their own list; lift the indent off every level.
    panel.querySelectorAll('ul, ol').forEach((l) => { l.style.paddingLeft = '0'; l.style.marginLeft = '0'; });
    panel.querySelectorAll('[style*="padding-left"]').forEach((e) => (e.style.paddingLeft = '0px'));
    return panel.outerHTML;
  });

  // ── 1. Folder page, binder view ─────────────────────────────────────────
  await p.goto(GOV + '/-/blob/main/clinical-standards/hand-hygiene'); await p.waitForTimeout(3500);
  await style();
  await inject(({ docsTable, signs, waiting, folderSvg }) => {
    history.replaceState(null, '', location.pathname.replace('/-/blob/main/clinical-standards/hand-hygiene', '/-/tree/main/clinical-standards'));
    document.querySelectorAll('.app-explorer-item--active').forEach((e) => { e.classList.remove('app-explorer-item--active'); e.removeAttribute('aria-current'); });
    document.querySelectorAll('.app-explorer-item').forEach((e) => (e.style.background = 'transparent'));
    const f = document.querySelector('.app-explorer-folder[aria-expanded="true"]');
    if (f) { f.style.background = 'var(--bs-surface-2)'; f.style.fontWeight = '600'; }
    document.querySelector('.page-path-list').innerHTML = '<li class="page-path-step"><a class="page-path-link" href="#">Governance</a></li><li class="page-path-step"><span class="page-path-sep">/</span><span class="page-path-text page-path-text--current">Clinical Standards</span></li>';
    document.querySelector('.binder-pane').innerHTML = `
      <header class="bs-pagehead">
        <div class="bs-pagehead-body">
          <div class="mk-titlerow">${folderSvg}<h1 class="bs-title">Clinical Standards</h1></div>
          <p class="mk-meta">A folder in Governance · 2 documents · last published Nov 9, 2026</p>
        </div>
        <div class="bs-pagehead-actions"><button class="bs-btn bs-btn-primary" type="button">Edit</button></div>
      </header>
      <div class="doc-workspace">
        <div class="doc-workspace-main">${docsTable}</div>
        <aside class="doc-rail" aria-label="Folder summary">${signs}${waiting}</aside>
      </div>`;
  }, {
    docsTable: folderList, waiting: waitingPanel, folderSvg: svg('folder', 'lg'),
    signs: signsPanel({
      lead: 'Publishing anything in this folder needs one approval from each of these.',
      here: [IC_HERE], above: [PO_BINDER, APPROVALS_BINDER],
      foot: '<span class="mk-footnote">To change who signs off here, press Edit. It goes into a draft, and the Policy Office approves it.</span>',
    }),
  });
  await hovercard(p, 'grace', 1130, 410, `${'Infection Control'} · signs off on this folder`);
  if (notes) {
    await callout(p, '1', 1080, 110, 'One button: Edit', 'Rename, move, add, upload and the sign-off rules are all in the editor now.');
    await callout(p, '2', 420, 560, 'Set here, and from above', 'Only Infection Control lives on this folder. The binder\'s rules are listed, read-only, and each opens where it is set.');
    await callout(p, '3', 720, 560, 'A face says who it is', 'Hover, focus or tap. Name, username, and why they are on this screen. Group names link to the group.');
  }
  await p.screenshot({ path: __dirname + '/shots/v2-1-folder-binder.png' });

  // ── 2. Document page ────────────────────────────────────────────────────
  await p.goto(GOV + '/-/blob/main/clinical-standards/hand-hygiene'); await p.waitForTimeout(3500);
  await style();
  await inject(({ signs }) => {
    const acts = document.querySelector('.bs-pagehead-actions');
    acts.innerHTML = '<button class="bs-btn bs-btn-primary" type="button">Edit</button>';
    const rail = document.querySelector('.doc-rail');
    rail.insertAdjacentHTML('afterbegin', signs);
  }, {
    signs: signsPanel({
      lead: 'Publishing a new version needs one approval from each of these.',
      here: [], hereEmpty: 'Nothing is set on this document alone.',
      above: [{ name: G('Infection Control', 'infection-control'), who: who('grace', 'ines'), why: 'From the folder · Clinical Standards' }, PO_BINDER, APPROVALS_BINDER],
    }),
  });
  if (notes) {
    await callout(p, '1', 880, 110, 'Edit replaces Rename or move and Upload new version', 'Both are in the editor. A Word file opens there read only, with Upload new version on it.');
    await callout(p, '2', 820, 470, 'Everything here comes from above', 'So the panel says so, and each row opens the folder or binder where the rule is set.');
  }
  await p.screenshot({ path: __dirname + '/shots/v2-2-document.png' });

  // ── 3. Binder page: the top folder ──────────────────────────────────────
  await p.goto(GOV); await p.waitForTimeout(3500);
  await style();
  await inject(({ signs }) => {
    const acts = document.querySelector('.bs-pagehead-actions');
    acts.innerHTML = '<button class="bs-btn bs-btn-primary" type="button">Edit</button>';
    // Lay the binder's contents beside a rail, as the folder page does.
    const head = document.querySelector('.bs-pagehead');
    const after = [...head.parentElement.children].slice([...head.parentElement.children].indexOf(head) + 1);
    const ws = document.createElement('div'); ws.className = 'doc-workspace';
    const main = document.createElement('div'); main.className = 'doc-workspace-main'; main.style.display = 'grid'; main.style.gap = 'var(--brand-space-3)';
    after.forEach((n) => main.appendChild(n));
    ws.appendChild(main);
    ws.insertAdjacentHTML('beforeend', `<aside class="doc-rail" aria-label="Binder summary">${signs}</aside>`);
    head.parentElement.appendChild(ws);
  }, {
    signs: signsPanel({
      lead: 'Everything in this binder needs these, whatever folder it is in.',
      here: [
        { name: G('Policy Office', 'policy-office'), who: who('alice', 'priya'), why: 'Everything in Governance' },
        { name: '2 approvals', icon: 'rules', why: "From the binder's approvers, counted together" },
        { name: G('Policy Office', 'policy-office'), icon: 'rules', who: who('alice', 'priya'), why: 'Any change to who signs off' },
      ],
      foot: '<span class="mk-footnote">Clinical Standards, Contracts and one document add rules of their own. Open them to see.</span>',
    }),
  });
  if (notes) {
    await callout(p, '1', 760, 580, 'The binder is the top folder', 'Same page, same panel. The binder\'s own rules are "set here" on this page and "from above" everywhere else.');
  }
  await p.screenshot({ path: __dirname + '/shots/v2-3-binder.png' });

  // ── 4. Folder on the editor's desk ──────────────────────────────────────
  await p.goto(GOV + '/-/blob/main/governance-charter' + DRAFT); await p.waitForTimeout(6000);
  const fl = p.locator('.app-explorer-folder[data-folder="clinical-standards"]');
  for (let i = 0; i < 3 && (await fl.getAttribute('aria-expanded')) !== 'true'; i++) { await fl.click(); await p.waitForTimeout(700); }
  await p.mouse.move(1300, 850);
  await style();
  await inject(({ docsTable, signs, folderSvg, uploadSvg }) => {
    history.replaceState(null, '', location.pathname.replace('/-/blob/main/governance-charter', '/-/tree/main/clinical-standards') + location.search);
    document.querySelectorAll('.app-explorer-item--active').forEach((e) => e.classList.remove('app-explorer-item--active'));
    document.querySelectorAll('.app-explorer-item').forEach((e) => (e.style.background = 'transparent'));
    const f = document.querySelector('.app-explorer-folder[data-folder="clinical-standards"]');
    f.style.background = 'var(--bs-surface-2)'; f.style.fontWeight = '600';
    const t = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Governance Charter' && e.closest('header, .doc-editor-page') && !e.closest('.app-explorer-item'));
    if (t) t.textContent = 'Clinical Standards';
    // The file panel's head gains Upload, beside New document and New folder.
    const newFolderBtn = [...document.querySelectorAll('button[aria-label], button[title]')].find((x) => /new folder/i.test(x.getAttribute('aria-label') || x.title || ''));
    if (newFolderBtn) {
      const up = newFolderBtn.cloneNode(false);
      up.innerHTML = uploadSvg; up.setAttribute('aria-label', 'Upload files'); up.title = 'Upload files';
      up.classList.add('mk-iconbtn-new');
      newFolderBtn.after(up);
    }
    const body = document.querySelector('.bs-doc-body');
    [...(body ? body.parentElement.children : [])].forEach((c) => { if (c !== body) c.classList.add('mk-ribbon-locked'); });
    document.querySelectorAll('[role="tablist"], [role="toolbar"]').forEach((x) => { if (!x.closest('.app-explorer, aside')) x.classList.add('mk-ribbon-locked'); });
    // The folder is not a sheet of Letter: let it use the whole desk, out to its right edge.
    for (let e = document.querySelector('.bs-doc-sheetwrap'); e && !e.classList.contains('doc-editor-main'); e = e.parentElement) {
      e.style.width = '100%'; e.style.maxWidth = 'none';
    }
    document.querySelector('.bs-doc-sheetwrap').innerHTML = `
      <div class="mk-folder-sheet">
        <div class="mk-sheet-head">
          <div><div class="mk-titlerow">${folderSvg}<h1>Clinical Standards</h1></div>
            <p class="mk-meta">Folder · 2 documents</p></div>
          <span style="display:flex;gap:var(--brand-space-2)">
            <button class="bs-btn bs-btn-secondary bs-btn--sm" type="button">Upload files here</button>
            <button class="bs-btn bs-btn-primary bs-btn--sm" type="button">New document here</button>
          </span>
        </div>
        <div>${docsTable}</div>
        <div>${signs}</div>
      </div>`;
    document.querySelectorAll('*').forEach((x) => { if (x.children.length === 0 && /^Page 1 of 1$/.test(x.textContent.trim())) x.textContent = 'Folder'; });
    const w = [...document.querySelectorAll('*')].filter((x) => /^\d+\s*words$/.test(x.textContent.trim())).pop(); if (w) w.textContent = '';
  }, {
    docsTable: folderList, folderSvg: svg('folder', 'lg'), uploadSvg: svg('upload'),
    signs: signsPanel({
      editable: true,
      lead: 'Publishing anything in this folder will need one approval from each of these.',
      here: [IC_HERE, { name: G('Quality Committee', 'quality-committee'), who: who('priya', 'dan', 'hugo'), why: 'Set on this folder' }],
      above: [PO_BINDER, APPROVALS_BINDER],
    }),
  });
  if (notes) {
    await callout(p, '1', 560, 500, 'Edit what lives here', 'Set here is edited in place, like a rename. From above is read-only: its link moves the desk to the binder, where that rule is set.');
    await callout(p, '2', 40, 590, 'Upload, in the file panel', 'A new button beside New document and New folder, and "Upload files here" on a folder. Dragging still works.');
  }
  await p.screenshot({ path: __dirname + '/shots/v2-4-folder-editor.png' });

  // ── 5. A Word file on the desk: Upload new version lives here now ───────
  await p.goto(GOV + '/-/blob/main/contracts/master-services-agreement' + DRAFT); await p.waitForTimeout(7000);
  await style();
  await inject(({ upload, signs }) => {
    const acts = document.querySelector('.doc-editor-cover-actions');
    if (acts) {
      const dl = [...acts.querySelectorAll('button')].find((x) => /Download/.test(x.textContent));
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'bs-btn bs-btn-secondary bs-btn--sm'; up.innerHTML = upload + 'Upload new version';
      acts.insertBefore(up, dl);
    }
  }, { upload: svg('upload') });
  if (notes) {
    const box = await p.locator('.doc-editor-cover-note').boundingBox().catch(() => null);
    await callout(p, '1', 1150, 260, 'Upload new version moves here', 'With Edit in Bindersnap and Download. The page header had it; now every file is edited from one place.');
  }
  await p.screenshot({ path: __dirname + '/shots/v2-5-word-in-editor.png' });

  // ── 6. Change overview, without the two summaries ───────────────────────
  await ctx.close();
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 2, storageState: __dirname + '/state.json' });
  const q = await ctx2.newPage();
  await q.goto(ORG + '/clinical/-/changes/7'); await q.waitForTimeout(5000);
  await q.addStyleTag({ content: ALL_CSS });
  await q.evaluate(({ s, f }) => {
    history.replaceState(null, '', '/riverside-health/governance/-/changes/9');
    const swap = (from, to) => document.querySelectorAll('*').forEach((x) => { if (x.children.length === 0 && x.textContent.trim() === from) x.textContent = to; });
    swap('Clinical', 'Governance'); swap('Change 7', 'Change 9');
    document.querySelector('.bs-title').textContent = 'Bare below the elbows for pharmacy, and the Quality Committee signs off clinical standards';
    // The byline keeps the one fact; the draft and the date move to the rail.
    const body = document.querySelector('.bs-pagehead-body');
    const by = [...body.querySelectorAll('p, div')].find((x) => /wants to publish/.test(x.textContent));
    if (by) by.innerHTML = '<strong>Alice Nguyen</strong> wants to publish 1 document <strong>and change who signs off</strong>.';
    const sum = [...body.querySelectorAll('p')].find((x) => /Monthly audits/.test(x.textContent));
    if (sum) sum.textContent = 'Pharmacy staff now give direct care on the wards, so the dress rule names them. And the Quality Committee should see every clinical standard before it is published.';
    document.querySelectorAll('.doc-tab-count').forEach((c) => (c.textContent = '2'));

    const main = document.querySelector('.change-main');
    main.querySelector('.change-behind')?.remove();
    main.querySelector('.change-does')?.remove();

    const rules = main.querySelector('.rev-rules');
    rules.className = 'bs-panel';
    rules.innerHTML = `
      <div class="mk-rules-head">${s.waiting}Needs sign-off under 4 rules · none met yet<span class="mk-sp"></span><button class="bs-linkbtn" type="button">Compact</button></div>
      <table class="rev-rules-table">
        <thead><tr><th scope="col">Rule</th><th scope="col">Who can approve</th><th scope="col">Approvals</th><th scope="col">Approved by</th></tr></thead>
        <tbody>
          <tr><th scope="row"><span class="rev-rules-name">Who signs off</span><span class="rev-rules-owners">${f.PO_LINK}</span><span class="mk-why">This change edits a sign-off rule · <a class="mk-tr-link" href="#">See the rule change →</a></span></th>
            <td>${f.PO}</td><td class="rev-rules-count">0 of 1</td><td></td></tr>
          <tr><th scope="row"><span class="rev-rules-name">Clinical Standards</span><span class="rev-rules-owners">${f.IC_LINK}</span><span class="mk-why">Hand Hygiene is in this folder</span></th>
            <td>${f.IC}</td><td class="rev-rules-count">0 of 1</td><td></td></tr>
          <tr><th scope="row"><span class="rev-rules-name">The whole binder</span><span class="rev-rules-owners">${f.PO_LINK}</span><span class="mk-why">Applies to everything in Governance</span></th>
            <td>${f.PO}</td><td class="rev-rules-count">0 of 1</td><td></td></tr>
          <tr><th scope="row"><span class="rev-rules-name">Binder approvers</span><span class="rev-rules-owners">Any approver</span><span class="mk-why">Governance needs 2 approvals</span></th>
            <td>${f.ALL}</td><td class="rev-rules-count">0 of 2</td><td></td></tr>
        </tbody>
      </table>
      <p class="mk-rules-foot"><strong>One approval from Alice or Priya meets both Policy Office rules.</strong> The Quality Committee is not asked: its rule starts with the next change after this one is published.</p>`;

    const ps = [...main.querySelectorAll('.rev-timeline p')];
    const p1 = ps.find((x) => /Fourteen days/.test(x.textContent));
    if (p1) p1.textContent = 'Does adding the Quality Committee mean a typo fix in the sepsis pathway waits for their monthly meeting? I would rather that than nobody clinical outside Infection Control seeing these.';
    const p2 = ps.find((x) => /Agency contracts/.test(x.textContent));
    if (p2) p2.textContent = 'Priya says they can turn a standard round between meetings. If that does not hold by spring, we take them off again — in a change like this one.';

    // Rail: who was asked, then the facts about the change, then what happens next.
    const rail = document.querySelector('.bs-rail');
    swap('0 of 1 approvals', '0 of 2 approvals');
    const rev = rail.querySelector('.rev-reviewers');
    const first = rev.firstElementChild; const second = first.cloneNode(true); rev.insertBefore(second, first.nextSibling);
    const rename = (el, name, role) => el.querySelectorAll('*').forEach((x) => {
      if (x.children.length === 0 && x.textContent.trim() === 'Bob Okafor') x.textContent = name;
      if (x.children.length === 0 && x.textContent.trim() === 'Approver') x.textContent = role;
    });
    rename(first, 'Priya Raman', 'Approver · Policy Office');
    rename(second, 'Grace Ibori', 'Approver · Infection Control');
    rail.querySelector('.bs-note')?.remove();
    rail.querySelectorAll('button').forEach((x) => { if (/Close without publishing/.test(x.textContent)) x.remove(); });
    rail.insertAdjacentHTML('beforeend', `
      <section class="bs-panel">
        <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">About this change</h2></div>
        <div class="mk-railrow"><span>From</span><span><span class="mk-draftchip">${s.draft}Tighten hand hygiene</span></span></div>
        <div class="mk-railrow"><span>Opened</span><span>Nov 9, 2026 by Alice Nguyen</span></div>
        <div class="mk-railrow"><span>Assignee</span><span class="mk-who">${f.PRIYA}Priya Raman</span></div>
      </section>
      <section class="bs-panel">
        <div class="mk-railaction">
          <button class="bs-btn bs-btn-primary" type="button" disabled>Publish</button>
          <p>Publishing opens once every rule above is met. Waiting on Priya Raman and Grace Ibori.</p>
          <button class="bs-btn bs-btn--sm bs-btn--quiet" type="button">Close without publishing</button>
        </div>
      </section>`);
  }, {
    s: { waiting: svg('waiting'), draft: svg('draft', 'xs') },
    f: {
      PO: who('alice', 'priya'), IC: who('grace', 'ines'), ALL: who('alice', 'priya', 'grace', 'ines'), PRIYA: who('priya'),
      PO_LINK: G('Policy Office', 'policy-office'), IC_LINK: G('Infection Control', 'infection-control'),
    },
  });
  await q.waitForTimeout(300);
  if (notes) {
    await callout(q, '1', 1100, 1020, 'Two summaries gone', '"What this change does" and the rule block were the Changes tab twice. The table\'s first row says the change edits a rule, and links to it.');
    await callout(q, '2', 1100, 1200, 'The rail holds the facts', 'Where it came from, who has it, and the Publish button with what it waits on.');
  }
  await q.screenshot({ path: __dirname + '/shots/v2-6-overview.png' });

  // ── 7. Approving it: the rule change is said at the moment it matters ───
  await q.setViewportSize({ width: 1440, height: 900 });
  await q.evaluate(({ s }) => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="upload-modal-backdrop">
        <div class="upload-modal create-document-modal" role="dialog" aria-modal="true" aria-labelledby="mk-approve">
          <h2 id="mk-approve">Approve change 9</h2>
          <p class="mk-modal-p">You are approving it for the Policy Office.</p>
          <div class="mk-modal-note">${s.rules}<span><strong>This also changes who signs off.</strong> Once it is published, everything in Clinical Standards needs the Quality Committee as well. <a class="mk-tr-link" href="#">See the rule change →</a></span></div>
          <p class="mk-modal-p">Your approval counts toward:</p>
          <div class="mk-modal-check">${s.ok}Who signs off<span class="mk-sub">Policy Office</span></div>
          <div class="mk-modal-check">${s.ok}The whole binder<span class="mk-sub">Policy Office</span></div>
          <div class="mk-modal-check">${s.ok}Binder approvers<span class="mk-sub">1 of 2</span></div>
          <label class="create-document-field" style="margin-top:var(--brand-space-3)"><span class="bs-field-label">A note for the record (optional)</span><textarea class="bs-input" rows="2"></textarea></label>
          <div class="upload-modal-actions">
            <button type="button" class="bs-btn bs-btn-primary">Approve</button>
            <button type="button" class="bs-btn bs-btn-secondary">Cancel</button>
          </div>
        </div>
      </div>`);
  }, { s: { rules: svg('rules', 'md'), ok: svg('approved') } });
  await q.waitForTimeout(300);
  await q.screenshot({ path: __dirname + '/shots/v2-7-approve.png' });

  // ── 8. A group's own page ───────────────────────────────────────────────
  await q.setViewportSize({ width: 1440, height: 900 });
  await q.goto(ORG + '/-/people'); await q.waitForTimeout(4000);
  if (!/people/.test(q.url())) await q.goto(ORG); await q.waitForTimeout(1500);
  await q.addStyleTag({ content: ALL_CSS });
  await q.evaluate(({ s, f }) => {
    history.replaceState(null, '', '/riverside-health/-/groups/infection-control');
    const main = document.querySelector('.app-main-area') || document.querySelector('main');
    const host = main.querySelector('section') || main;
    host.innerHTML = `
      <div style="max-width:1120px;padding:var(--brand-space-6) var(--brand-space-12)">
      <nav class="page-path"><ol class="page-path-list"><li class="page-path-step"><a class="page-path-link" href="#">People</a></li><li class="page-path-step"><span class="page-path-sep">/</span><a class="page-path-link" href="#">Groups</a></li><li class="page-path-step"><span class="page-path-sep">/</span><span class="page-path-text page-path-text--current">Infection Control</span></li></ol></nav>
      <header class="bs-pagehead" style="margin-top:var(--brand-space-4)">
        <div class="bs-pagehead-body">
          <div class="mk-titlerow">${s.people}<h1 class="bs-title">Infection Control</h1></div>
          <p class="mk-meta">Writes and signs off on the clinical standards. · 2 people · a group in Riverside Health</p>
        </div>
        <div class="bs-pagehead-actions"><button class="bs-btn bs-btn-secondary" type="button">Rename</button><button class="bs-btn bs-btn-primary" type="button">${s.addPerson}Add a person</button></div>
      </header>
      <div class="mk-group-grid">
        <div class="mk-group-col">
          <section class="bs-panel">
            <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">Where it signs off</h2><span class="bs-section-count">1</span></div>
            <p class="mk-lead">Nothing here is published without an approval from somebody in this group.</p>
            <a class="mk-signs-row" href="#">${s.folder}<span class="mk-signs-where">Governance · Clinical Standards<span class="mk-sub">Folder · 2 documents · Hand Hygiene, Sepsis Pathway</span></span>${s.chev}</a>
          </section>
          <section class="bs-panel">
            <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">Binders it can use</h2><span class="bs-section-count">1</span></div>
            <a class="mk-signs-row" href="#">${s.binder}<span class="mk-signs-where">Governance<span class="mk-sub">Can edit documents · approver</span></span><span class="mk-level">Editor</span></a>
          </section>
        </div>
        <section class="bs-panel">
          <div class="bs-panel-bar"><h2 class="bs-panel-bar-title">People</h2><span class="bs-section-count">2</span></div>
          <div class="mk-member">${f.grace}<span><span class="mk-member-name">Grace Ibori</span><span class="mk-member-login">@grace</span></span><span class="mk-member-act">Remove</span></div>
          <div class="mk-member">${f.ines}<span><span class="mk-member-name">Ines Moreau</span><span class="mk-member-login">@ines</span></span><span class="mk-member-act">Remove</span></div>
          <div class="bs-panel-foot"><span class="mk-footnote">Editors cost a seat: $39 a month each. Only an owner of Riverside Health changes who is in a group.</span></div>
        </section>
      </div></div>`;
  }, {
    s: { people: svg('people', 'lg'), folder: svg('folder', 'md'), binder: svg('binder', 'md'), chev: svg('chev'), addPerson: svg('addPerson') },
    f: { grace: `<span class="mk-face mk-face--3">GI</span>`, ines: `<span class="mk-face mk-face--1">IM</span>` },
  });
  if (notes) {
    await callout(q, '1', 300, 560, 'What the group has to approve', 'Every rule in every binder that names it. Today that takes opening each binder\'s settings.');
    await callout(q, '2', 1080, 520, 'Owners edit, everyone reads', 'Every group name in the app links here.');
  }
  await q.screenshot({ path: __dirname + '/shots/v2-8-group.png' });

  await b.close();
})();
