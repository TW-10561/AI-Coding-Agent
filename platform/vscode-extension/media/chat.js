// Thirdwave AI — Webview Script
// Runs inside the VS Code webview sandbox
(function () {
  'use strict';

  const vs = acquireVsCodeApi();
  let cMod = '', cAg = 'build', allSk = [];
  var selectedSkills = {}; // { skillId: true }
  var lastRegistry = null; // cached registry data for dropdowns

  // ── Top bar: Settings toggle (right sidebar) ───────────────────
  var settingsBtn = document.getElementById('settingsBtn');
  var rsidebar = document.getElementById('rsidebar');
  if (settingsBtn && rsidebar) {
    settingsBtn.addEventListener('click', function () {
      var isOpen = rsidebar.classList.toggle('open');
      settingsBtn.classList.toggle('active', isOpen);
      // Close history overlay when opening settings
      var hist = document.getElementById('p-sessions');
      if (hist) hist.classList.remove('open');
      var histBtn = document.getElementById('histBtn');
      if (histBtn) histBtn.classList.remove('active');
      // Update topbar title
      var titleEl = document.getElementById('topbarTitle');
      if (titleEl) titleEl.textContent = isOpen ? 'SETTINGS' : 'CHAT';
    });
  }


  // ── Top bar: History toggle (overlay) ──────────────────────────
  var histBtn = document.getElementById('histBtn');
  var histPanel = document.getElementById('p-sessions');
  if (histBtn && histPanel) {
    histBtn.addEventListener('click', function () {
      var isOpen = histPanel.classList.toggle('open');
      histBtn.classList.toggle('active', isOpen);
      // Close settings when opening history
      if (isOpen && rsidebar) rsidebar.classList.remove('open');
      if (isOpen && settingsBtn) settingsBtn.classList.remove('active');
      // Update topbar title
      var titleEl = document.getElementById('topbarTitle');
      if (titleEl) titleEl.textContent = isOpen ? 'HISTORY' : 'CHAT';
    });
  }

  // ── History panel close button ─────────────────────────────────
  document.querySelectorAll('.pnl-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var overlay = btn.closest('.pnl-overlay');
      if (overlay) overlay.classList.remove('open');
      if (histBtn) histBtn.classList.remove('active');
      var titleEl = document.getElementById('topbarTitle');
      if (titleEl) titleEl.textContent = 'CHAT';
    });
  });

  // ── Right sidebar icon switching ───────────────────────────────
  document.querySelectorAll('.rs-icon').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.rs-icon').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.rs-pnl').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      var pnl = document.getElementById('rp-' + t.getAttribute('data-rs'));
      if (pnl) pnl.classList.add('active');
    });
  });

  // ── Chat elements ──────────────────────────────────────────────
  var msgsEl = document.getElementById('msgs');
  var esEl = document.getElementById('es');
  var ldEl = document.getElementById('ld');
  var inp = document.getElementById('inp');
  var snd = document.getElementById('snd');
  var agBtn = document.getElementById('agBtn');
  var agLbl = document.getElementById('agLbl');
  var mdBtn = document.getElementById('mdBtn');
  var mdLbl = document.getElementById('mdLbl');
  var skQ = document.getElementById('skQ');
  var attachBtn = document.getElementById('attachBtn');
  var attachBar = document.getElementById('attachBar');
  var diagBtn = document.getElementById('diagBtn');
  var diagLbl = document.getElementById('diagLbl');
  var attachedFiles = []; // { name, path, language, size }
  var lastUserText = ''; // for retry button
  var wsFiles = [];       // workspace files from extension for @ mentions

  // ── Smart auto-scroll: only auto-scroll when user is near bottom ──
  var userScrolledUp = false;
  function isNearBottom() {
    if (!msgsEl) return true;
    return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
  }
  function autoScroll() {
    if (!userScrolledUp && msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  if (msgsEl) {
    msgsEl.addEventListener('scroll', function () {
      userScrolledUp = !isNearBottom();
    });
  }

  // ── Event delegation for reasoning headers (no listener accumulation) ───
  if (msgsEl) {
    msgsEl.addEventListener('click', function (e) {
      var rh = e.target.closest('.rh');
      if (rh) {
        var rsn = rh.closest('.rsn');
        if (rsn) rsn.classList.toggle('exp');
      }
    });
  }

  // Helper: find model display name from registry
  function resolveModelName(modelId) {
    if (!modelId || !lastRegistry) return '';
    var local = lastRegistry.local || [];
    for (var i = 0; i < local.length; i++) {
      for (var j = 0; j < local[i].models.length; j++) {
        var m = local[i].models[j];
        if (m.id === modelId) return m.name || m.id;
      }
    }
    var cloud = lastRegistry.cloud || [];
    for (var i = 0; i < cloud.length; i++) {
      for (var j = 0; j < cloud[i].models.length; j++) {
        var m = cloud[i].models[j];
        if (m.id === modelId) return m.name || m.id;
      }
    }
    return modelId; // fallback to raw ID
  }

  // Helper: get the default model name from registry (first online local model)
  function defaultModelName() {
    if (!lastRegistry) return 'loading...';
    var local = lastRegistry.local || [];
    for (var i = 0; i < local.length; i++) {
      if (local[i].status === 'online' && local[i].models.length > 0) {
        return local[i].models[0].name || local[i].models[0].id;
      }
    }
    return 'no model';
  }

  function updateModelLabel() {
    if (mdLbl) mdLbl.textContent = cMod ? resolveModelName(cMod) : defaultModelName();
  }

  var SEND_SVG = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var STOP_SVG = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  var isGenerating = false;

  function send() {
    var t = inp.value.trim();
    if (!t) return;
    lastUserText = t;
    inp.value = '';
    inp.style.height = '36px';
    isGenerating = true;
    snd.innerHTML = STOP_SVG;
    snd.classList.add('stop-mode');
    snd.disabled = false;
    vs.postMessage({ type: 'sendMessage', text: t });
    // Clear attachment chips after send (backend clears actual attachments)
    attachedFiles = [];
    renderAttachBar();
  }

  function stopGeneration() {
    vs.postMessage({ type: 'stopGeneration' });
    isGenerating = false;
    snd.innerHTML = SEND_SVG;
    snd.classList.remove('stop-mode');
    snd.disabled = false;
  }

  snd.addEventListener('click', function () {
    if (isGenerating) {
      stopGeneration();
    } else {
      send();
    }
  });

  // ── File attach button ─────────────────────────────────────────
  if (attachBtn) {
    attachBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var items = [
        { label: 'Browse files...', value: 'pick' },
        { label: 'Attach active file', value: 'active' }
      ];
      showDropdown(attachBtn, items, function (val) {
        if (val === 'pick') vs.postMessage({ type: 'pickFiles' });
        else if (val === 'active') vs.postMessage({ type: 'attachActiveFile' });
      });
    });
  }

  function renderAttachBar() {
    if (!attachBar) return;
    if (attachedFiles.length === 0) { attachBar.style.display = 'none'; attachBar.innerHTML = ''; return; }
    attachBar.style.display = 'flex';
    var h = '';
    for (var i = 0; i < attachedFiles.length; i++) {
      var f = attachedFiles[i];
      h += '<span class="attach-chip" data-path="' + esc(f.path) + '">' +
        '<span class="attach-name">' + esc(f.name) + '</span>' +
        '<button class="attach-rm" data-path="' + esc(f.path) + '">&times;</button></span>';
    }
    attachBar.innerHTML = h;
    attachBar.querySelectorAll('.attach-rm').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = btn.getAttribute('data-path');
        attachedFiles = attachedFiles.filter(function (f) { return f.path !== p; });
        vs.postMessage({ type: 'removeAttachment', path: p });
        renderAttachBar();
      });
    });
  }

  // ── Diagnostics button ─────────────────────────────────────────
  if (diagBtn) diagBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'getDiagnostics' });
  });

  inp.addEventListener('keydown', function (e) {
    // Slash popup navigation
    if (slashPopup && slashPopup.style.display !== 'none') {
      var items = slashPopup.querySelectorAll('.slash-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashIdx = Math.min(slashIdx + 1, items.length - 1);
        highlightSlashItem(items);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashIdx = Math.max(slashIdx - 1, 0);
        highlightSlashItem(items);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[slashIdx]) items[slashIdx].click();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSlashPopup();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isGenerating) stopGeneration();
      else send();
    }
  });

  // ── Slash command skill picker ────────────────────────────────
  var slashPopup = null;
  var slashIdx = 0;

  function createSlashPopup() {
    if (slashPopup) return;
    slashPopup = document.createElement('div');
    slashPopup.className = 'slash-popup';
    slashPopup.style.display = 'none';
    var ia = inp.closest('.ia');
    if (ia) ia.insertBefore(slashPopup, ia.firstChild);
  }
  createSlashPopup();

  function highlightSlashItem(items) {
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === slashIdx);
    }
    if (items[slashIdx]) items[slashIdx].scrollIntoView({ block: 'nearest' });
  }

  function hideSlashPopup() {
    if (slashPopup) slashPopup.style.display = 'none';
  }

  function showSlashPopup(filter) {
    if (!slashPopup || !allSk.length) return;
    var q = filter.toLowerCase();
    var matches = allSk.filter(function (s) {
      return s.name.toLowerCase().indexOf(q) !== -1 || (s.id && s.id.toLowerCase().indexOf(q) !== -1);
    });
    if (!matches.length) { hideSlashPopup(); return; }
    // Show max 8 items
    matches = matches.slice(0, 8);
    var html = '';
    for (var i = 0; i < matches.length; i++) {
      var s = matches[i];
      var isActive = selectedSkills[s.id] ? ' checked' : '';
      html += '<div class="slash-item' + (i === 0 ? ' active' : '') + '" data-sid="' + esc(s.id) + '">'
        + '<span class="slash-name">' + esc(s.name) + '</span>'
        + (isActive ? '<span class="slash-active">&#10003;</span>' : '')
        + '</div>';
    }
    slashPopup.innerHTML = html;
    slashPopup.style.display = 'block';
    slashIdx = 0;

    slashPopup.querySelectorAll('.slash-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var sid = item.getAttribute('data-sid');
        // Toggle the skill on
        if (!selectedSkills[sid]) {
          selectedSkills[sid] = true;
          vs.postMessage({ type: 'toggleSkill', skillId: sid, enabled: true });
          updateSkillCount();
        }
        // Clear the slash command text from input
        inp.value = '';
        inp.style.height = '36px';
        hideSlashPopup();
        inp.focus();
      });
    });
  }

  inp.addEventListener('input', function () {
    inp.style.height = '36px';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';

    var val = inp.value;
    var caretPos = inp.selectionStart || 0;

    // @ mention detection — find last `@` before cursor that's not preceded by a word char
    var beforeCaret = val.substring(0, caretPos);
    var atMatch = beforeCaret.match(/(^|[\s])@([^\s@]*)$/);
    if (atMatch) {
      hideSlashPopup();
      var filter = atMatch[2];
      showAtPopup(filter, atMatch.index + atMatch[1].length);
    } else {
      hideAtPopup();
      // Slash command detection
      if (val.charAt(0) === '/') {
        var filter = val.substring(1);
        showSlashPopup(filter);
      } else {
        hideSlashPopup();
      }
    }
  });

  // ── @ mention file picker ─────────────────────────────────────
  var atPopup = null;
  var atIdx = 0;
  var atStartPos = 0; // position of the @ in the input

  function createAtPopup() {
    if (atPopup) return;
    atPopup = document.createElement('div');
    atPopup.className = 'at-popup';
    atPopup.style.display = 'none';
    var ia = inp.closest('.ia');
    if (ia) ia.insertBefore(atPopup, ia.firstChild);
  }
  createAtPopup();

  function hideAtPopup() {
    if (atPopup) atPopup.style.display = 'none';
  }

  function showAtPopup(filter, startPos) {
    atStartPos = startPos;
    if (!atPopup) return;
    // Request files from extension (cached)
    if (!wsFiles.length) {
      vs.postMessage({ type: 'getWorkspaceFiles' });
    }
    var q = filter.toLowerCase();
    var matches = wsFiles.filter(function (f) {
      return f.path.toLowerCase().indexOf(q) !== -1 || f.name.toLowerCase().indexOf(q) !== -1;
    });
    if (!matches.length && wsFiles.length > 0) { hideAtPopup(); return; }
    if (!matches.length) {
      atPopup.innerHTML = '<div class="at-item loading">Loading files...</div>';
      atPopup.style.display = 'block';
      return;
    }
    matches = matches.slice(0, 10);
    var html = '';
    for (var i = 0; i < matches.length; i++) {
      var f = matches[i];
      html += '<div class="at-item' + (i === 0 ? ' active' : '') + '" data-path="' + esc(f.path) + '">'
        + '<span class="at-icon">&#128196;</span>'
        + '<span class="at-path">' + esc(f.path) + '</span>'
        + '</div>';
    }
    atPopup.innerHTML = html;
    atPopup.style.display = 'block';
    atIdx = 0;

    atPopup.querySelectorAll('.at-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var p = item.getAttribute('data-path');
        if (!p) return;
        // Replace @filter with @path in the input
        var val = inp.value;
        var before = val.substring(0, atStartPos);
        var afterCaret = val.substring(inp.selectionStart || 0);
        inp.value = before + '@' + p + ' ' + afterCaret;
        inp.style.height = '36px';
        inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
        hideAtPopup();
        inp.focus();
        // Also attach the file
        vs.postMessage({ type: 'attachActiveFile' }); // will attach whatever matches
      });
    });
  }

  // Handle @ popup keyboard navigation
  inp.addEventListener('keydown', function (e) {
    if (atPopup && atPopup.style.display !== 'none') {
      var items = atPopup.querySelectorAll('.at-item:not(.loading)');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        atIdx = Math.min(atIdx + 1, items.length - 1);
        items.forEach(function (it, idx) { it.classList.toggle('active', idx === atIdx); });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        atIdx = Math.max(atIdx - 1, 0);
        items.forEach(function (it, idx) { it.classList.toggle('active', idx === atIdx); });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length > 0) {
          e.preventDefault();
          items[atIdx].click();
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideAtPopup();
        return;
      }
    }
  });

  // ── Theme picker ───────────────────────────────────────────────
  var themePicker = document.getElementById('themePicker');
  if (themePicker) {
    // Restore saved theme (migrate removed themes)
    var savedTheme = localStorage.getItem('tw-theme') || '';
    if (savedTheme === 'night') { savedTheme = ''; localStorage.setItem('tw-theme', ''); }
    if (savedTheme) {
      document.body.className = 'theme-' + savedTheme;
      themePicker.querySelectorAll('.theme-btn').forEach(function (b) {
        b.classList.toggle('sel', b.getAttribute('data-theme') === savedTheme);
      });
    }
    themePicker.addEventListener('click', function (e) {
      var btn = e.target.closest('.theme-btn');
      if (!btn) return;
      var theme = btn.getAttribute('data-theme');
      // Remove all theme classes
      document.body.className = theme ? 'theme-' + theme : '';
      // Highlight selected button
      themePicker.querySelectorAll('.theme-btn').forEach(function (b) { b.classList.remove('sel'); });
      btn.classList.add('sel');
      // Persist
      localStorage.setItem('tw-theme', theme || '');
    });
  }

  var newBtn = document.getElementById('newBtn');
  if (newBtn) newBtn.addEventListener('click', function () {
    // Navigate back to chat view when on history or settings page
    if (rsidebar) rsidebar.classList.remove('open');
    if (settingsBtn) settingsBtn.classList.remove('active');
    if (histPanel) histPanel.classList.remove('open');
    if (histBtn) histBtn.classList.remove('active');
    var titleEl = document.getElementById('topbarTitle');
    if (titleEl) titleEl.textContent = 'CHAT';
    vs.postMessage({ type: 'newSession' });
  });

  var startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'newSession' });
    inp.focus();
  });

  // ── Inline dropdown helper ──────────────────────────────────
  var activeDropdown = null;
  function closeDropdown() {
    if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
  }
  document.addEventListener('click', function (e) {
    if (activeDropdown && !activeDropdown.contains(e.target) && e.target !== agBtn && e.target !== mdBtn && !agBtn.contains(e.target) && !mdBtn.contains(e.target)) {
      closeDropdown();
    }
  });

  function showDropdown(anchorEl, items, onSelect) {
    closeDropdown();
    var dd = document.createElement('div');
    dd.className = 'it-dropdown';
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var opt = document.createElement('div');
        opt.className = 'it-dd-item' + (item.active ? ' active' : '');
        opt.textContent = item.label;
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          closeDropdown();
          onSelect(item.value);
        });
        dd.appendChild(opt);
      })(items[i]);
    }
    // Position above the anchor button
    var rect = anchorEl.getBoundingClientRect();
    var ia = document.querySelector('.ia');
    var iaRect = ia ? ia.getBoundingClientRect() : { left: 0, bottom: 0 };
    dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dd.style.left = (rect.left - iaRect.left) + 'px';
    if (ia) ia.style.position = 'relative';
    ia.appendChild(dd);
    activeDropdown = dd;
  }

  // Bottom toolbar — agent button shows agent dropdown, model button shows model dropdown
  if (agBtn) agBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var agents = [
      { label: 'Build', value: 'build', active: cAg === 'build' },
      { label: 'Plan', value: 'plan', active: cAg === 'plan' },
      { label: 'Explore', value: 'explore', active: cAg === 'explore' },
      { label: 'General', value: 'general', active: cAg === 'general' }
    ];
    showDropdown(agBtn, agents, function (val) {
      cAg = val;
      if (agLbl) agLbl.textContent = val;
      document.querySelectorAll('.ag-card').forEach(function (c) {
        c.classList.toggle('sel', c.getAttribute('data-ag') === val);
      });
      vs.postMessage({ type: 'selectAgent', agent: val });
    });
  });
  if (mdBtn) mdBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var items = [];
    if (lastRegistry) {
      var local = lastRegistry.local || [];
      for (var i = 0; i < local.length; i++) {
        for (var j = 0; j < local[i].models.length; j++) {
          var m = local[i].models[j];
          items.push({ label: m.name || m.id, value: m.id, active: cMod === m.id });
        }
      }
      var cloud = lastRegistry.cloud || [];
      for (var i = 0; i < cloud.length; i++) {
        if (!cloud[i].configured) continue;
        for (var j = 0; j < cloud[i].models.length; j++) {
          var m = cloud[i].models[j];
          items.push({ label: m.name || m.id, value: m.id, active: cMod === m.id });
        }
      }
    }
    if (items.length === 0) items.push({ label: 'No models available', value: '', active: false });
    showDropdown(mdBtn, items, function (val) {
      if (val) {
        cMod = val;
        updateModelLabel();
        document.querySelectorAll('.mc').forEach(function (c) {
          c.classList.toggle('sel', c.getAttribute('data-mid') === val);
        });
        vs.postMessage({ type: 'selectModel', modelId: val });
      }
    });
  });

  // Agent cards in Agents tab
  document.querySelectorAll('.ag-card').forEach(function (c) {
    c.addEventListener('click', function () {
      document.querySelectorAll('.ag-card').forEach(function (x) { x.classList.remove('sel'); });
      c.classList.add('sel');
      var ag = c.getAttribute('data-ag');
      cAg = ag;
      if (agLbl) agLbl.textContent = ag;
      vs.postMessage({ type: 'selectAgent', agent: ag });
    });
  });

  // ── Skill filter ───────────────────────────────────────────────
  if (skQ) skQ.addEventListener('input', function () {
    var q = skQ.value.trim().toLowerCase();
    if (q.length < 2) { renderSkills(allSk); return; }
    renderSkills(allSk.filter(function (s) {
      var sk = s.skill || s;
      return (sk.name || '').toLowerCase().includes(q) ||
        (sk.displayName || '').toLowerCase().includes(q) ||
        (sk.description || '').toLowerCase().includes(q) ||
        (sk.tags || []).some(function (t) { return t.toLowerCase().includes(q); });
    }));
  });

  // ── Skill event delegation (no listener accumulation) ─────────
  var skC = document.getElementById('skC');
  if (skC) {
    skC.addEventListener('click', function (e) {
      var btn = e.target.closest('.sk-toggle');
      if (btn) {
        e.stopPropagation();
        var sid = btn.getAttribute('data-tid');
        if (selectedSkills[sid]) {
          delete selectedSkills[sid];
        } else {
          selectedSkills[sid] = true;
        }
        vs.postMessage({ type: 'toggleSkill', skillId: sid, enabled: !!selectedSkills[sid] });
        renderSkills(allSk.filter(function (s) {
          var sk = s.skill || s;
          var q = (skQ && skQ.value) ? skQ.value.trim().toLowerCase() : '';
          if (q.length < 2) return true;
          return (sk.name || '').toLowerCase().includes(q) ||
            (sk.displayName || '').toLowerCase().includes(q) ||
            (sk.description || '').toLowerCase().includes(q) ||
            (sk.tags || []).some(function (t) { return t.toLowerCase().includes(q); });
        }));
        updateSkillCount();
      } else {
        var k = e.target.closest('.sk');
        if (k && !e.target.closest('.sk-toggle')) {
          vs.postMessage({ type: 'viewSkill', skillId: k.getAttribute('data-sid'), skillName: k.getAttribute('data-snm') });
        }
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function md(t) {
    var h = esc(t);
    var i = 0;
    // code blocks
    h = h.replace(/```(\w*?)\n([\s\S]*?)```/g, function (_, l, c) {
      var id = 'c' + (i++);
      return '<div class="cbw">' + (l ? '<span class="cl">' + l + '</span>' : '') +
        '<button class="cpb" data-ci="' + id + '">Copy</button>' +
        '<pre><code id="' + id + '">' + c + '</code></pre></div>';
    });
    // inline code
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    // bold
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // headings
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // lists
    h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
    h = h.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
    // blockquote
    h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    // paragraphs
    h = h.replace(/\n\n/g, '</p><p>');
    h = h.replace(/\n/g, '<br>');
    return '<p>' + h + '</p>';
  }

  function tsum(tc) {
    var n = tc.tool || 'unknown', a = tc.args || {};
    if (n === 'write_file' || n === 'create_file') {
      var p = a.path || a.filePath || '';
      return p ? 'wrote ' + p.split('/').pop() : 'wrote file';
    }
    if (n === 'read_file') {
      var p = a.path || a.filePath || '';
      return p ? 'read ' + p.split('/').pop() : 'read file';
    }
    if (n === 'run_command' || n === 'execute' || n === 'bash') {
      var c = a.command || a.cmd || '';
      return c ? c.substring(0, 40) + (c.length > 40 ? '...' : '') : 'ran command';
    }
    if (n === 'search' || n === 'grep') {
      return 'searched: ' + (a.query || a.pattern || '').substring(0, 30);
    }
    return tc.success ? 'completed' : 'failed';
  }

  // ── Render message ─────────────────────────────────────────────
  function renderMsg(m) {
    if (esEl) esEl.style.display = 'none';
    var el = document.createElement('div');
    el.className = 'msg ' + m.role;

    var hdr = document.createElement('div');
    hdr.className = 'mh ' + m.role;
    hdr.innerHTML = '<span class="d"></span><span>' + m.role + '</span>';
    if (m.model) hdr.innerHTML += '<span class="meta">' + esc(m.model) + '</span>';
    if (m.latencyMs) hdr.innerHTML += '<span class="meta">' + (m.latencyMs / 1000).toFixed(1) + 's</span>';
    el.appendChild(hdr);

    if (m.toolCalls && m.toolCalls.length) {
      var tEl = document.createElement('div');
      tEl.className = 'tcs';
      for (var i = 0; i < m.toolCalls.length; i++) {
        var tc = m.toolCalls[i];
        var d = document.createElement('div');
        d.className = 'tc ' + (tc.success ? 'ok' : 'fail');

        // Tool header
        var tcHeader = '<span class="ti">' + (tc.success ? '&#10003;' : '&#10007;') + '</span>' +
          '<span class="tn">' + esc(tc.tool) + '</span>' +
          '<span class="ts">' + esc(tsum(tc)) + '</span>';

        // Check if this is a write_file for inline diff rendering
        var isWrite = (tc.tool === 'write_file' || tc.tool === 'create_file');
        var isBash = (tc.tool === 'bash' || tc.tool === 'run_command' || tc.tool === 'execute');
        var isGit = (tc.tool === 'git_status' || tc.tool === 'git_diff' || tc.tool === 'git_log');

        if (tc.result && (isBash || isGit)) {
          // Terminal output rendering — collapsible
          tcHeader += '<button class="tc-expand-btn">&#9660;</button>';
          d.innerHTML = tcHeader;
          var outBlock = document.createElement('div');
          outBlock.className = 'tool-output collapsed';
          outBlock.innerHTML = '<pre class="tool-output-pre">' + esc(tc.result) + '</pre>';
          d.appendChild(outBlock);
        } else if (isWrite && tc.args) {
          // Inline diff rendering for write_file
          tcHeader += '<button class="tc-expand-btn">&#9660;</button>';
          d.innerHTML = tcHeader;
          var diffBlock = document.createElement('div');
          diffBlock.className = 'diff-block collapsed';
          var content = tc.args.content || tc.args.text || '';
          if (content) {
            var diffHtml = '<div class="diff-header">' + esc(tc.args.path || tc.args.filePath || 'file') + '</div>';
            diffHtml += '<pre class="diff-content">';
            var lines = String(content).split('\n');
            for (var li = 0; li < Math.min(lines.length, 50); li++) {
              diffHtml += '<span class="diff-add">+ ' + esc(lines[li]) + '</span>\n';
            }
            if (lines.length > 50) diffHtml += '<span class="diff-meta">... +' + (lines.length - 50) + ' more lines</span>\n';
            diffHtml += '</pre>';
            diffBlock.innerHTML = diffHtml;
          }
          d.appendChild(diffBlock);
        } else if (tc.result && tc.result.length > 10) {
          // Generic tool output — collapsible for any tool with output
          tcHeader += '<button class="tc-expand-btn">&#9660;</button>';
          d.innerHTML = tcHeader;
          var genBlock = document.createElement('div');
          genBlock.className = 'tool-output collapsed';
          genBlock.innerHTML = '<pre class="tool-output-pre">' + esc(tc.result.substring(0, 2000)) + '</pre>';
          d.appendChild(genBlock);
        } else {
          d.innerHTML = tcHeader;
        }

        tEl.appendChild(d);
      }
      el.appendChild(tEl);
    }

    if (m.reasoning) {
      var r = document.createElement('div');
      r.className = 'rsn';
      r.innerHTML = '<div class="rh">&#9671; Reasoning &#9660;</div><div class="rc">' + esc(m.reasoning) + '</div>';
      el.appendChild(r);
    }

    var body = document.createElement('div');
    body.className = 'mb';
    if (m.role === 'user' || m.role === 'system') {
      body.textContent = m.content;
    } else {
      body.innerHTML = md(m.content);
    }
    el.appendChild(body);

    // Retry button on error messages
    if (m.role === 'system' && m.content && m.content.indexOf('Error:') !== -1 && lastUserText) {
      var retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.innerHTML = '&#8635; Retry';
      retryBtn.title = 'Re-send the last prompt';
      retryBtn.addEventListener('click', function () {
        vs.postMessage({ type: 'sendMessage', text: lastUserText });
      });
      el.appendChild(retryBtn);
    }

    if (m.tokens) {
      var tk = document.createElement('div');
      tk.className = 'tkn';
      tk.innerHTML = '<span>&uarr; ' + m.tokens.input + '</span><span>&darr; ' + m.tokens.output + '</span>';
      el.appendChild(tk);
    }

    msgsEl.appendChild(el);
    autoScroll();
  }

  // ── Toggle tool output / diff blocks (event delegation) ────────
  if (msgsEl) {
    msgsEl.addEventListener('click', function (e) {
      var expandBtn = e.target.closest('.tc-expand-btn');
      if (expandBtn) {
        var parentTc = expandBtn.closest('.tc');
        if (parentTc) {
          var block = parentTc.querySelector('.tool-output, .diff-block');
          if (block) {
            block.classList.toggle('collapsed');
            expandBtn.innerHTML = block.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
          }
        }
      }
    });
  }

  // ── Render cloud provider detail (Cline-style) ─────────────
  var selectedCloudModel = ''; // track model picked in the cloud detail

  function renderCloudDetail(providerId, cloudList) {
    var det = document.getElementById('cpDetail');
    if (!det) return;
    var p = null;
    for (var i = 0; i < cloudList.length; i++) {
      if (cloudList[i].id === providerId) { p = cloudList[i]; break; }
    }
    if (!p) { det.innerHTML = '<div class="nd">Select a provider above</div>'; return; }

    // Figure out which cloud model is currently active for this provider
    var activeCloudModel = '';
    for (var j = 0; j < p.models.length; j++) {
      if (p.models[j].id === cMod) { activeCloudModel = cMod; break; }
    }

    var h = '';
    // API key section
    h += '<div class="cl-section">';
    h += '<label class="cl-field-lbl">' + esc(p.name) + ' API Key</label>';
    h += '<input class="cl-key-inp" id="clKeyInp" type="password" placeholder="Enter API Key..." data-provider="' + esc(p.id) + '" />';
    if (p.docUrl) {
      h += '<button class="cl-get-key-btn" id="clGetKeyBtn" data-url="' + esc(p.docUrl) + '">Get ' + esc(p.name) + ' API Key</button>';
    }
    h += '<div class="cl-note">This key is stored on the server and used to make API requests through the platform.</div>';
    if (p.configured) {
      h += '<div class="cl-status-ok">&#10003; API key configured</div>';
    }
    h += '<button class="cl-save-btn" id="clSaveBtn" data-provider="' + esc(p.id) + '">' + (p.configured ? 'Update Key' : 'Save Key') + '</button>';
    h += '</div>';

    // Model selector
    h += '<div class="cl-section">';
    h += '<label class="cl-field-lbl">Model</label>';
    h += '<div class="cl-model-select-row">';
    h += '<select class="cl-model-select" id="clModelSel">';
    if (!p.configured) {
      h += '<option value="">Configure API key first</option>';
    } else {
      for (var j = 0; j < p.models.length; j++) {
        var m = p.models[j];
        var sel = m.id === activeCloudModel ? ' selected' : '';
        h += '<option value="' + esc(m.id) + '"' + sel + '>' + esc(m.name || m.id) + '</option>';
      }
    }
    h += '</select>';
    if (activeCloudModel) {
      h += '<button class="cl-model-clear" id="clModelClear" title="Clear selection">&times;</button>';
    }
    h += '</div>';
    h += '</div>';

    // Model detail card (if a model is selected)
    var selModel = null;
    var showId = activeCloudModel || (p.configured && p.models.length > 0 ? p.models[0].id : '');
    for (var j = 0; j < p.models.length; j++) {
      if (p.models[j].id === showId) { selModel = p.models[j]; break; }
    }
    if (selModel) {
      h += '<div class="cl-model-detail">';
      h += '<div class="cl-model-stats">';
      h += '<span>Context: <strong>' + (selModel.contextLimit >= 1000 ? Math.round(selModel.contextLimit / 1000) + 'K' : selModel.contextLimit) + '</strong></span>';
      h += '<span>Input: <strong>$' + selModel.costIn + '/M</strong></span>';
      h += '<span>Output: <strong>$' + selModel.costOut + '/M</strong></span>';
      h += '</div>';
      if (selModel.outputLimit) {
        h += '<div class="cl-model-meta">Max output: ' + selModel.outputLimit.toLocaleString() + ' tokens</div>';
      }
      h += '</div>';
    }

    det.innerHTML = h;

    // Bind events
    var saveBtn = document.getElementById('clSaveBtn');
    var keyInp = document.getElementById('clKeyInp');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var key = keyInp ? keyInp.value.trim() : '';
        if (!key) return;
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;
        vs.postMessage({ type: 'setCloudKey', provider: p.id, key: key });
      });
    }
    var getKeyBtn = document.getElementById('clGetKeyBtn');
    if (getKeyBtn) {
      getKeyBtn.addEventListener('click', function () {
        vs.postMessage({ type: 'openExternal', url: getKeyBtn.getAttribute('data-url') });
      });
    }
    var modelSel = document.getElementById('clModelSel');
    if (modelSel && p.configured) {
      modelSel.addEventListener('change', function () {
        if (modelSel.value) {
          cMod = modelSel.value;
          updateModelLabel();
          vs.postMessage({ type: 'selectModel', modelId: modelSel.value });
          // Immediately re-render the detail card with the new model's specs
          if (lastRegistry) renderCloudDetail(p.id, lastRegistry.cloud || []);
        }
      });
    }
    var modelClear = document.getElementById('clModelClear');
    if (modelClear) {
      modelClear.addEventListener('click', function () {
        vs.postMessage({ type: 'selectModel', modelId: '' });
        if (modelSel) modelSel.value = '';
        modelClear.remove();
      });
    }
  }

  // ── Render models ──────────────────────────────────────────────
  function renderModels(reg) {
    lastRegistry = reg; // cache for dropdowns
    var lc = document.getElementById('lcm');
    var cc = document.getElementById('ccm');

    var lh = '';
    var local = reg.local || [];
    for (var i = 0; i < local.length; i++) {
      var p = local[i];
      var sc = p.status === 'online' ? 'on2' : 'off2';
      lh += '<div class="ms"><div class="msh"><span><span class="sd2 ' + sc + '"></span>' + esc(p.name) + '</span>';
      lh += '<span class="bc">' + p.models.length + ' model' + (p.models.length !== 1 ? 's' : '') + '</span></div><div class="ml">';
      for (var j = 0; j < p.models.length; j++) {
        var m = p.models[j];
        var s = cMod === m.id ? ' sel' : '';
        lh += '<div class="mc' + s + '" data-mid="' + esc(m.id) + '">' +
          '<span class="mi">&#128421;</span><span class="mn">' + esc(m.name || m.id) + '</span>' +
          '<span class="lt">local</span><span class="mm">ctx:' + m.contextLimit + '</span></div>';
      }
      lh += '</div></div>';
    }
    if (lc) lc.innerHTML = lh || '<div class="nd">No gateway models available</div>';

    var ch = '';
    var cloud = reg.cloud || [];
    // Populate the provider dropdown
    var cpSelect = document.getElementById('cpSelect');
    if (cpSelect) {
      var prevVal = cpSelect.value;
      cpSelect.innerHTML = '';
      for (var i = 0; i < cloud.length; i++) {
        var opt = document.createElement('option');
        opt.value = cloud[i].id;
        opt.textContent = cloud[i].name;
        cpSelect.appendChild(opt);
      }
      // Restore previous selection or default to first
      if (prevVal && cloud.some(function(p) { return p.id === prevVal; })) {
        cpSelect.value = prevVal;
      } else if (cloud.length > 0) {
        cpSelect.value = cloud[0].id;
      }
      // Render the selected provider detail
      renderCloudDetail(cpSelect.value, cloud);
      // Bind change event (remove old one first)
      cpSelect.onchange = function () { renderCloudDetail(cpSelect.value, cloud); };
    }

    // Model card click → select model
    document.querySelectorAll('.mc').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('.mc').forEach(function (x) { x.classList.remove('sel'); });
        c.classList.add('sel');
        var mid = c.getAttribute('data-mid');
        cMod = mid;
        updateModelLabel();
        vs.postMessage({ type: 'selectModel', modelId: mid });
      });
    });

    // Cloud provider key save buttons are bound inside renderCloudDetail
  }

  // ── Render skills ──────────────────────────────────────────────
  function updateSkillCount() {
    var cnt = document.getElementById('skCnt');
    if (cnt) cnt.textContent = Object.keys(selectedSkills).length;
    renderActiveSkillsBar();
  }

  function renderActiveSkillsBar() {
    var bar = document.getElementById('activeSkillsBar');
    if (!bar) return;
    var ids = Object.keys(selectedSkills);
    if (ids.length === 0) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    var h = '';
    for (var i = 0; i < ids.length; i++) {
      var sid = ids[i];
      var name = sid;
      // Resolve display name from allSk
      for (var j = 0; j < allSk.length; j++) {
        var sk = allSk[j].skill || allSk[j];
        if (sk.id === sid) { name = sk.displayName || sk.name || sid; break; }
      }
      h += '<span class="skill-pill" title="' + esc(name) + '">' +
        '<span class="skill-pill-icon">&#9733;</span>' + esc(name) +
        '<button class="skill-pill-rm" data-sid="' + esc(sid) + '">&times;</button></span>';
    }
    bar.innerHTML = h;
    bar.querySelectorAll('.skill-pill-rm').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var sid = btn.getAttribute('data-sid');
        delete selectedSkills[sid];
        vs.postMessage({ type: 'toggleSkill', skillId: sid, enabled: false });
        renderSkills(allSk);
        updateSkillCount();
      });
    });
  }

  function renderSkills(skills) {
    var c = document.getElementById('skC');
    if (!c) return;
    if (!skills || !skills.length) {
      c.innerHTML = '<div class="nd">No skills available.<br>Skills appear once the platform loads them.</div>';
      return;
    }
    var cats = {};
    for (var i = 0; i < skills.length; i++) {
      var sk = skills[i].skill || skills[i];
      var cat = sk.category || 'General';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(sk);
    }
    var h = '';
    var catKeys = Object.keys(cats);
    for (var ci = 0; ci < catKeys.length; ci++) {
      var cat = catKeys[ci];
      var arr = cats[cat];
      h += '<div class="st" style="margin-top:8px">' + esc(cat) + ' (' + arr.length + ')</div>';
      for (var i = 0; i < arr.length; i++) {
        var sk = arr[i];
        var tags = sk.tags || [];
        var tg = tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
        var sel = selectedSkills[sk.id] ? ' selected' : '';
        var chk = selectedSkills[sk.id] ? '&#10003;' : '';
        h += '<div class="sk' + sel + '" data-sid="' + esc(sk.id) + '" data-snm="' + esc(sk.displayName || sk.name) + '">';
        h += '<div class="skt"><button class="sk-toggle" data-tid="' + esc(sk.id) + '">' + chk + '</button>';
        h += '<span class="ski">' + (sk.icon || '&#128230;') + '</span>';
        h += '<span class="skn">' + esc(sk.displayName || sk.name) + '</span>';
        h += '<span class="skc">' + esc(cat) + '</span></div>';
        h += '<div class="skd">' + esc(sk.description || '') + '</div>';
        if (tg) h += '<div class="sktg">' + tg + '</div>';
        h += '</div>';
      }
    }
    c.innerHTML = h;

    updateSkillCount();
  }

  // Clear all selected skills
  var skClear = document.getElementById('skClear');
  if (skClear) skClear.addEventListener('click', function () {
    selectedSkills = {};
    vs.postMessage({ type: 'clearSkills' });
    renderSkills(allSk);
    updateSkillCount();
  });

  // ── Render sessions ────────────────────────────────────────────
  function renderSessions(sessions) {
    var c = document.getElementById('seC');
    if (!c) return;
    if (!sessions || !sessions.length) {
      c.innerHTML = '<div class="nd">No sessions yet.<br>Start a conversation to create one.</div>';
      return;
    }
    var h = '<div class="st">Recent Sessions</div>';
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var d = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '';
      h += '<div class="ssc" data-sid="' + esc(s.id) + '">' +
        '<span class="sst">' + esc(s.title || 'Untitled') + '</span>' +
        '<span class="ssd">' + esc(d) + '</span>' +
        '<button class="ssx" data-did="' + esc(s.id) + '" title="Delete">&#10005;</button></div>';
    }
    c.innerHTML = h;

    c.querySelectorAll('.ssc').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('ssx')) return;
        vs.postMessage({ type: 'switchSession', sessionId: card.getAttribute('data-sid') });
        // Close history overlay
        var hist = document.getElementById('p-sessions');
        if (hist) hist.classList.remove('open');
        var hb = document.getElementById('histBtn');
        if (hb) hb.classList.remove('active');
      });
    });

    c.querySelectorAll('.ssx').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        vs.postMessage({ type: 'deleteSession', sessionId: b.getAttribute('data-did') });
      });
    });
  }

  // ── Copy code blocks ───────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.cpb');
    if (!b) return;
    var el = document.getElementById(b.getAttribute('data-ci'));
    if (el && navigator.clipboard) {
      navigator.clipboard.writeText(el.textContent || '').then(function () {
        b.textContent = 'Copied!';
        setTimeout(function () { b.textContent = 'Copy'; }, 2000);
      });
    }
  });

  // ── Streaming state ─────────────────────────────────────────────
  var streamEl = null;      // current streaming message container
  var streamBody = null;    // streaming body text element
  var streamReason = null;  // streaming reasoning element
  var streamText = '';      // accumulated text for final render
  var reasoningDone = false;

  // ── Messages from extension ────────────────────────────────────
  window.addEventListener('message', function (e) {
    var m = e.data;
    switch (m.type) {
      case 'init':
        cMod = m.model || '';
        cAg = m.agent || 'build';
        updateModelLabel();
        if (agLbl) agLbl.textContent = cAg;
        // Highlight the active agent card
        document.querySelectorAll('.ag-card').forEach(function (c) {
          c.classList.toggle('sel', c.getAttribute('data-ag') === cAg);
        });
        break;
      case 'addMessage':
        renderMsg(m.message);
        isGenerating = false;
        snd.innerHTML = SEND_SVG;
        snd.classList.remove('stop-mode');
        snd.disabled = false;
        break;
      case 'loadHistory':
        Array.from(msgsEl.children).forEach(function (c) { if (c !== esEl) c.remove(); });
        if (m.messages.length > 0 && esEl) esEl.style.display = 'none';
        m.messages.forEach(renderMsg);
        break;
      case 'clearChat':
        Array.from(msgsEl.children).forEach(function (c) { if (c !== esEl) c.remove(); });
        if (esEl) esEl.style.display = 'flex';
        // Close all overlays so user sees the fresh empty chat
        if (rsidebar) rsidebar.classList.remove('open');
        if (settingsBtn) settingsBtn.classList.remove('active');
        if (histPanel) histPanel.classList.remove('open');
        if (histBtn) histBtn.classList.remove('active');
        var titleEl = document.getElementById('topbarTitle');
        if (titleEl) titleEl.textContent = 'CHAT';
        break;
      case 'setLoading':
        if (ldEl) ldEl.classList.toggle('on', m.loading);
        if (!m.loading) {
          isGenerating = false;
          snd.innerHTML = SEND_SVG;
          snd.classList.remove('stop-mode');
          snd.disabled = false;
        }
        if (m.loading) autoScroll();
        break;
      // ── Streaming messages ──
      case 'streamStart':
        // Create the streaming message container
        if (esEl) esEl.style.display = 'none';
        streamEl = document.createElement('div');
        streamEl.className = 'stream-msg';
        streamReason = document.createElement('div');
        streamReason.className = 'stream-reasoning';
        streamBody = document.createElement('div');
        streamBody.className = 'stream-body';
        streamBody.innerHTML = '<span class="stream-cursor"></span>';
        streamEl.appendChild(streamReason);
        streamEl.appendChild(streamBody);
        msgsEl.appendChild(streamEl);
        streamText = '';
        reasoningDone = false;
        userScrolledUp = false;
        autoScroll();
        break;
      case 'streamReasoning':
        if (streamReason) {
          streamReason.textContent += m.content;
          autoScroll();
        }
        break;
      case 'streamToken':
        if (!reasoningDone && streamReason && streamReason.textContent) {
          // Reasoning is done, fade it out
          reasoningDone = true;
          streamReason.style.opacity = '0.4';
          streamReason.style.maxHeight = '40px';
          streamReason.style.transition = 'opacity .5s, max-height .5s';
        }
        streamText += m.content;
        if (streamBody) {
          streamBody.innerHTML = md(streamText) + '<span class="stream-cursor"></span>';
          autoScroll();
        }
        break;
      case 'streamEnd':
        // Remove streaming elements, render final message
        if (streamEl) { streamEl.remove(); streamEl = null; }
        streamBody = null; streamReason = null;
        if (m.message) renderMsg(m.message);
        isGenerating = false;
        snd.innerHTML = SEND_SVG;
        snd.classList.remove('stop-mode');
        snd.disabled = false;
        break;
      case 'modelChanged':
        cMod = m.model;
        updateModelLabel();
        // Highlight model card in Models tab
        document.querySelectorAll('.mc').forEach(function (c) {
          c.classList.toggle('sel', c.getAttribute('data-mid') === m.model);
        });
        // Re-render cloud detail so context/input/output/max-tokens update
        if (lastRegistry) {
          var cpSel = document.getElementById('cpSelect');
          if (cpSel) renderCloudDetail(cpSel.value, lastRegistry.cloud || []);
        }
        break;
      case 'agentChanged':
        cAg = m.agent;
        if (agLbl) agLbl.textContent = m.agent;
        document.querySelectorAll('.ag-card').forEach(function (c) {
          c.classList.toggle('sel', c.getAttribute('data-ag') === m.agent);
        });
        break;
      case 'sessionCreated':
        // clearChat already showed the empty state — nothing else to do here
        break;
      case 'modelsData':
        renderModels(m.registry);
        // Update the toolbar label now that we have registry data
        updateModelLabel();
        break;
      case 'skillsData':
        allSk = m.skills;
        renderSkills(m.skills);
        break;
      case 'selectedSkillsData':
        selectedSkills = {};
        if (m.skillIds && m.skillIds.length) {
          for (var si = 0; si < m.skillIds.length; si++) selectedSkills[m.skillIds[si]] = true;
        }
        renderSkills(allSk);
        updateSkillCount();
        break;
      case 'sessionsData':
        renderSessions(m.sessions);
        break;
      case 'cloudKeySaveError':
        // Re-enable the save button on error
        var errSaveBtn = document.getElementById('clSaveBtn');
        if (errSaveBtn) { errSaveBtn.textContent = 'Save Key'; errSaveBtn.disabled = false; }
        break;
      case 'cloudKeySaved':
        // Key saved — modelsData will arrive from _loadModels() and re-render the detail
        var okSaveBtn = document.getElementById('clSaveBtn');
        if (okSaveBtn) { okSaveBtn.textContent = 'Saved!'; }
        break;
      case 'filesAttached':
        if (m.files) {
          for (var fi = 0; fi < m.files.length; fi++) {
            var af = m.files[fi];
            if (!attachedFiles.some(function (f) { return f.path === af.path; })) {
              attachedFiles.push(af);
            }
          }
          renderAttachBar();
        }
        break;
      case 'attachmentRemoved':
        attachedFiles = attachedFiles.filter(function (f) { return f.path !== m.path; });
        renderAttachBar();
        break;
      case 'diagnosticsData':
        // Show diagnostics in a lightweight panel as chat message
        if (m.diagnostics) {
          var d = m.diagnostics;
          if (diagLbl) diagLbl.textContent = d.errorCount + '';
          if (d.errorCount === 0 && d.warningCount === 0) {
            renderMsg({ role: 'system', content: 'No errors or warnings in workspace.', timestamp: Date.now() });
          } else {
            var txt = d.errorCount + ' error' + (d.errorCount !== 1 ? 's' : '') + ', ' + d.warningCount + ' warning' + (d.warningCount !== 1 ? 's' : '') + ':\n';
            for (var ei = 0; ei < d.entries.length; ei++) {
              var e = d.entries[ei]; 
              txt += '\n' + e.severity.toUpperCase() + ' ' + e.file + ':' + e.line + ' — ' + e.message;
            }
            renderMsg({ role: 'system', content: txt, timestamp: Date.now() });
          }
        }
        break;
      case 'hitlPending':
        renderHitlPending(m.requests || []);
        break;
      case 'hitlStats':
        renderHitlStats(m.stats || {});
        break;
      case 'hitlResolved':
        renderHitlRecent(m.decisions || []);
        break;
      case 'workspaceFiles':
        wsFiles = m.files || [];
        break;
      case 'contextInfo':
        renderContextCompaction(m.summary || [], m.charCount || 0);
        break;
    }
  });

  // ── Context compaction display ─────────────────────────────────
  function renderContextCompaction(summary, charCount) {
    // Show a compact info bar above the streaming message
    if (!summary.length) return;
    var existing = document.querySelector('.ctx-compact');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.className = 'ctx-compact';
    var hdr = document.createElement('div');
    hdr.className = 'ctx-compact-hdr';
    hdr.innerHTML = '<span class="ctx-compact-icon">&#9881;</span>' +
      '<span>Context sent</span>' +
      '<span class="ctx-compact-size">' + Math.round(charCount / 1000) + 'K chars</span>' +
      '<button class="ctx-compact-toggle">&#9660;</button>';
    bar.appendChild(hdr);

    var body = document.createElement('div');
    body.className = 'ctx-compact-body collapsed';
    var items = '';
    for (var i = 0; i < summary.length; i++) {
      items += '<div class="ctx-compact-item">&#8226; ' + esc(summary[i]) + '</div>';
    }
    body.innerHTML = items;
    bar.appendChild(body);

    hdr.addEventListener('click', function () {
      body.classList.toggle('collapsed');
      var btn = hdr.querySelector('.ctx-compact-toggle');
      if (btn) btn.innerHTML = body.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
    });

    msgsEl.appendChild(bar);
    autoScroll();
  }

  // ── HITL panel rendering ─────────────────────────────────────
  function renderHitlPending(requests) {
    var c = document.getElementById('hitlPending');
    if (!c) return;
    // Update badge count
    var badge = document.querySelector('.rs-icon[data-rs="hitl"] .rs-badge');
    if (badge) { badge.textContent = requests.length; badge.style.display = requests.length ? 'flex' : 'none'; }
    if (!requests.length) { c.innerHTML = '<div class="nd">No pending approvals</div>'; return; }
    var h = '';
    for (var i = 0; i < requests.length; i++) {
      var r = requests[i];
      var sev = r.severity || 'medium';
      h += '<div class="hitl-card ' + esc(sev) + '">' +
        '<div class="hitl-action">' + esc(r.action || r.id) + '</div>' +
        '<div class="hitl-detail">' + esc(r.detail || '') + '</div>';
      if (r.reasons && r.reasons.length) {
        h += '<ul class="hitl-reasons">';
        for (var j = 0; j < r.reasons.length; j++) h += '<li>' + esc(r.reasons[j]) + '</li>';
        h += '</ul>';
      }
      h += '<div class="hitl-btns">' +
        '<button class="hitl-btn approve" data-rid="' + esc(r.id) + '">Approve</button>' +
        '<button class="hitl-btn deny" data-rid="' + esc(r.id) + '">Deny</button>' +
        '</div></div>';
    }
    c.innerHTML = h;
    c.querySelectorAll('.hitl-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var rid = b.getAttribute('data-rid');
        var action = b.classList.contains('approve') ? 'approve' : 'deny';
        vs.postMessage({ type: 'hitlResolve', requestId: rid, decision: action });
      });
    });
  }

  function renderHitlStats(stats) {
    var c = document.getElementById('hitlStats');
    if (!c) return;
    c.innerHTML =
      '<div class="hitl-stat"><span class="hitl-stat-lbl">Total evaluated</span><span class="hitl-stat-val">' + (stats.totalEvaluated || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">Approved</span><span class="hitl-stat-val">' + (stats.approved || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">Denied</span><span class="hitl-stat-val">' + (stats.denied || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">Expired</span><span class="hitl-stat-val">' + (stats.expired || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">Pending</span><span class="hitl-stat-val">' + (stats.pending || 0) + '</span></div>';
  }

  function renderHitlRecent(decisions) {
    var c = document.getElementById('hitlRecent');
    if (!c) return;
    if (!decisions.length) { c.innerHTML = '<div class="nd">No recent decisions</div>'; return; }
    var h = '';
    for (var i = 0; i < Math.min(decisions.length, 20); i++) {
      var d = decisions[i];
      var icon = d.decision === 'approved' ? '✓' : '✗';
      var cls = d.decision === 'approved' ? 'low' : 'critical';
      h += '<div class="hitl-card ' + cls + '">' +
        '<div class="hitl-action">' + icon + ' ' + esc(d.action || d.id) + '</div>' +
        '<div class="hitl-detail">' + esc(d.decision) + ' — ' + new Date(d.resolvedAt || d.timestamp || 0).toLocaleString() + '</div>' +
        '</div>';
    }
    c.innerHTML = h;
  }

  // Signal ready to extension
  vs.postMessage({ type: 'ready' });

})();
