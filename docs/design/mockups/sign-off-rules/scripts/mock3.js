// Round three: the editor gets a right-hand panel for "Who signs off here", the
// way the binder, folder and document pages have their right-hand rail.
// Throwaway: reuses mock2.js's helpers (my own local file).
var src2 = require('fs').readFileSync(__dirname + '/mock2.js', 'utf8');
eval(src2.slice(0, src2.lastIndexOf('\n(async () => {')).replace(/^const /gm, 'var ').replace(/^async function /gm, 'var hovercard = async function '));

const RIGHT_CSS = `
/* The right-hand panel: the file panel's float, mirrored. */
.mk-rightfloat{position:absolute;top:var(--brand-space-3);right:var(--brand-space-3);bottom:var(--brand-space-3);width:300px;z-index:5;display:flex}
.mk-rightfloat > aside{flex:1;display:flex;flex-direction:column;overflow:auto;background:var(--bs-surface-1);border:1px solid var(--bs-rule);border-radius:var(--brand-radius-xl);box-shadow:var(--bs-elevation-card)}
.mk-rightfloat .bs-panel{border:none;border-radius:0;box-shadow:none;background:transparent}
.mk-righthead{display:flex;align-items:center;gap:var(--brand-space-2);padding:var(--brand-space-3) var(--brand-space-3) var(--brand-space-2-5);border-bottom:1px solid var(--bs-rule-warm);font:600 var(--brand-text-ui-md)/1.3 var(--brand-font-sans);color:var(--bs-text-primary)}
.mk-righthead .mk-sp{flex:1}
.mk-righthead .mk-shut{display:inline-flex;color:var(--bs-text-muted)}
.mk-rightfloat .bs-panel-bar{display:none}
.mk-where{padding:var(--brand-space-2-5) var(--brand-space-3) 0;font:400 var(--brand-text-ui-xs)/1.4 var(--brand-font-sans);color:var(--bs-text-muted)}
.mk-where strong{color:var(--bs-text-primary);font-weight:500}
/* The folder on the desk: one column between the two panels. */
.mk-folder-desk{margin:var(--brand-space-6) calc(300px + var(--brand-space-6)) var(--brand-space-6) calc(260px + var(--brand-space-6));display:grid;gap:var(--brand-space-4)}
.mk-folder-desk .bs-panel{background:var(--bs-surface-1)}
.mk-folder-desk > .bs-panel{width:100% !important;max-width:none !important;justify-self:stretch !important;box-sizing:border-box}
.mk-folder-desk{grid-template-columns:minmax(0,1fr) !important}
`;

const SHUT = '<path d="M15 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m8 9 3 3-3 3"/>';

