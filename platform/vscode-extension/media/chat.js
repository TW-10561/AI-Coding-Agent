// Thirdwave AI — Webview Script
// Runs inside the VS Code webview sandbox
(function () {
  'use strict';

  const vs = acquireVsCodeApi();
  let cMod = '', cAg = 'build', allSk = [];

  // ── Tab switching ──────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.pnl').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      var panel = document.getElementById('p-' + t.getAttribute('data-tab'));
      if (panel) panel.classList.add('active');
    });
  });

  // ── Chat elements ──────────────────────────────────────────────
  var msgsEl = document.getElementById('msgs');
  var esEl = document.getElementById('es');
  var ldEl = document.getElementById('ld');
  var inp = document.getElementById('inp');
  var snd = document.getElementById('snd');
  var aBad = document.getElementById('aBad');
  var mBad = document.getElementById('mBad');
  var agSel = document.getElementById('agSel');
  var mdSel = document.getElementById('mdSel');
  var skQ = document.getElementById('skQ');

  function send() {
    var t = inp.value.trim();
    if (!t) return;
    inp.value = '';
    inp.style.height = '36px';
    snd.disabled = true;
    vs.postMessage({ type: 'sendMessage', text: t });
  }

  snd.addEventListener('click', send);

  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  inp.addEventListener('input', function () {
    inp.style.height = '36px';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  });

  var newBtn = document.getElementById('newBtn');
  if (newBtn) newBtn.addEventListener('click', function () { vs.postMessage({ type: 'newSession' }); });

  var startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'newSession' });
    inp.focus();
  });

  function switchToSettings() {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
    document.querySelectorAll('.pnl').forEach(function (x) { x.classList.remove('active'); });
    var settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab) settingsTab.classList.add('active');
    var settingsPanel = document.getElementById('p-settings');
    if (settingsPanel) settingsPanel.classList.add('active');
  }

  if (aBad) aBad.addEventListener('click', switchToSettings);
  if (mBad) mBad.addEventListener('click', switchToSettings);

  if (agSel) agSel.addEventListener('change', function () {
    vs.postMessage({ type: 'selectAgent', agent: agSel.value });
  });

  if (mdSel) mdSel.addEventListener('change', function () {
    vs.postMessage({ type: 'selectModel', modelId: mdSel.value });
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
        d.innerHTML = '<span class="ti">' + (tc.success ? '&#10003;' : '&#10007;') + '</span>' +
          '<span class="tn">' + esc(tc.tool) + '</span>' +
          '<span class="ts">' + esc(tsum(tc)) + '</span>';
        tEl.appendChild(d);
      }
      el.appendChild(tEl);
    }

    if (m.reasoning) {
      var r = document.createElement('div');
      r.className = 'rsn';
      r.innerHTML = '<div class="rh">&#9671; Reasoning &#9660;</div><div class="rc">' + esc(m.reasoning) + '</div>';
      r.querySelector('.rh').addEventListener('click', function () { r.classList.toggle('exp'); });
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

    if (m.tokens) {
      var tk = document.createElement('div');
      tk.className = 'tkn';
      tk.innerHTML = '<span>&uarr; ' + m.tokens.input + '</span><span>&darr; ' + m.tokens.output + '</span>';
      el.appendChild(tk);
    }

    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // ── Render models ──────────────────────────────────────────────
  function renderModels(reg) {
    var lc = document.getElementById('lcm');
    var cc = document.getElementById('ccm');
    var sel = mdSel;

    while (sel && sel.options.length > 1) sel.remove(1);

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
        if (sel) {
          var o = document.createElement('option');
          o.value = m.id;
          o.textContent = m.name || m.id;
          if (cMod === m.id) o.selected = true;
          sel.appendChild(o);
        }
      }
      lh += '</div></div>';
    }
    if (lc) lc.innerHTML = lh || '<div class="nd">No gateway models available</div>';

    var ch = '';
    var cloud = reg.cloud || [];
    for (var i = 0; i < cloud.length; i++) {
      var p = cloud[i];
      var u = p.configured ? '' : 'unc';
      ch += '<div class="ms ' + u + '"><div class="msh"><span>' + esc(p.name) + '</span>';
      ch += '<span class="bc">' + (p.configured ? '&#10003; configured' : '&#10007; no key') + '</span></div>';
      if (p.configured) {
        ch += '<div class="ml">';
        for (var j = 0; j < p.models.length; j++) {
          var m = p.models[j];
          var s = cMod === m.id ? ' sel' : '';
          ch += '<div class="mc' + s + '" data-mid="' + esc(m.id) + '" data-cp="' + esc(p.id) + '">' +
            '<span class="mi">&#9729;</span><span class="mn">' + esc(m.name || m.id) + '</span>' +
            '<span class="ct">' + esc(p.name) + '</span>' +
            '<span class="mm">$' + m.costIn + '/$' + m.costOut + '</span></div>';
          if (sel) {
            var o = document.createElement('option');
            o.value = m.id;
            o.textContent = p.name + ': ' + (m.name || m.id);
            if (cMod === m.id) o.selected = true;
            sel.appendChild(o);
          }
        }
        ch += '</div>';
      } else {
        ch += '<div class="sd" style="padding:4px 0">Set ' + esc(p.keyEnvVar) + ' in .env to enable</div>';
      }
      ch += '</div>';
    }
    if (cc) cc.innerHTML = ch || '<div class="nd">No cloud providers configured</div>';

    document.querySelectorAll('.mc').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('.mc').forEach(function (x) { x.classList.remove('sel'); });
        c.classList.add('sel');
        vs.postMessage({ type: 'selectModel', modelId: c.getAttribute('data-mid') });
      });
    });
  }

  // ── Render skills ──────────────────────────────────────────────
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
        h += '<div class="sk" data-sid="' + esc(sk.id) + '" data-snm="' + esc(sk.displayName || sk.name) + '">';
        h += '<div class="skt"><span class="ski">' + (sk.icon || '&#128230;') + '</span>';
        h += '<span class="skn">' + esc(sk.displayName || sk.name) + '</span>';
        h += '<span class="skc">' + esc(cat) + '</span></div>';
        h += '<div class="skd">' + esc(sk.description || '') + '</div>';
        if (tg) h += '<div class="sktg">' + tg + '</div>';
        h += '</div>';
      }
    }
    c.innerHTML = h;
    c.querySelectorAll('.sk').forEach(function (k) {
      k.addEventListener('click', function () {
        vs.postMessage({ type: 'viewSkill', skillId: k.getAttribute('data-sid'), skillName: k.getAttribute('data-snm') });
      });
    });
  }

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
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.pnl').forEach(function (p) { p.classList.remove('active'); });
        var chatTab = document.querySelector('[data-tab="chat"]');
        if (chatTab) chatTab.classList.add('active');
        var chatPanel = document.getElementById('p-chat');
        if (chatPanel) chatPanel.classList.add('active');
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

  // ── Messages from extension ────────────────────────────────────
  window.addEventListener('message', function (e) {
    var m = e.data;
    switch (m.type) {
      case 'init':
        cMod = m.model || '';
        cAg = m.agent || 'build';
        if (mBad) mBad.textContent = cMod || 'auto';
        if (aBad) aBad.textContent = cAg;
        if (agSel) agSel.value = cAg;
        break;
      case 'addMessage':
        renderMsg(m.message);
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
        break;
      case 'setLoading':
        if (ldEl) ldEl.classList.toggle('on', m.loading);
        snd.disabled = m.loading;
        if (m.loading) msgsEl.scrollTop = msgsEl.scrollHeight;
        break;
      case 'modelChanged':
        cMod = m.model;
        if (mBad) mBad.textContent = m.model || 'auto';
        break;
      case 'agentChanged':
        cAg = m.agent;
        if (aBad) aBad.textContent = m.agent;
        if (agSel) agSel.value = m.agent;
        break;
      case 'sessionCreated':
        if (esEl) esEl.style.display = 'none';
        break;
      case 'modelsData':
        renderModels(m.registry);
        break;
      case 'skillsData':
        allSk = m.skills;
        renderSkills(m.skills);
        break;
      case 'sessionsData':
        renderSessions(m.sessions);
        break;
    }
  });

  // Signal ready to extension
  vs.postMessage({ type: 'ready' });

})();
