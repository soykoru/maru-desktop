/* MARU mockups — shell común. Inserta sidebar/topbar/statusbar y resaltado de tema. */
(function () {
  const PAGES = [
    { href: 'dashboard.html', label: 'Dashboard', icon: 'layout-dashboard' },
    { href: 'connection.html', label: 'Conexión', icon: 'plug' },
    { href: 'rules.html', label: 'Reglas', icon: 'list-checks' },
    { href: 'data.html', label: 'Datos', icon: 'database' },
    { href: 'social.html', label: 'Social', icon: 'users' },
    { href: 'spotify.html', label: 'Spotify', icon: 'music-2' },
    { href: 'ia.html', label: 'IA', icon: 'bot' },
    { href: 'overlays.html', label: 'Overlays', icon: 'image' },
    { href: 'profiles.html', label: 'Perfiles', icon: 'layers' },
    { href: 'logs.html', label: 'Logs', icon: 'scroll-text' },
    { href: 'settings.html', label: 'Ajustes', icon: 'settings' },
  ];

  const ICONS = {
    'layout-dashboard': '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M12 18v4"/><path d="M5 8h14v2a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4z"/>',
    'list-checks': '<path d="M3 17l2 2 4-4"/><path d="M3 7l2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'music-2': '<circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/>',
    bot: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>',
    'scroll-text': '<path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M22 17H7a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2z"/><path d="M9 8h6"/><path d="M9 12h6"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>',
  };

  function svg(name, cls) {
    const d = ICONS[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls || ''}">${d}</svg>`;
  }

  function buildShell(active, pageContent, opts = {}) {
    const navItems = PAGES.map(
      (p) =>
        `<a class="nav-item ${p.href === active ? 'active' : ''}" href="${p.href}">${svg(p.icon)}<span>${p.label}</span></a>`,
    ).join('');

    return `
<div class="app">
  <div class="titlebar">
    <div class="titlebar-brand"><span class="dot"></span> MARU Live · ${opts.title || ''}</div>
    <div class="win-btns">
      <button class="win-btn">${svg('minus')}</button>
      <button class="win-btn">${svg('square')}</button>
      <button class="win-btn danger">${svg('x')}</button>
    </div>
  </div>
  <div class="main">
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-logo">${svg('sparkles')}</div>
        <div>
          <div class="sidebar-title">MARU Live</div>
          <div class="sidebar-version">v0.2.0 · F2</div>
        </div>
      </div>
      <nav class="nav">${navItems}</nav>
    </aside>
    <main class="content">
      <div class="content-inner">${pageContent}</div>
    </main>
  </div>
  <footer class="statusbar">
    <div class="group">
      <span class="item">sidecar <span class="dot connected"></span></span>
      <span class="item">rpc <span class="dot connected"></span></span>
      <span class="item">tiktok <span class="dot connecting"></span> @soykoru</span>
    </div>
    <div class="group" style="font-family: ui-monospace, monospace;">
      <span>👁 1240</span><span>💎 580</span><span>❤ 9.4k</span>
    </div>
  </footer>
</div>`;
  }

  function buildTopbar(active) {
    const pages = PAGES.map((p) => `<a href="${p.href}" ${p.href === active ? 'style="background:var(--bg-elevated);color:var(--fg)"' : ''}>${p.label}</a>`).join('<span class="sep">·</span>');
    return `
<div class="mockup-nav">
  <strong>MARU mockups</strong>
  <span class="sep">·</span>
  ${pages}
  <div class="theme-switch" id="theme-switch">
    <button data-theme="midnight" class="active">Midnight</button>
    <button data-theme="aurora">Aurora</button>
    <button data-theme="cyberpunk">Cyberpunk</button>
  </div>
</div>`;
  }

  window.MaruShell = {
    render(active, pageContent, opts) {
      const root = document.getElementById('root');
      root.innerHTML = buildTopbar(active) + buildShell(active, pageContent, opts);
      const sw = document.getElementById('theme-switch');
      sw.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-theme]');
        if (!btn) return;
        document.documentElement.dataset.theme = btn.dataset.theme;
        sw.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        try { localStorage.setItem('maru-mockup-theme', btn.dataset.theme); } catch {}
      });
      const saved = (() => { try { return localStorage.getItem('maru-mockup-theme'); } catch { return null; } })();
      if (saved) {
        document.documentElement.dataset.theme = saved;
        sw.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === saved));
      }
    },
    icon: svg,
  };
})();