async function rightPanel(p, { where, signs }) {
  await p.evaluate(({ where, signs, shut }) => {
    const body = document.querySelector('.bs-doc-body');
    body.style.position = 'relative';
    body.insertAdjacentHTML('beforeend', `
      <div class="mk-rightfloat"><aside aria-label="Who signs off here">
        <div class="mk-righthead">Who signs off here<span class="mk-sp"></span>
          <span class="mk-shut" title="Hide this panel" aria-label="Hide this panel"><svg xmlns="http://www.w3.org/2000/svg" width="var(--brand-icon-md)" height="var(--brand-icon-md)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--brand-icon-stroke)" stroke-linecap="round" stroke-linejoin="round">${shut}</svg></span></div>
        <p class="mk-where">${where}</p>
        ${signs}
      </aside></div>`);
  }, { where, signs, shut: SHUT });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: __dirname + '/state.json' });
  const p = await ctx.newPage();
  const notes = process.env.NOTES !== '0';
  const style = () => p.addStyleTag({ content: ALL_CSS + RIGHT_CSS });

  // The folder list, as the binder page draws it, cut to Clinical Standards (as in mock2).
  await p.goto(GOV); await p.waitForTimeout(3500);
  const csRow = p.locator('.binder-tree-row--folder', { hasText: 'Clinical Standards' });
  if ((await p.locator('.binder-tree-row', { hasText: 'Sepsis Pathway' }).count()) === 0) { await csRow.locator('button').first().click(); await p.waitForTimeout(800); }
  const folderList = await p.evaluate(() => {
    const count = [...document.querySelectorAll('.binder-count')].find((x) => /documents in/.test(x.textContent));
    const panel = count.closest('.bs-panel').cloneNode(true);
    panel.querySelector('.binder-count').textContent = '2 documents';
    const input = panel.querySelector('input'); if (input) input.setAttribute('placeholder', 'Filter this folder…');
    panel.querySelectorAll('.binder-tree-row').forEach((r) => {
      if (r.classList.contains('binder-tree-row--folder') || /Governance Charter/.test(r.textContent)) (r.closest('li') || r).remove();
    });
    panel.querySelectorAll('ul, ol').forEach((l) => { l.style.paddingLeft = '0'; l.style.marginLeft = '0'; });
    panel.querySelectorAll('[style*="padding-left"]').forEach((e) => (e.style.paddingLeft = '0px'));
    return panel.outerHTML;
  });

  // ── A. A folder in the editor ───────────────────────────────────────────
  await p.goto(GOV + '/-/blob/main/governance-charter' + DRAFT); await p.waitForTimeout(6000);
  const fl = p.locator('.app-explorer-folder[data-folder="clinical-standards"]');
  for (let i = 0; i < 3 && (await fl.getAttribute('aria-expanded')) !== 'true'; i++) { await fl.click(); await p.waitForTimeout(700); }
  await p.mouse.move(1300, 850);
  await style();
  await p.evaluate(({ list, folderSvg, uploadSvg }) => {
    history.replaceState(null, '', location.pathname.replace('/-/blob/main/governance-charter', '/-/tree/main/clinical-standards') + location.search);
    document.querySelectorAll('.app-explorer-item--active').forEach((e) => e.classList.remove('app-explorer-item--active'));
    document.querySelectorAll('.app-explorer-item').forEach((e) => (e.style.background = 'transparent'));
    const f = document.querySelector('.app-explorer-folder[data-folder="clinical-standards"]');
    f.style.background = 'var(--bs-surface-2)'; f.style.fontWeight = '600';
    const t = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Governance Charter' && !e.closest('.app-explorer-item'));
    if (t) t.textContent = 'Clinical Standards';
    const newFolderBtn = [...document.querySelectorAll('button[aria-label], button[title]')].find((x) => /new folder/i.test(x.getAttribute('aria-label') || x.title || ''));
    if (newFolderBtn) { const up = newFolderBtn.cloneNode(false); up.innerHTML = uploadSvg; up.setAttribute('aria-label', 'Upload files'); up.title = 'Upload files'; newFolderBtn.after(up); }
    const body = document.querySelector('.bs-doc-body');
    [...body.parentElement.children].forEach((c) => { if (c !== body) c.classList.add('mk-ribbon-locked'); });
    for (let e = document.querySelector('.bs-doc-sheetwrap'); e && e !== body; e = e.parentElement) { e.style.width = '100%'; e.style.maxWidth = 'none'; }
    document.querySelector('.bs-doc-sheetwrap').innerHTML = `
      <div class="mk-folder-desk">
        <div class="mk-sheet-head">
          <div><div class="mk-titlerow">${folderSvg}<h1>Clinical Standards</h1></div><p class="mk-meta">Folder · 2 documents</p></div>
          <span style="display:flex;gap:var(--brand-space-2)">
            <button class="bs-btn bs-btn-secondary bs-btn--sm" type="button">Upload files here</button>
            <button class="bs-btn bs-btn-primary bs-btn--sm" type="button">New document here</button>
          </span>
        </div>
        ${list}
      </div>`;
    document.querySelectorAll('*').forEach((x) => { if (x.children.length === 0 && /^Page 1 of 1$/.test(x.textContent.trim())) x.textContent = 'Folder'; });
    const w = [...document.querySelectorAll('*')].filter((x) => /^\d+\s*words$/.test(x.textContent.trim())).pop(); if (w) w.textContent = '';
  }, { list: folderList, folderSvg: svg('folder', 'lg'), uploadSvg: svg('upload') });
  await rightPanel(p, {
    where: 'For <strong>Clinical Standards</strong>',
    signs: signsPanel({
      editable: true,
      lead: 'Publishing anything in this folder will need one approval from each of these.',
      here: [IC_HERE, { name: G('Quality Committee', 'quality-committee'), who: who('priya', 'dan', 'hugo'), why: 'Set on this folder' }],
      above: [PO_BINDER, APPROVALS_BINDER],
    }),
  });
  if (notes) {
    await callout(p, '1', 860, 470, 'The same right-hand rail as the binder pages', 'A panel of its own at the editor\'s right edge, mirroring the file panel on the left. It shuts to a button like the file panel does.');
    await callout(p, '2', 330, 470, 'The folder\'s list gets the desk', 'Between the two panels, as wide as the desk allows.');
  }
  await p.screenshot({ path: __dirname + '/shots/v3-1-editor-folder.png' });

  // ── B. A document in the editor ─────────────────────────────────────────
  await p.goto(GOV + '/-/blob/main/clinical-standards/sepsis-pathway' + DRAFT); await p.waitForTimeout(6500);
  await style();
  await rightPanel(p, {
    where: 'For <strong>Sepsis Pathway</strong>, in Clinical Standards',
    signs: signsPanel({
      editable: true,
      lead: 'Publishing a new version will need one approval from each of these.',
      here: [], hereEmpty: 'Nothing is set on this document alone.',
      above: [{ name: G('Infection Control', 'infection-control'), who: who('grace', 'ines'), why: 'From the folder · Clinical Standards' }, PO_BINDER, APPROVALS_BINDER],
    }),
  });
  const pageBox = await p.locator('.bs-doc-page').first().boundingBox().catch(() => null);
  if (notes) {
    await callout(p, '1', 30, 430, 'On every document too', 'The rules for what you are writing, while you write it. Set here is empty until someone adds a rule for this document alone.');
    if (pageBox) console.log('page', JSON.stringify(pageBox));
  }
  await p.screenshot({ path: __dirname + '/shots/v3-2-editor-document.png' });

  await b.close();
})();
