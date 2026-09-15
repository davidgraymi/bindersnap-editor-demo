/*
 * The shell every binder screen shares — top bar and the two-level sidebar.
 *
 * Mockup scaffolding, not shipping code. It exists so the nine screens beside
 * it cannot drift from each other: the chrome is written once and every
 * screen renders the same one, which is the whole claim the redesign makes.
 *
 * Call `shell({ binder, section })` from a screen; it writes the chrome and
 * returns the element to fill. A classic script rather than a module, so the
 * screens open straight off disk without a server.
 */

const ICONS = {
  home: 'M3 7.5 9 3l6 4.5V15a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1V7.5Z',
  change: 'M5 2h5l3 3v11H5V2Zm5 0v3h3M7 9h4M7 12h3',
  doc: 'M5 2h5l3 3v11H5V2Zm5 0v3h3',
  binder: 'M3 3h3v13H3V3Zm5 0h3v13H8V3Zm5.5.4 2.4 12.2',
  people: 'M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.5 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM2 16v-1a3.5 3.5 0 0 1 3.5-3.5h3A3.5 3.5 0 0 1 12 15v1m1.5-5.2A3.5 3.5 0 0 1 16 14v2',
  activity: 'M2 10h3l2 5 4-12 2 7h3',
  org: 'M3 16V4l6-2 6 2v12M7 8h1m2 0h1M7 11h1m2 0h1M7 14h4',
  card: 'M2 5.5h14v8H2v-8Zm0 3h14',
  history: 'M3 9a6 6 0 1 0 1.8-4.3M3 3v3h3M9 6v3.2l2.4 1.4',
  gear: 'M9 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M14.6 11a1.2 1.2 0 0 0 .24 1.32l.04.05a1.4 1.4 0 1 1-2 2l-.04-.05a1.2 1.2 0 0 0-2.04.86v.12a1.4 1.4 0 1 1-2.8 0v-.06a1.2 1.2 0 0 0-2.1-.8l-.05.04a1.4 1.4 0 1 1-2-2l.05-.04a1.2 1.2 0 0 0-.86-2.04h-.12a1.4 1.4 0 1 1 0-2.8h.06a1.2 1.2 0 0 0 .8-2.1l-.04-.05a1.4 1.4 0 1 1 2-2l.05.05a1.2 1.2 0 0 0 2.04-.87V3.4a1.4 1.4 0 1 1 2.8 0v.06a1.2 1.2 0 0 0 2.04.86l.05-.04a1.4 1.4 0 1 1 2 2l-.05.04a1.2 1.2 0 0 0 .87 2.04h.12a1.4 1.4 0 1 1 0 2.8h-.06a1.2 1.2 0 0 0-1.1.74Z',
  search: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Zm4-1.5 3.5 3.5',
  plus: 'M9 4v10M4 9h10',
  bell: 'M9 2a4.5 4.5 0 0 0-4.5 4.5V10L3 13h12l-1.5-3V6.5A4.5 4.5 0 0 0 9 2Zm-2 11a2 2 0 0 0 4 0',
  chevron: 'M6 7.5 9 10.5l3-3',
};

function icon(name, size = 15) {
  const d = ICONS[name] ?? '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 18 18" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${d
      .split(' M')
      .map((part, i) => `<path d="${i === 0 ? part : 'M' + part}"/>`)
      .join('')}</svg>`;
}

/**
 * The binder's own sections, in the sidebar.
 *
 * Four, not six. People and Sign-off rules were tabs of their own beside
 * Documents, which said a thing somebody edits twice a year is a peer of the
 * thing they open every morning. They are sections inside Settings now, and
 * Settings keeps its own index so neither is buried.
 */
const BINDER_SECTIONS = [
  { key: 'documents', label: 'Policies', icon: 'doc', count: 4 },
  { key: 'changes', label: 'Changes', icon: 'change', count: 3 },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'settings', label: 'Settings', icon: 'gear' },
];

const GLOBAL_SECTIONS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'g-changes', label: 'Change requests', icon: 'change', count: 5 },
  { key: 'g-documents', label: 'Documents', icon: 'doc' },
  { key: 'binders', label: 'Binders', icon: 'binder' },
];

function item(entry, on) {
  const count =
    entry.count === undefined
      ? ''
      : `<span class="bs-side-count">${entry.count}</span>`;
  return `<button type="button" class="bs-side-item${on ? ' bs-side-item--on' : ''}"
    ${on ? 'aria-current="page"' : ''}>
      ${icon(entry.icon)}
      <span class="bs-side-item-label">${entry.label}</span>${count}
    </button>`;
}

function shell({ binder = 'Clinical', section = 'documents' } = {}) {
  const inBinder = BINDER_SECTIONS.some((s) => s.key === section);

  document.body.innerHTML = `
    <div class="bs-shell">
      <div class="bs-brandbar">
        <span class="bs-brandmark">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 2h8v12l-4-3-4 3V2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="bs-wordmark">Bindersnap</span>
      </div>

      <header class="bs-topbar">
        <button type="button" class="bs-orgswitch">
          ${icon('org', 14)} Riverside Health ${icon('chevron', 13)}
        </button>
        <div class="bs-topbar-spacer"></div>
        <button type="button" class="bs-search">
          ${icon('search', 14)}
          <span>Search</span>
          <span class="bs-kbd">⌘K</span>
        </button>
        <button type="button" class="bs-iconbtn" aria-label="New">${icon('plus', 16)}</button>
        <button type="button" class="bs-iconbtn" aria-label="Notifications">${icon('bell', 16)}</button>
        <span class="bs-avatar">AL</span>
      </header>

      <nav class="bs-side" aria-label="Navigation">
        <div class="bs-side-group">
          ${GLOBAL_SECTIONS.map((e) => item(e, e.key === section)).join('')}
        </div>

        ${
          inBinder
            ? `<div class="bs-side-group">
                 <div class="bs-side-binder">
                   <span class="bs-side-binder-mark">${icon('binder', 14)}</span>
                   <span class="bs-side-binder-name">${binder}</span>
                 </div>
                 ${BINDER_SECTIONS.map((e) => item(e, e.key === section)).join('')}
               </div>`
            : ''
        }

        <div class="bs-side-group">
          <div class="bs-side-label">Manage</div>
          ${item({ label: 'People & access', icon: 'people' }, false)}
          ${item({ label: 'Activity', icon: 'activity' }, false)}
        </div>

        <div class="bs-side-group">
          <div class="bs-side-label">Settings</div>
          ${item({ label: 'Organization', icon: 'org' }, false)}
          ${item({ label: 'Billing', icon: 'card' }, false)}
        </div>

        <div class="bs-side-spacer"></div>
        <div class="bs-side-user">
          <span class="bs-avatar bs-avatar--sm">AL</span> Alice Lundgren
        </div>
      </nav>

      <main class="bs-main"><div class="bs-page" id="page"></div></main>
    </div>`;

  return document.getElementById('page');
}

window.shell = shell;
window.bsIcon = icon;
