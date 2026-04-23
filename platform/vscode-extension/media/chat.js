// Thirdwave AI — Webview Script
// Runs inside the VS Code webview sandbox
(function () {
  'use strict';

  const vs = acquireVsCodeApi();
  let cMod = '', cAg = 'build', allSk = [];
  var selectedSkills = {}; // { skillId: true }
  var lastRegistry = null; // cached registry data for dropdowns

  // ── i18n — Internationalisation ────────────────────────────────
  var i18nStrings = {
    en: {
      chat: 'CHAT', settings: 'SETTINGS', history: 'HISTORY', agents: 'AGENTS', skills: 'SKILLS', appearance: 'APPEARANCE', hitl: 'APPROVALS', account: 'ACCOUNT',
      theme: 'Theme', language: 'Language',
      gatewayModels: 'Gateway Models (Local)', cloudProviders: 'Cloud Providers',
      primaryAgents: 'Primary Agents', subAgents: 'Sub-Agents',
      skillsRegistry: 'SKILLS REGISTRY', clearAll: 'Clear all',
      filterSkills: 'Filter skills...', inputPlaceholder: 'Type your task here...',
      thinking: 'Thinking...', analyzing: 'Analyzing...', processing: 'Processing...', working: 'Working',
      emptyDesc: 'AI coding assistant powered by local vLLM gateway.',
      startConversation: 'Start a conversation',
      pendingApprovals: 'Pending Approvals', statistics: 'Statistics',
      recentDecisions: 'Recent Decisions',
      agBuildDesc: 'Full read/write/execute \u2014 default coding agent with tool calling',
      agPlanDesc: 'Read-only planning and architectural analysis',
      agExploreDesc: 'Codebase search and exploration \u2014 read-only discovery',
      agGeneralDesc: 'Multi-step reasoning, research, and general tasks',
      copy: 'Copy', copied: 'Copied!', retry: 'Retry',
      savingKey: 'Saving...', saveKey: 'Save Key', savedKey: 'Saved!',
      noPending: 'No pending approvals', noRecent: 'No recent decisions',
      loadingSessions: 'Loading sessions...', loadingSkills: 'Loading skills...',
      loading: 'Loading...', selectProvider: 'Select a provider above',
      enterApiKey: 'Enter API Key...',
      apiProvider: 'API Provider', apiKey: 'API Key',
      getApiKey: 'Get {0} API Key', updateKey: 'Update Key',
      apiKeyNote: 'This key is stored on the server and used to make API requests through the platform.',
      apiKeyConfigured: 'API key configured',
      model: 'Model', configureKeyFirst: 'Configure API key first',
      context: 'Context', input: 'Input', output: 'Output',
      maxOutput: 'Max output', tokens: 'tokens',
      noGatewayModels: 'No gateway models available',
      models: 'model', modelsPlural: 'models',
      approve: 'Approve', deny: 'Deny',
      approvalRequired: 'Approval Required',
      waitingForApproval: '⏳ Waiting for approval...',
      totalEvaluated: 'Total evaluated', approved: 'Approved',
      denied: 'Denied', expired: 'Expired', pending: 'Pending',
      recentSessions: 'Recent Sessions', noSessions: 'No sessions yet.\nStart a conversation to create one.',
      contextSent: 'Context sent', chars: 'chars',
      stopGeneration: 'Stop generation', sendMessage: 'Send message',
      noSkills: 'No skills available.\nSkills appear once the platform loads them.',
      noErrors: 'No errors or warnings in workspace.',
      newChat: 'New chat', user: 'user', assistant: 'assistant', system: 'system',
      reasoning: 'Thinking',
      wroteFile: 'wrote', wroteFileDefault: 'wrote file',
      readFile: 'read', readFileDefault: 'read file',
      ranCommand: 'ran command', searched: 'searched:',
      tcCompleted: 'completed', tcFailed: 'failed',
      untitled: 'Untitled', deleteSession: 'Delete',
      modelConfig: 'MODEL CONFIGURATION', contextWindow: 'Context Window Size',
      maxOutputTokens: 'Max Output Tokens', inputPrice: 'Input Price / 1M tokens',
      outputPrice: 'Output Price / 1M tokens', temperature: 'Temperature',
      supportsImages: 'Supports Images', modelId: 'Model ID',
      apiKeyMasked: 'API key is set', editKey: 'Edit Key',
      gatewayLocal: 'LOCAL (GPU)', gatewayCloud: 'CLOUD (GATEWAY)',
      local: 'local', cloud: 'cloud', free: 'free', paid: 'paid',
      error: 'Error', agentSideConfig: 'AGENT SIDE MODEL CONFIGURATIONS',
      openaiCompatible: 'OpenAI Compatible', baseUrl: 'Base URL',
      modelIdLabel: 'Model ID', saveConfig: 'Save', savedConfig: 'Saved!',
      enterBaseUrl: 'http://localhost:11434/v1', enterModelId: 'Enter model ID...',
      customHeaders: 'Custom Headers (optional)', testConnection: 'Test',
      connectionOk: 'Connected!', connectionFail: 'Connection failed',
      enableR1Format: 'Enable R1 messages format',
      displayName: 'Display Name', saveName: 'Save Name', yourName: 'Your name',
      infraVllmApiKey: 'Infra vLLM API Key', activeKey: 'Active Key', signOut: 'Sign Out',
      keyVerifiedActive: '\u2713 Key Verified & Active',
      pendingAdminVerify: '\u23F3 Pending Admin Verification',
      rotateChangeKey: 'Rotate / Change Key', enterDifferentKey: 'Enter Different Key',
      saveNewKey: 'Save New Key', saved: 'Saved', key: 'Key'
    },
    ja: {
      chat: '\u30C1\u30E3\u30C3\u30C8', settings: '\u8A2D\u5B9A', history: '\u5C65\u6B74', agents: '\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8', skills: '\u30B9\u30AD\u30EB', appearance: '\u5916\u89B3', hitl: '\u627F\u8A8D', account: '\u30A2\u30AB\u30A6\u30F3\u30C8',
      theme: '\u30C6\u30FC\u30DE', language: '\u8A00\u8A9E',
      gatewayModels: '\u30B2\u30FC\u30C8\u30A6\u30A7\u30A4\u30E2\u30C7\u30EB (\u30ED\u30FC\u30AB\u30EB)', cloudProviders: '\u30AF\u30E9\u30A6\u30C9\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC',
      primaryAgents: '\u30E1\u30A4\u30F3\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8', subAgents: '\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8',
      skillsRegistry: '\u30B9\u30AD\u30EB\u30EC\u30B8\u30B9\u30C8\u30EA', clearAll: '\u3059\u3079\u3066\u30AF\u30EA\u30A2',
      filterSkills: '\u30B9\u30AD\u30EB\u3092\u691C\u7D22...', inputPlaceholder: '\u30BF\u30B9\u30AF\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044...',
      thinking: '\u601D\u8003\u4E2D...', analyzing: '\u5206\u6790\u4E2D...', processing: '\u51E6\u7406\u4E2D...', working: '\u4F5C\u696D\u4E2D',
      emptyDesc: '\u30ED\u30FC\u30AB\u30EB vLLM \u30B2\u30FC\u30C8\u30A6\u30A7\u30A4\u3067\u99C6\u52D5\u3059\u308B AI \u30B3\u30FC\u30C7\u30A3\u30F3\u30B0\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u3002',
      startConversation: '\u4F1A\u8A71\u3092\u59CB\u3081\u308B',
      pendingApprovals: '\u627F\u8A8D\u5F85\u3061', statistics: '\u7D71\u8A08',
      recentDecisions: '\u6700\u8FD1\u306E\u6C7A\u5B9A',
      agBuildDesc: '\u8AAD\u307F\u66F8\u304D\u5B9F\u884C \u2014 \u30C4\u30FC\u30EB\u547C\u3073\u51FA\u3057\u4ED8\u304D\u30C7\u30D5\u30A9\u30EB\u30C8\u30B3\u30FC\u30C7\u30A3\u30F3\u30B0\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8',
      agPlanDesc: '\u8AAD\u307F\u53D6\u308A\u5C02\u7528\u306E\u8A08\u753B\u3068\u30A2\u30FC\u30AD\u30C6\u30AF\u30C1\u30E3\u5206\u6790',
      agExploreDesc: '\u30B3\u30FC\u30C9\u30D9\u30FC\u30B9\u306E\u691C\u7D22\u3068\u63A2\u7D22 \u2014 \u8AAD\u307F\u53D6\u308A\u5C02\u7528',
      agGeneralDesc: '\u30DE\u30EB\u30C1\u30B9\u30C6\u30C3\u30D7\u63A8\u8AD6\u3001\u30EA\u30B5\u30FC\u30C1\u3001\u4E00\u822C\u30BF\u30B9\u30AF',
      copy: '\u30B3\u30D4\u30FC', copied: '\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01', retry: '\u518D\u8A66\u884C',
      savingKey: '\u4FDD\u5B58\u4E2D...', saveKey: '\u30AD\u30FC\u3092\u4FDD\u5B58', savedKey: '\u4FDD\u5B58\u3057\u307E\u3057\u305F\uFF01',
      noPending: '\u627F\u8A8D\u5F85\u3061\u306A\u3057', noRecent: '\u6700\u8FD1\u306E\u6C7A\u5B9A\u306A\u3057',
      loadingSessions: '\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D...', loadingSkills: '\u30B9\u30AD\u30EB\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D...',
      loading: '\u8AAD\u307F\u8FBC\u307F\u4E2D...', selectProvider: '\u4E0A\u306E\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC\u3092\u9078\u629E',
      enterApiKey: 'API\u30AD\u30FC\u3092\u5165\u529B...',
      apiProvider: 'API\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC', apiKey: 'API\u30AD\u30FC',
      getApiKey: '{0}\u306EAPI\u30AD\u30FC\u3092\u53D6\u5F97', updateKey: '\u30AD\u30FC\u3092\u66F4\u65B0',
      apiKeyNote: '\u3053\u306E\u30AD\u30FC\u306F\u30B5\u30FC\u30D0\u30FC\u306B\u4FDD\u5B58\u3055\u308C\u3001\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u7D4C\u7531\u3067API\u30EA\u30AF\u30A8\u30B9\u30C8\u306B\u4F7F\u7528\u3055\u308C\u307E\u3059\u3002',
      apiKeyConfigured: 'API\u30AD\u30FC\u8A2D\u5B9A\u6E08\u307F',
      model: '\u30E2\u30C7\u30EB', configureKeyFirst: '\u5148\u306BAPI\u30AD\u30FC\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044',
      context: '\u30B3\u30F3\u30C6\u30AD\u30B9\u30C8', input: '\u5165\u529B', output: '\u51FA\u529B',
      maxOutput: '\u6700\u5927\u51FA\u529B', tokens: '\u30C8\u30FC\u30AF\u30F3',
      noGatewayModels: '\u30B2\u30FC\u30C8\u30A6\u30A7\u30A4\u30E2\u30C7\u30EB\u306A\u3057',
      models: '\u30E2\u30C7\u30EB', modelsPlural: '\u30E2\u30C7\u30EB',
      approve: '\u627F\u8A8D', deny: '\u62D2\u5426',
      approvalRequired: '\u627F\u8A8D\u304C\u5FC5\u8981',
      waitingForApproval: '\u2318 \u627F\u8A8D\u5F85\u3061...',
      totalEvaluated: '\u5408\u8A08\u8A55\u4FA1\u6570', approved: '\u627F\u8A8D\u6E08\u307F',
      denied: '\u62D2\u5426\u6E08\u307F', expired: '\u671F\u9650\u5207\u308C', pending: '\u4FDD\u7559\u4E2D',
      recentSessions: '\u6700\u8FD1\u306E\u30BB\u30C3\u30B7\u30E7\u30F3', noSessions: '\u30BB\u30C3\u30B7\u30E7\u30F3\u306A\u3057\u3002\n\u4F1A\u8A71\u3092\u59CB\u3081\u3066\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
      contextSent: '\u30B3\u30F3\u30C6\u30AD\u30B9\u30C8\u9001\u4FE1', chars: '\u6587\u5B57',
      stopGeneration: '\u751F\u6210\u3092\u505C\u6B62', sendMessage: '\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u9001\u4FE1',
      noSkills: '\u30B9\u30AD\u30EB\u304C\u3042\u308A\u307E\u305B\u3093\u3002\n\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u304C\u8AAD\u307F\u8FBC\u3080\u3068\u8868\u793A\u3055\u308C\u307E\u3059\u3002',
      noErrors: '\u30EF\u30FC\u30AF\u30B9\u30DA\u30FC\u30B9\u306B\u30A8\u30E9\u30FC\u3084\u8B66\u544A\u306F\u3042\u308A\u307E\u305B\u3093\u3002',
      newChat: '\u65B0\u3057\u3044\u30C1\u30E3\u30C3\u30C8', user: '\u30E6\u30FC\u30B6\u30FC', assistant: '\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8', system: '\u30B7\u30B9\u30C6\u30E0',
      reasoning: '\u601D\u8003',
      wroteFile: '\u66F8\u304D\u8FBC\u307F', wroteFileDefault: '\u30D5\u30A1\u30A4\u30EB\u66F8\u304D\u8FBC\u307F',
      readFile: '\u8AAD\u307F\u53D6\u308A', readFileDefault: '\u30D5\u30A1\u30A4\u30EB\u8AAD\u307F\u53D6\u308A',
      ranCommand: '\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C', searched: '\u691C\u7D22:',
      tcCompleted: '\u5B8C\u4E86', tcFailed: '\u5931\u6557',
      untitled: '\u7121\u984C', deleteSession: '\u524A\u9664',
      modelConfig: '\u30E2\u30C7\u30EB\u8A2D\u5B9A', contextWindow: '\u30B3\u30F3\u30C6\u30AD\u30B9\u30C8\u30A6\u30A3\u30F3\u30C9\u30A6\u30B5\u30A4\u30BA',
      maxOutputTokens: '\u6700\u5927\u51FA\u529B\u30C8\u30FC\u30AF\u30F3', inputPrice: '\u5165\u529B\u4FA1\u683C / 1M\u30C8\u30FC\u30AF\u30F3',
      outputPrice: '\u51FA\u529B\u4FA1\u683C / 1M\u30C8\u30FC\u30AF\u30F3', temperature: '\u6E29\u5EA6',
      supportsImages: '\u753B\u50CF\u30B5\u30DD\u30FC\u30C8', modelId: '\u30E2\u30C7\u30EBID',
      apiKeyMasked: 'API\u30AD\u30FC\u8A2D\u5B9A\u6E08\u307F', editKey: '\u30AD\u30FC\u3092\u7DE8\u96C6',
      gatewayLocal: '\u30ED\u30FC\u30AB\u30EB (GPU)', gatewayCloud: '\u30AF\u30E9\u30A6\u30C9 (\u30B2\u30FC\u30C8\u30A6\u30A7\u30A4)',
      local: '\u30ED\u30FC\u30AB\u30EB', cloud: '\u30AF\u30E9\u30A6\u30C9', free: '\u7121\u6599', paid: '\u6709\u6599',
      error: '\u30A8\u30E9\u30FC', agentSideConfig: '\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u5074\u30E2\u30C7\u30EB\u8A2D\u5B9A',
      openaiCompatible: 'OpenAI\u4E92\u63DB', baseUrl: '\u30D9\u30FC\u30B9URL',
      modelIdLabel: '\u30E2\u30C7\u30EBID', saveConfig: '\u4FDD\u5B58', savedConfig: '\u4FDD\u5B58\u3057\u307E\u3057\u305F\uFF01',
      enterBaseUrl: 'http://localhost:11434/v1', enterModelId: '\u30E2\u30C7\u30EBID\u3092\u5165\u529B...',
      customHeaders: '\u30AB\u30B9\u30BF\u30E0\u30D8\u30C3\u30C0\u30FC (\u4EFB\u610F)', testConnection: '\u30C6\u30B9\u30C8',
      enableR1Format: 'R1\u30E1\u30C3\u30BB\u30FC\u30B8\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u3092\u6709\u52B9\u5316',
      connectionOk: '\u63A5\u7D9A\u6210\u529F\uFF01', connectionFail: '\u63A5\u7D9A\u5931\u6557',
      displayName: '\u8868\u793A\u540D', saveName: '\u540D\u524D\u3092\u4FDD\u5B58',
      yourName: '\u304A\u540D\u524D',
      infraVllmApiKey: 'vLLM API\u30AD\u30FC',
      activeKey: '\u30A2\u30AF\u30C6\u30A3\u30D6\u30AD\u30FC',
      signOut: '\u30B5\u30A4\u30F3\u30A2\u30A6\u30C8',
      keyVerifiedActive: '\u2713 \u30AD\u30FC\u8A8D\u8A3C\u6E08\u307F\u30FB\u6709\u52B9',
      pendingAdminVerify: '\u23F3 \u7BA1\u7406\u8005\u306E\u8A8D\u8A3C\u5F85\u3061',
      rotateChangeKey: '\u30AD\u30FC\u3092\u5909\u66F4\u30FB\u30ED\u30FC\u30C6\u30FC\u30B7\u30E7\u30F3',
      enterDifferentKey: '\u5225\u306E\u30AD\u30FC\u3092\u5165\u529B',
      saveNewKey: '\u65B0\u3057\u3044\u30AD\u30FC\u3092\u4FDD\u5B58',
      saved: '\u4FDD\u5B58\u6E08\u307F', key: '\u30AD\u30FC'
    }
  };
  var currentLang = localStorage.getItem('tw-lang') || 'en';

  function t(key) {
    var strings = i18nStrings[currentLang] || i18nStrings.en;
    return strings[key] || i18nStrings.en[key] || key;
  }

  function applyI18n() {
    // Translate all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    // Translate all elements with data-i18n-placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    // Update topbar title based on current panel state
    var titleEl = document.getElementById('topbarTitle');
    if (titleEl) {
      var cur = titleEl.textContent;
      var panelKeys = ['chat', 'settings', 'history', 'agents', 'skills', 'appearance', 'hitl', 'account'];
      for (var pi = 0; pi < panelKeys.length; pi++) {
        var pk = panelKeys[pi];
        var matched = false;
        var langs = Object.keys(i18nStrings);
        for (var li = 0; li < langs.length; li++) {
          if (i18nStrings[langs[li]][pk] && cur === i18nStrings[langs[li]][pk]) { matched = true; break; }
        }
        if (matched) { titleEl.textContent = t(pk); break; }
      }
    }
  }

  // Apply saved language on load
  applyI18n();

  // ── Top bar: Settings toggle (right sidebar) ───────────────────
  var settingsBtn = document.getElementById('settingsBtn');
  var rsidebar = document.getElementById('rsidebar');
  if (settingsBtn && rsidebar) {
    settingsBtn.addEventListener('click', function () {
      var isOpen = rsidebar.classList.toggle('open');
      settingsBtn.classList.toggle('active', isOpen);
      // Close any open dropdowns when sidebar opens
      document.querySelectorAll('.it-dropdown').forEach(function(d) { d.remove(); });
      // Close history overlay when opening settings
      var hist = document.getElementById('p-sessions');
      if (hist) hist.classList.remove('open');
      var histBtn = document.getElementById('histBtn');
      if (histBtn) histBtn.classList.remove('active');
      // Ensure a panel is visible when opening — default to settings
      if (isOpen) {
        var anyActive = document.querySelector('.rs-pnl.active');
        if (!anyActive) {
          var defPnl = document.getElementById('rp-settings');
          var defIcon = document.querySelector('.rs-icon[data-rs="settings"]');
          if (defPnl) defPnl.classList.add('active');
          if (defIcon) defIcon.classList.add('active');
        }
      } else {
        // When closing, clear all panel active states
        document.querySelectorAll('.rs-pnl').forEach(function (p) { p.classList.remove('active'); });
        document.querySelectorAll('.rs-icon').forEach(function (i) { i.classList.remove('active'); });
      }
      // Update topbar title
      var titleEl = document.getElementById('topbarTitle');
      if (isOpen) {
        var activeIcon = document.querySelector('.rs-icon.active');
        var activePanelName = activeIcon ? activeIcon.getAttribute('data-rs') : 'settings';
        if (titleEl) titleEl.textContent = t(activePanelName);
      } else {
        if (titleEl) titleEl.textContent = t('chat');
      }
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
      if (titleEl) titleEl.textContent = isOpen ? t('history') : t('chat');
    });
  }

  // ── History panel close button ─────────────────────────────────
  document.querySelectorAll('.pnl-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var overlay = btn.closest('.pnl-overlay');
      if (overlay) overlay.classList.remove('open');
      if (histBtn) histBtn.classList.remove('active');
      var titleEl = document.getElementById('topbarTitle');
      if (titleEl) titleEl.textContent = t('chat');
    });
  });

  // ── Right sidebar icon switching ───────────────────────────────
  document.querySelectorAll('.rs-icon').forEach(function (icon) {
    icon.addEventListener('click', function () {
      document.querySelectorAll('.rs-icon').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.rs-pnl').forEach(function (x) { x.classList.remove('active'); });
      icon.classList.add('active');
      var panelName = icon.getAttribute('data-rs');
      var pnl = document.getElementById('rp-' + panelName);
      if (pnl) pnl.classList.add('active');
      // Update topbar title to the name of the panel now visible
      var titleEl = document.getElementById('topbarTitle');
      if (titleEl) titleEl.textContent = t(panelName);
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
  var compactBtn = document.getElementById('compactBtn');
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
    snd.title = 'Stop generation';
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
    snd.title = 'Send message';
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

  // ── Compact button (bottom toolbar) ───────────────────────────
  if (compactBtn) compactBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'compactConversation' });
    compactBtn.querySelector('.it-lbl').textContent = 'Compacting...';
    compactBtn.disabled = true;
    setTimeout(function () {
      compactBtn.querySelector('.it-lbl').textContent = 'Compact';
      compactBtn.disabled = false;
    }, 5000);
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

  // ── Theme utilities ─────────────────────────────────────────────
  var allThemeClasses = ['theme-vscode-light', 'theme-electric', 'theme-electric-light', 'theme-monokai', 'theme-dracula', 'theme-nord', 'theme-solarized', 'theme-github-dark'];

  function removeThemeClasses() {
    allThemeClasses.forEach(function (c) { document.body.classList.remove(c); });
  }

  function isVSCodeLight() {
    // Check VS Code's theme-kind attribute (set on body or html)
    var kind = document.body.getAttribute('data-vscode-theme-kind')
            || document.documentElement.getAttribute('data-vscode-theme-kind')
            || '';
    if (kind === 'vscode-light' || kind === 'vscode-high-contrast-light') return true;
    if (kind) return false;
    // Fallback: check body background luminance
    var bg = getComputedStyle(document.body).backgroundColor || '';
    var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    var luminance = (0.299 * parseInt(m[1]) + 0.587 * parseInt(m[2]) + 0.114 * parseInt(m[3])) / 255;
    return luminance > 0.5;
  }

  function applyAutoTheme() {
    var saved = localStorage.getItem('tw-theme') || '';
    if (saved) return; // User has an explicit override — don't auto-detect
    removeThemeClasses();
    if (isVSCodeLight()) {
      document.body.classList.add('theme-vscode-light');
    }
  }

  // ── Theme picker ───────────────────────────────────────────────
  var themePicker = document.getElementById('themePicker');
  if (themePicker) {
    // Restore saved theme (migrate removed themes)
    var savedTheme = localStorage.getItem('tw-theme') || '';
    if (savedTheme === 'night') { savedTheme = ''; localStorage.setItem('tw-theme', ''); }
    if (savedTheme) {
      removeThemeClasses();
      document.body.classList.add('theme-' + savedTheme);
      themePicker.querySelectorAll('.theme-btn').forEach(function (b) {
        b.classList.toggle('sel', b.getAttribute('data-theme') === savedTheme);
      });
    } else {
      // Default "VS Code" theme — auto-detect light/dark
      applyAutoTheme();
    }
    themePicker.addEventListener('click', function (e) {
      var btn = e.target.closest('.theme-btn');
      if (!btn) return;
      var theme = btn.getAttribute('data-theme');
      // Remove all custom theme classes
      removeThemeClasses();
      if (theme) {
        document.body.classList.add('theme-' + theme);
      } else {
        // Default "VS Code" — auto-detect
        applyAutoTheme();
      }
      // Highlight selected button
      themePicker.querySelectorAll('.theme-btn').forEach(function (b) { b.classList.remove('sel'); });
      btn.classList.add('sel');
      // Persist
      localStorage.setItem('tw-theme', theme || '');
    });
  }

  // Watch for VS Code theme changes (e.g. user switches theme via command palette)
  var themeObserver = new MutationObserver(function () { applyAutoTheme(); });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-vscode-theme-kind'] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-vscode-theme-kind'] });

  // ── Language picker ────────────────────────────────────────────
  var langPicker = document.getElementById('langPicker');
  if (langPicker) {
    // Restore saved language
    var savedLang = localStorage.getItem('tw-lang') || 'en';
    langPicker.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('sel', b.getAttribute('data-lang') === savedLang);
    });
    langPicker.addEventListener('click', function (e) {
      var btn = e.target.closest('.lang-btn');
      if (!btn) return;
      var lang = btn.getAttribute('data-lang');
      currentLang = lang;
      langPicker.querySelectorAll('.lang-btn').forEach(function (b) { b.classList.remove('sel'); });
      btn.classList.add('sel');
      localStorage.setItem('tw-lang', lang);
      applyI18n();
      // Re-render all dynamic content in the new language
      if (lastRegistry) renderModels(lastRegistry);
      if (allSk.length) renderSkills(allSk);
      vs.postMessage({ type: 'refreshSessions' });
      // Notify extension about language change so system prompt uses the same language
      vs.postMessage({ type: 'setLanguage', language: lang });
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
    if (titleEl) titleEl.textContent = t('chat');
    vs.postMessage({ type: 'newSession' });
  });

  var startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'newSession' });
    inp.focus();
  });

  var refreshModelsBtn = document.getElementById('refreshModelsBtn');
  if (refreshModelsBtn) refreshModelsBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'refreshModels' });
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
        if (item.isHeader) {
          opt.className = 'it-dd-header';
          opt.textContent = item.label;
        } else {
          opt.className = 'it-dd-item' + (item.active ? ' active' : '');
          opt.textContent = item.label;
          opt.addEventListener('click', function (e) {
            e.stopPropagation();
            closeDropdown();
            onSelect(item.value);
          });
        }
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
      var hasLocal = false;
      var hasCloudGw = false;
      // Collect local GPU and cloud (gateway) models separately — deduplicate by model id
      var localItems = [];
      var cloudGwItems = [];
      var seenModelIds = {};
      for (var i = 0; i < local.length; i++) {
        if (local[i].status !== 'online') continue;
        for (var j = 0; j < local[i].models.length; j++) {
          var m = local[i].models[j];
          if (seenModelIds[m.id]) continue;
          seenModelIds[m.id] = true;
          if (m.isCloud) {
            cloudGwItems.push({ label: m.name || m.id, value: m.id, active: cMod === m.id });
          } else {
            localItems.push({ label: m.name || m.id, value: m.id, active: cMod === m.id });
          }
        }
      }
      // Add grouped items with headers
      if (localItems.length > 0) {
        items.push({ label: '\u2500\u2500 ' + t('gatewayLocal') + ' \u2500\u2500', value: '', active: false, isHeader: true });
        items = items.concat(localItems);
      }
      if (cloudGwItems.length > 0) {
        items.push({ label: '\u2500\u2500 ' + t('gatewayCloud') + ' \u2500\u2500', value: '', active: false, isHeader: true });
        items = items.concat(cloudGwItems);
      }
      // Agent's own cloud providers
      var cloud = lastRegistry.cloud || [];
      var cloudAgentItems = [];
      for (var i = 0; i < cloud.length; i++) {
        if (!cloud[i].configured) continue;
        for (var j = 0; j < cloud[i].models.length; j++) {
          var m = cloud[i].models[j];
          if (seenModelIds[m.id]) continue;
          seenModelIds[m.id] = true;
          cloudAgentItems.push({ label: m.name || m.id, value: m.id, active: cMod === m.id });
        }
      }
      if (cloudAgentItems.length > 0) {
        items.push({ label: '\u2500\u2500 ' + t('agentSideConfig') + ' \u2500\u2500', value: '', active: false, isHeader: true });
        items = items.concat(cloudAgentItems);
      }
    } else {
      vs.postMessage({ type: 'refreshModels' });
    }
    // Only show fallback for cMod if it belongs to an online provider
    if (cMod && !items.some(function(it) { return it.value === cMod; })) {
      var modelIsOnline = false;
      if (lastRegistry) {
        var lr = lastRegistry.local || [];
        for (var ii = 0; ii < lr.length; ii++) {
          if (lr[ii].status !== 'online') continue;
          for (var jj = 0; jj < lr[ii].models.length; jj++) {
            if (lr[ii].models[jj].id === cMod) { modelIsOnline = true; break; }
          }
          if (modelIsOnline) break;
        }
        if (!modelIsOnline) {
          var cr = lastRegistry.cloud || [];
          for (var ii = 0; ii < cr.length; ii++) {
            if (!cr[ii].configured) continue;
            for (var jj = 0; jj < cr[ii].models.length; jj++) {
              if (cr[ii].models[jj].id === cMod) { modelIsOnline = true; break; }
            }
            if (modelIsOnline) break;
          }
        }
      }
      if (modelIsOnline) {
        items.unshift({ label: resolveModelName(cMod), value: cMod, active: true });
      }
    }
    if (items.length === 0) items.push({ label: t('noGatewayModels'), value: '', active: false });
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

  var _codeBlockSeq = 0;
  function md(t) {
    var h = esc(t);
    // code blocks
    h = h.replace(/```(\w*?)\n([\s\S]*?)```/g, function (_, l, c) {
      var id = 'cb' + (_codeBlockSeq++);
      var trimmed = c.replace(/^\n+/, '').replace(/\n+$/, '');
      return '<div class="cbw">' + (l ? '<span class="cl">' + l + '</span>' : '') +
        '<button class="cpb">Copy</button>' +
        '<pre><code id="' + id + '">' + trimmed + '</code></pre></div>';
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
      return p ? t('wroteFile') + ' ' + p.split('/').pop() : t('wroteFileDefault');
    }
    if (n === 'read_file') {
      var p = a.path || a.filePath || '';
      return p ? t('readFile') + ' ' + p.split('/').pop() : t('readFileDefault');
    }
    if (n === 'run_command' || n === 'execute' || n === 'bash') {
      var c = a.command || a.cmd || '';
      return c ? c.substring(0, 40) + (c.length > 40 ? '...' : '') : t('ranCommand');
    }
    if (n === 'search' || n === 'grep') {
      return t('searched') + ' ' + (a.query || a.pattern || '').substring(0, 30);
    }
    return tc.success ? t('tcCompleted') : t('tcFailed');
  }

  // ── Render message ─────────────────────────────────────────────
  function renderMsg(m) {
    if (esEl) esEl.style.display = 'none';
    var el = document.createElement('div');
    el.className = 'msg ' + m.role;

    var hdr = document.createElement('div');
    hdr.className = 'mh ' + m.role;
    hdr.innerHTML = '<span class="d"></span><span>' + t(m.role) + '</span>';
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
      r.innerHTML = '<div class="rh"><span>&#9671; ' + t('thinking').replace('...', '') + '</span><span class="rh-chevron">&#9660;</span></div><div class="rc">' + esc(m.reasoning) + '</div>';
      el.appendChild(r);
    }

    var body = document.createElement('div');
    body.className = 'mb';
    if (m.role === 'system' && m.content && m.content.indexOf('Error:') === 0) {
      var errContent = m.content.substring(6).trim();
      // Detect structured error types for styled rendering
      if (/^⚠️ Model Access Denied/.test(errContent)) {
        body.className = 'mb error-box error-access-denied';
        body.innerHTML = '<div class="error-icon">⚠️</div><div class="error-body"><strong>' + esc(errContent.replace(/^⚠️\s*/, '').split('—')[0].trim()) + '</strong><br>' + esc(errContent.split('—').slice(1).join('—').trim()) + '</div>';
      } else if (/^🛡️ Request Blocked/.test(errContent)) {
        body.className = 'mb error-box error-policy';
        body.innerHTML = '<div class="error-icon">🛡️</div><div class="error-body"><strong>' + esc(errContent.replace(/^🛡️\s*/, '').split('—')[0].trim()) + '</strong><br>' + esc(errContent.split('—').slice(1).join('—').trim()) + '</div>';
      } else if (/^⏳ Rate Limited/.test(errContent)) {
        body.className = 'mb error-box error-ratelimit';
        body.innerHTML = '<div class="error-icon">⏳</div><div class="error-body"><strong>' + esc(errContent.replace(/^⏳\s*/, '').split('—')[0].trim()) + '</strong><br>' + esc(errContent.split('—').slice(1).join('—').trim()) + '</div>';
      } else if (/^🔌 (Connection Failed|Service Unavailable)/.test(errContent)) {
        body.className = 'mb error-box error-connection';
        body.innerHTML = '<div class="error-icon">🔌</div><div class="error-body"><strong>' + esc(errContent.replace(/^🔌\s*/, '').split('—')[0].trim()) + '</strong><br>' + esc(errContent.split('—').slice(1).join('—').trim()) + '</div>';
      } else {
        // Generic error — localize prefix
        body.textContent = t('error') + ': ' + errContent;
      }
    } else if (m.role === 'user' || m.role === 'system') {
      body.textContent = m.content;
    } else {
      body.innerHTML = md(m.content);
    }
    el.appendChild(body);

    // Retry button on error messages
    if (m.role === 'system' && m.content && m.content.indexOf('Error:') !== -1 && lastUserText) {
      var retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.innerHTML = '&#8635; ' + t('retry');
      retryBtn.title = t('retry');
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
    if (!p) { det.innerHTML = '<div class="nd">' + t('selectProvider') + '</div>'; return; }

    // Figure out which cloud model is currently active for this provider
    var activeCloudModel = '';
    for (var j = 0; j < p.models.length; j++) {
      if (p.models[j].id === cMod) { activeCloudModel = cMod; break; }
    }

    var h = '';

    // ── API Key section ──
    h += '<div class="cl-section">';
    h += '<label class="cl-field-lbl">' + esc(p.name) + ' ' + t('apiKey') + '</label>';
    if (p.configured) {
      // Show masked key with edit button (Cline-style)
      h += '<div class="cl-key-row" id="clKeyRow">';
      h += '<input class="cl-key-inp cl-key-masked" id="clKeyInp" type="password" value="sk-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" readonly data-provider="' + esc(p.id) + '" />';
      h += '</div>';
      h += '<div class="cl-key-actions">';
      h += '<span class="cl-status-ok">&#10003; ' + t('apiKeyConfigured') + '</span>';
      h += '<button class="cl-edit-key-btn" id="clEditKeyBtn">' + t('editKey') + '</button>';
      h += '</div>';
    } else {
      h += '<input class="cl-key-inp" id="clKeyInp" type="password" placeholder="' + t('enterApiKey') + '" data-provider="' + esc(p.id) + '" />';
    }
    h += '<div class="cl-note">' + t('apiKeyNote') + '</div>';
    if (p.docUrl) {
      h += '<button class="cl-get-key-btn" id="clGetKeyBtn" data-url="' + esc(p.docUrl) + '">' + t('getApiKey').replace('{0}', esc(p.name)) + '</button>';
    }
    h += '<button class="cl-save-btn" id="clSaveBtn" data-provider="' + esc(p.id) + '"' + (p.configured ? ' style="display:none"' : '') + '>' + t('saveKey') + '</button>';
    h += '</div>';

    // ── Model selector ──
    h += '<div class="cl-section">';
    h += '<label class="cl-field-lbl">' + t('model') + '</label>';
    h += '<div class="cl-model-select-row">';
    h += '<select class="cl-model-select" id="clModelSel">';
    if (!p.configured) {
      h += '<option value="">' + t('configureKeyFirst') + '</option>';
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

    // ── Cline-style Model Configuration ──
    var selModel = null;
    var showId = activeCloudModel || (p.configured && p.models.length > 0 ? p.models[0].id : '');
    for (var j = 0; j < p.models.length; j++) {
      if (p.models[j].id === showId) { selModel = p.models[j]; break; }
    }
    if (selModel) {
      // Read saved overrides from localStorage (keyed by model id)
      var cfgKey = 'tw-mcfg-' + (selModel.id || '');
      var savedCfg = {};
      try { savedCfg = JSON.parse(localStorage.getItem(cfgKey) || '{}'); } catch (e) {}
      var cfgCtx = savedCfg.contextWindow != null ? savedCfg.contextWindow : (selModel.contextLimit || 0);
      var cfgMax = savedCfg.maxOutputTokens != null ? savedCfg.maxOutputTokens : (selModel.outputLimit || -1);
      var cfgIn = savedCfg.inputPrice != null ? savedCfg.inputPrice : (selModel.costIn || 0);
      var cfgOut = savedCfg.outputPrice != null ? savedCfg.outputPrice : (selModel.costOut || 0);
      var cfgTemp = savedCfg.temperature != null ? savedCfg.temperature : 0;
      var cfgImg = savedCfg.supportsImages != null ? savedCfg.supportsImages : (selModel.supportsImages || false);
      var cfgR1 = savedCfg.enableR1Format || false;

      h += '<details class="cl-config-details" open>';
      h += '<summary class="cl-config-summary">&#9656; ' + t('modelConfig') + '</summary>';
      // Supports Images + Enable R1 checkboxes at top (like Cline)
      h += '<div class="cl-config-check-row">';
      h += '<label><input type="checkbox" id="clCfgImg"' + (cfgImg ? ' checked' : '') + ' /> ' + t('supportsImages') + '</label>';
      h += '<label><input type="checkbox" id="clCfgR1"' + (cfgR1 ? ' checked' : '') + ' /> ' + t('enableR1Format') + '</label>';
      h += '</div>';
      h += '<div class="cl-config-grid">';
      // Context Window Size
      h += '<div class="cl-config-field"><label>' + t('contextWindow') + '</label>';
      h += '<input type="text" class="cl-config-inp" id="clCfgCtx" value="' + cfgCtx + '" /></div>';
      // Max Output Tokens
      h += '<div class="cl-config-field"><label>' + t('maxOutputTokens') + '</label>';
      h += '<input type="text" class="cl-config-inp" id="clCfgMax" value="' + cfgMax + '" /></div>';
      // Input Price
      h += '<div class="cl-config-field"><label>' + t('inputPrice') + '</label>';
      h += '<input type="text" class="cl-config-inp" id="clCfgIn" value="' + cfgIn + '" /></div>';
      // Output Price
      h += '<div class="cl-config-field"><label>' + t('outputPrice') + '</label>';
      h += '<input type="text" class="cl-config-inp" id="clCfgOut" value="' + cfgOut + '" /></div>';
      // Temperature
      h += '<div class="cl-config-field cl-config-full"><label>' + t('temperature') + '</label>';
      h += '<input type="text" class="cl-config-inp" id="clCfgTemp" value="' + cfgTemp + '" /></div>';
      h += '</div>';
      // Bottom summary bar (like Cline): Context: 30K  Input: Free  Output: Free
      var ctxLabel = cfgCtx >= 1000 ? Math.round(cfgCtx / 1000) + 'K' : cfgCtx;
      var inLabel = cfgIn > 0 ? ('$' + cfgIn) : t('free');
      var outLabel = cfgOut > 0 ? ('$' + cfgOut) : t('free');
      h += '<div class="cl-config-summary-bar" id="clCfgBar">';
      h += '<span>' + t('context') + ': <b>' + ctxLabel + '</b></span>';
      h += '<span>' + t('input') + ': <b>' + inLabel + '</b></span>';
      h += '<span>' + t('output') + ': <b>' + outLabel + '</b></span>';
      h += '</div>';
      h += '<div class="cl-config-note">(Note: Thirdwave AI uses complex prompts and works best with capable models. Less capable models may not work as expected.)</div>';
      h += '</details>';
    }

    det.innerHTML = h;

    // ── Bind events ──
    var saveBtn = document.getElementById('clSaveBtn');
    var keyInp = document.getElementById('clKeyInp');
    var editKeyBtn = document.getElementById('clEditKeyBtn');

    // Edit key — make the masked field editable
    if (editKeyBtn && keyInp) {
      editKeyBtn.addEventListener('click', function () {
        keyInp.value = '';
        keyInp.readOnly = false;
        keyInp.classList.remove('cl-key-masked');
        keyInp.placeholder = t('enterApiKey');
        keyInp.focus();
        if (saveBtn) { saveBtn.style.display = 'block'; saveBtn.textContent = t('updateKey'); }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var key = keyInp ? keyInp.value.trim() : '';
        if (!key) return;
        saveBtn.textContent = t('savingKey');
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
    // ── Bind editable model config fields ──
    var cfgFields = ['clCfgCtx', 'clCfgMax', 'clCfgIn', 'clCfgOut', 'clCfgTemp'];
    var cfgKey2 = 'tw-mcfg-' + (activeCloudModel || (p.configured && p.models.length > 0 ? p.models[0].id : ''));
    function saveCfgOverrides() {
      var saved = {};
      try { saved = JSON.parse(localStorage.getItem(cfgKey2) || '{}'); } catch (e) {}
      var ctx = document.getElementById('clCfgCtx');
      var mx = document.getElementById('clCfgMax');
      var inp = document.getElementById('clCfgIn');
      var outp = document.getElementById('clCfgOut');
      var tmp = document.getElementById('clCfgTemp');
      var img = document.getElementById('clCfgImg');
      var r1 = document.getElementById('clCfgR1');
      if (ctx) saved.contextWindow = Number(ctx.value) || 0;
      if (mx) saved.maxOutputTokens = Number(mx.value);
      if (inp) saved.inputPrice = Number(inp.value) || 0;
      if (outp) saved.outputPrice = Number(outp.value) || 0;
      if (tmp) saved.temperature = Number(tmp.value) || 0;
      if (img) saved.supportsImages = img.checked;
      if (r1) saved.enableR1Format = r1.checked;
      localStorage.setItem(cfgKey2, JSON.stringify(saved));
      // Send to extension so it uses overrides
      vs.postMessage({ type: 'setModelConfig', config: saved });
      // Update summary bar
      var bar = document.getElementById('clCfgBar');
      if (bar) {
        var ctxV = saved.contextWindow || 0;
        var ctxL = ctxV >= 1000 ? Math.round(ctxV / 1000) + 'K' : ctxV;
        var inL = saved.inputPrice > 0 ? ('$' + saved.inputPrice) : t('free');
        var outL = saved.outputPrice > 0 ? ('$' + saved.outputPrice) : t('free');
        bar.innerHTML = '<span>' + t('context') + ': <b>' + ctxL + '</b></span>' +
          '<span>' + t('input') + ': <b>' + inL + '</b></span>' +
          '<span>' + t('output') + ': <b>' + outL + '</b></span>';
      }
    }
    cfgFields.forEach(function (fid) {
      var el = document.getElementById(fid);
      if (el) el.addEventListener('change', saveCfgOverrides);
    });
    var imgEl = document.getElementById('clCfgImg');
    if (imgEl) imgEl.addEventListener('change', saveCfgOverrides);
    var r1El = document.getElementById('clCfgR1');
    if (r1El) r1El.addEventListener('change', saveCfgOverrides);
  }

  // ── Render models ──────────────────────────────────────────────
  function renderModels(reg) {
    lastRegistry = reg; // cache for dropdowns
    var lc = document.getElementById('lcm');
    var cc = document.getElementById('ccm');

    // Build a set of all online model ids so we can auto-clear stale cMod
    var onlineModelIds = {};
    var local = reg.local || [];
    for (var i = 0; i < local.length; i++) {
      if (local[i].status !== 'online') continue;
      for (var j = 0; j < local[i].models.length; j++) {
        onlineModelIds[local[i].models[j].id] = true;
      }
    }
    var cloud = reg.cloud || [];
    for (var i = 0; i < cloud.length; i++) {
      if (!cloud[i].configured) continue;
      for (var j = 0; j < cloud[i].models.length; j++) {
        onlineModelIds[cloud[i].models[j].id] = true;
      }
    }
    // If current model belongs to an offline gateway, auto-select first online model
    if (cMod && !onlineModelIds[cMod]) {
      var newModel = '';
      for (var i = 0; i < local.length; i++) {
        if (local[i].status === 'online' && local[i].models.length > 0) {
          newModel = local[i].models[0].id;
          break;
        }
      }
      if (newModel) {
        cMod = newModel;
        updateModelLabel();
        vs.postMessage({ type: 'selectModel', modelId: cMod });
      } else {
        cMod = '';
        updateModelLabel();
      }
    }

    var lh = '';
    for (var i = 0; i < local.length; i++) {
      var p = local[i];
      var sc = p.status === 'online' ? 'on2' : 'off2';

      // Offline gateways: show status header only, no model cards
      if (p.status !== 'online') {
        lh += '<div class="ms"><div class="msh"><span><span class="sd2 ' + sc + '"></span>' + esc(p.name) + '</span>';
        lh += '<span class="bc" style="color:var(--vscode-errorForeground,#f44)">offline</span></div></div>';
        continue;
      }

      // Split models into local GPU vs cloud gateway
      var localModels = [];
      var cloudGwModels = [];
      for (var j = 0; j < p.models.length; j++) {
        if (p.models[j].isCloud) { cloudGwModels.push(p.models[j]); }
        else { localModels.push(p.models[j]); }
      }

      // Section: Local GPU models
      if (localModels.length > 0) {
        lh += '<div class="ms"><div class="msh"><span><span class="sd2 ' + sc + '"></span>' + esc(p.name) + '</span>';
        lh += '<span class="bc">' + localModels.length + ' ' + (localModels.length !== 1 ? t('modelsPlural') : t('models')) + '</span></div>';
        lh += '<div class="ms-badge ms-badge-local">' + t('gatewayLocal') + ' &mdash; ' + t('free') + '</div>';
        lh += '<div class="ml">';
        for (var j = 0; j < localModels.length; j++) {
          var m = localModels[j];
          var s = cMod === m.id ? ' sel' : '';
          lh += '<div class="mc' + s + '" data-mid="' + esc(m.id) + '">' +
            '<span class="mi">&#128421;</span><span class="mn">' + esc(m.name || m.id) + '</span>' +
            '<span class="lt lt-local">' + t('local') + '</span><span class="mm">ctx:' + m.contextLimit + '</span></div>';
        }
        lh += '</div></div>';
      }

      // Section: Cloud models routed through gateway
      if (cloudGwModels.length > 0) {
        lh += '<div class="ms"><div class="msh"><span><span class="sd2 ' + sc + '"></span>' + esc(p.name) + '</span>';
        lh += '<span class="bc">' + cloudGwModels.length + ' ' + (cloudGwModels.length !== 1 ? t('modelsPlural') : t('models')) + '</span></div>';
        lh += '<div class="ms-badge ms-badge-cloud">' + t('gatewayCloud') + ' &mdash; ' + t('paid') + '</div>';
        lh += '<div class="ml">';
        for (var j = 0; j < cloudGwModels.length; j++) {
          var m = cloudGwModels[j];
          var s = cMod === m.id ? ' sel' : '';
          var provLabel = m.cloudProviderName ? esc(m.cloudProviderName) : t('cloud');
          lh += '<div class="mc' + s + '" data-mid="' + esc(m.id) + '">' +
            '<span class="mi">&#9729;</span><span class="mn">' + esc(m.name || m.id) + '</span>' +
            '<span class="lt lt-cloud">' + t('cloud') + '</span><span class="mm">' + provLabel + '</span></div>';
        }
        lh += '</div></div>';
      }

      // If provider is online but has no models, show count
      if (localModels.length === 0 && cloudGwModels.length === 0) {
        lh += '<div class="ms"><div class="msh"><span><span class="sd2 ' + sc + '"></span>' + esc(p.name) + '</span>';
        lh += '<span class="bc">0 ' + t('modelsPlural') + '</span></div></div>';
      }
    }
    if (lc) lc.innerHTML = lh || '<div class="nd">' + t('noGatewayModels') + '</div>';

    // Stagger model card entrance animations
    if (lc) {
      var mcards = lc.querySelectorAll('.mc');
      mcards.forEach(function (card, idx) {
        card.classList.add('mc-enter');
        if (idx < 8) card.classList.add('stagger-' + (idx + 1));
      });
    }

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
      c.innerHTML = '<div class="nd">' + t('noSkills').replace('\n', '<br>') + '</div>';
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

    // Stagger skill item entrance animations
    c.querySelectorAll('.sk').forEach(function (item, idx) {
      item.classList.add('sk-enter');
      if (idx < 8) item.classList.add('stagger-' + (idx + 1));
    });

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
      c.innerHTML = '<div class="nd">' + t('noSessions').replace('\n', '<br>') + '</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var d = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '';
      var stagger = i < 8 ? ' stagger-' + (i + 1) : '';
      h += '<div class="ssc ssc-enter' + stagger + '" data-sid="' + esc(s.id) + '">' +
        '<span class="sst">' + esc(s.title || t('untitled')) + '</span>' +
        '<span class="ssd">' + esc(d) + '</span>' +
        '<button class="ssx" data-did="' + esc(s.id) + '" title="' + t('deleteSession') + '">&#10005;</button></div>';
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
    var wrapper = b.closest('.cbw');
    var el = wrapper ? wrapper.querySelector('code') : null;
    if (el) {
      var txt = el.textContent || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          b.textContent = t('copied');
          setTimeout(function () { b.textContent = t('copy'); }, 2000);
        }).catch(function () {
          fallbackCopy(txt, b);
        });
      } else {
        fallbackCopy(txt, b);
      }
    }
  });
  function fallbackCopy(txt, btn) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); btn.textContent = t('copied'); setTimeout(function () { btn.textContent = t('copy'); }, 2000); } catch(e) {}
    document.body.removeChild(ta);
  }

  // ── Streaming state ─────────────────────────────────────────────
  var streamEl = null;      // current streaming message container
  var streamBody = null;    // streaming body text element
  var streamReason = null;  // streaming reasoning container
  var streamReasonBody = null; // reasoning text body inside container
  var streamReasonHdr = null;  // reasoning header (clickable)
  var streamText = '';      // accumulated text for final render
  var streamReasonText = ''; // accumulated reasoning text
  var reasoningDone = false;
  var workingPhaseTimer = null; // auto-cycling phase animation timer

  // ── Messages from extension ────────────────────────────────────
  window.addEventListener('message', function (e) {
    var m = e.data;
    switch (m.type) {
      // ── Auth messages ──────────────────────────────────────────
      case 'authSuccess':
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Sign In'; }
        clearAuthMessages();
        updateProfileUI(m.user);
        renderApiKeys(m.apiKeys || []);
        if (window._setConnStatus) window._setConnStatus(true);
        // Gate: if no API key, key not admin-verified, or user not active → show gate
        if (!m.hasApiKey || !m.adminVerified || (m.user && m.user.status !== 'active')) {
          if (authScreen) authScreen.style.display = 'none';
          if (apiKeyGate) apiKeyGate.style.display = 'flex';
          if (acctBtn) acctBtn.style.display = 'none';
          // Show appropriate pending message
          if (m.hasApiKey && !m.adminVerified) {
            showGateStatus('Your API key is pending admin verification. You will be able to access the platform once an admin approves your key.', 'pending');
          } else if (m.hasApiKey && m.user && m.user.status !== 'active') {
            showGateStatus('Your account is pending admin verification. Please wait for approval.', 'pending');
          }
        } else {
          if (authScreen) authScreen.style.display = 'none';
          if (apiKeyGate) apiKeyGate.style.display = 'none';
          if (acctBtn) acctBtn.style.display = '';
          // Fetch the full active key for display
          vs.postMessage({ type: 'getActiveKey' });
        }
        vs.postMessage({ type: 'listApiKeys' });
        break;
      case 'authRequired':
        if (authScreen) authScreen.style.display = 'flex';
        if (apiKeyGate) apiKeyGate.style.display = 'none';
        if (acctBtn) acctBtn.style.display = 'none';
        showLoginState();
        clearAuthMessages();
        break;
      case 'authError':
        showAuthError(m.error || 'Authentication failed');
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Sign In'; }
        if (regBtn) { regBtn.disabled = false; regBtn.textContent = 'Register'; }
        // Shake auth card to indicate error
        (function () {
          var card = document.querySelector('.auth-card');
          if (card) {
            card.classList.remove('auth-shake');
            void card.offsetWidth; // force reflow
            card.classList.add('auth-shake');
            card.addEventListener('animationend', function () { card.classList.remove('auth-shake'); }, { once: true });
          }
        })();
        break;
      case 'registerSuccess':
        if (regBtn) { regBtn.disabled = false; regBtn.textContent = 'Register'; }
        // Show pending-approval state in the auth screen
        clearAuthMessages();
        showRegPendingState(m.requestId, m.message || 'Registration submitted. Waiting for admin approval...');
        break;
      case 'registrationStatus': {
        var statusMsg = m.status === 'approved'
          ? '✅ Account approved! You can now sign in.'
          : m.status === 'rejected'
            ? '❌ Registration was rejected. Contact your admin.'
            : '⏳ ' + (m.message || 'Still waiting for admin approval...');
        var statusLevel = m.status === 'approved' ? 'ok' : m.status === 'rejected' ? 'err' : 'pending';
        showAuthStatus(statusMsg, statusLevel);
        if (m.status === 'approved') showLoginState();
        break;
      }
      case 'loggedOut':
        if (authScreen) authScreen.style.display = 'flex';
        if (apiKeyGate) apiKeyGate.style.display = 'none';
        if (acctBtn) acctBtn.style.display = 'none';
        showLoginState();
        clearAuthMessages();
        updateProfileUI(null);
        renderApiKeys([]);
        break;
      case 'apiKeysData':
        renderApiKeys(m.keys || []);
        break;
      case 'activeKeyData':
        updateActiveKeyDisplay(m.key);
        break;
      case 'apiKeyVerified':
        if (m.result && m.result.valid) {
          var models = (m.result.models || []).slice(0, 3).join(', ');
          var okMsg = 'Key verified successfully' + (models ? ' (models: ' + models + ')' : '');
          showApiKeyMsg(okMsg, 'ok');
          showGateStatus(okMsg, 'ok');
        } else {
          var errMsg = (m.result && m.result.error) || 'Key verification failed';
          showApiKeyMsg(errMsg, 'err');
          showGateStatus(errMsg, 'err');
        }
        break;
      case 'apiKeyVerifyError':
        var verifyErrMsg = m.error || 'Key verification failed';
        showApiKeyMsg(verifyErrMsg, 'err');
        showGateStatus(verifyErrMsg, 'err');
        break;
      case 'apiKeySaved':
        if (saveApiKeyBtn) { saveApiKeyBtn.disabled = false; saveApiKeyBtn.textContent = 'Save Key'; }
        if (userApiKeyEl) userApiKeyEl.value = '';
        var isAutoVerified = m.adminVerified === true;
        if (isAutoVerified) {
          showApiKeyMsg('API key saved and verified!', 'ok');
        } else {
          showApiKeyMsg('API key saved! Pending admin verification.', 'ok');
        }
        renderApiKeys(m.keys || []);
        // Fetch the full active key for display
        vs.postMessage({ type: 'getActiveKey' });
        // Gate page handling
        if (gateSaveBtn) { gateSaveBtn.disabled = false; gateSaveBtn.textContent = 'OK'; }
        if (gateApiKeyEl) gateApiKeyEl.value = '';
        if (isAutoVerified) {
          showGateStatus('API key saved and verified! You can now use the platform.', 'ok');
          // Hide gate after short delay for admin users
          setTimeout(function() {
            if (apiKeyGate) apiKeyGate.style.display = 'none';
            if (chatContainer) chatContainer.classList.remove('gate-active');
          }, 1500);
        } else {
          showGateStatus('API key saved! Pending admin verification. You will be able to access the platform once an admin approves your key.', 'pending');
        }
        break;
      case 'apiKeyRevoked':
        showApiKeyMsg('API key revoked. Save a new key to continue.', 'ok');
        renderApiKeys(m.keys || []);
        break;
      case 'apiKeySaveError':
        if (saveApiKeyBtn) { saveApiKeyBtn.disabled = false; saveApiKeyBtn.textContent = 'Save Key'; }
        if (gateSaveBtn) { gateSaveBtn.disabled = false; gateSaveBtn.textContent = 'OK'; }
        var saveErrMsg = m.error || 'Failed to save key';
        showApiKeyMsg(saveErrMsg, 'err');
        showGateStatus(saveErrMsg, 'err');
        break;
      case 'profileUpdated':
        updateProfileUI(m.user);
        showProfileMsg('Name updated successfully!', 'ok');
        break;
      case 'profileError':
        showProfileMsg(m.error || 'Failed to update name', 'err');
        break;
      case 'init':
        cMod = m.model || '';
        cAg = m.agent || 'build';
        updateModelLabel();
        if (agLbl) agLbl.textContent = cAg;
        // Always start with auth screen visible, acctBtn hidden until auth confirmed
        if (authScreen) authScreen.style.display = 'flex';
        if (apiKeyGate) apiKeyGate.style.display = 'none';
        if (acctBtn) acctBtn.style.display = 'none';
        showLoginState();
        clearAuthMessages();
        // Check auth on init — will hide authScreen if token is valid
        vs.postMessage({ type: 'checkAuth' });
        vs.postMessage({ type: 'listApiKeys' });
        // Restore language from extension state
        if (m.language && m.language !== currentLang) {
          currentLang = m.language;
          localStorage.setItem('tw-lang', m.language);
          applyI18n();
          if (langPicker) {
            langPicker.querySelectorAll('.lang-btn').forEach(function (b) {
              b.classList.toggle('sel', b.getAttribute('data-lang') === m.language);
            });
          }
        }
        // Highlight the active agent card
        document.querySelectorAll('.ag-card').forEach(function (c) {
          c.classList.toggle('sel', c.getAttribute('data-ag') === cAg);
        });
        break;
      case 'addMessage':
        renderMsg(m.message);
        // Only reset stop button for assistant/system messages (not user echo)
        if (m.message && m.message.role !== 'user') {
          isGenerating = false;
          snd.innerHTML = SEND_SVG;
          snd.classList.remove('stop-mode');
          snd.disabled = false;
          snd.title = 'Send message';
        }
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
        if (titleEl) titleEl.textContent = t('chat');
        break;
      case 'setLoading':
        if (ldEl) ldEl.classList.toggle('on', m.loading);
        if (!m.loading) {
          isGenerating = false;
          snd.innerHTML = SEND_SVG;
          snd.classList.remove('stop-mode');
          snd.disabled = false;
          snd.title = 'Send message';
        }
        if (m.loading) autoScroll();
        break;
      // ── Streaming messages ──
      case 'streamStart':
        // Create the streaming message container
        if (esEl) esEl.style.display = 'none';
        // Hide the loading spinner since we're now streaming
        if (ldEl) ldEl.classList.remove('on');
        // Ensure stop button is visible during streaming
        isGenerating = true;
        snd.innerHTML = STOP_SVG;
        snd.classList.add('stop-mode');
        snd.disabled = false;
        snd.title = 'Stop generation';
        streamEl = document.createElement('div');
        streamEl.className = 'stream-msg';
        // Unified Copilot-style "Working" block — contains everything
        var workingBlock = document.createElement('div');
        workingBlock.className = 'stream-working';
        workingBlock.id = 'streamWorkingBlock';
        // Working header (always visible)
        var workHdr = document.createElement('div');
        workHdr.className = 'working-header';
        workHdr.innerHTML = '<span class="working-dot"></span><span class="working-label">' + t('working') + '</span>';
        workingBlock.appendChild(workHdr);
        // Tool steps container — inside working block
        var toolSteps = document.createElement('div');
        toolSteps.className = 'stream-tool-steps';
        toolSteps.id = 'streamToolSteps';
        workingBlock.appendChild(toolSteps);
        // Reasoning content — inside working block, below tool steps
        streamReason = document.createElement('div');
        streamReason.className = 'working-reasoning';
        streamReason.id = 'streamReasoningContent';
        workingBlock.appendChild(streamReason);
        // Status indicator at bottom — shows current phase (Analyzing, Thinking, etc.)
        var statusLine = document.createElement('div');
        statusLine.className = 'working-status';
        statusLine.id = 'streamWorkingStatus';
        workingBlock.appendChild(statusLine);
        streamEl.appendChild(workingBlock);

        // Body for actual response text (appears below working block)
        streamBody = document.createElement('div');
        streamBody.className = 'stream-body';
        streamEl.appendChild(streamBody);
        // We don't need separate streamReasonHdr/streamReasonBody anymore
        streamReasonBody = streamReason;
        streamReasonHdr = null;
        msgsEl.appendChild(streamEl);
        streamText = '';
        streamReasonText = '';
        reasoningDone = false;
        userScrolledUp = false;
        autoScroll();
        break;
      case 'streamWorking':
        // Update the status indicator at the bottom of the working block
        var statusEl = document.getElementById('streamWorkingStatus');
        var wb = document.getElementById('streamWorkingBlock');
        if (m.phase === 'done') {
          // Fade the entire working block when response is ready
          if (wb) wb.classList.add('working-done');
          if (workingPhaseTimer) { clearInterval(workingPhaseTimer); workingPhaseTimer = null; }
        } else if (statusEl) {
          var phases = ['thinking', 'analyzing', 'processing'];
          var phaseIdx = 0;
          var renderStatus = function (pkey) {
            var phaseLabels = { thinking: t('thinking'), analyzing: t('analyzing'), processing: t('processing') };
            var label = phaseLabels[pkey] || t('thinking');
            statusEl.innerHTML = '<span class="working-phase-dot"></span> ' + label;
          };
          renderStatus(m.phase);
          if (wb) wb.classList.remove('working-done');
          if (workingPhaseTimer) clearInterval(workingPhaseTimer);
          workingPhaseTimer = setInterval(function () {
            phaseIdx = (phaseIdx + 1) % phases.length;
            renderStatus(phases[phaseIdx]);
          }, 3000);
          autoScroll();
        }
        break;
      case 'streamToolStep':
        // Render a tool call step in the working block
        var ts = document.getElementById('streamToolSteps');
        if (ts) {
          var icon = m.success ? '&#10003;' : '&#10007;';
          var cls = m.success ? 'tool-step-ok' : 'tool-step-fail';
          var toolLabel = esc(m.tool);
          var argSummary = '';
          if (m.args) {
            if (m.args.path || m.args.filePath) argSummary = esc(m.args.path || m.args.filePath);
            else if (m.args.command) argSummary = esc(String(m.args.command).substring(0, 60));
            else if (m.args.pattern || m.args.query) argSummary = esc(m.args.pattern || m.args.query);
          }
          var step = document.createElement('div');
          step.className = 'tool-step ' + cls;
          step.innerHTML = '<span class="tool-step-icon">' + icon + '</span>' +
            '<span class="tool-step-name">' + toolLabel + '</span>' +
            (argSummary ? '<span class="tool-step-arg">' + argSummary + '</span>' : '');
          ts.appendChild(step);
          autoScroll();
        }
        break;
      case 'streamThinking':
        // Update status indicator to show thinking state
        var thinkStatus = document.getElementById('streamWorkingStatus');
        if (m.thinking) {
          if (thinkStatus) {
            thinkStatus.innerHTML = '<span class="working-phase-dot"></span> ' + t('thinking');
          }
        } else {
          if (thinkStatus) {
            thinkStatus.innerHTML = '<span class="working-phase-dot done"></span> ' + t('thinking').replace('...', '');
          }
        }
        break;
      case 'streamReasoning':
        if (streamReasonBody) {
          streamReasonText += m.content;
          streamReasonBody.textContent = streamReasonText;
          autoScroll();
        }
        break;
      case 'streamToken':
        if (!reasoningDone) {
          // First text token arrived — collapse the working block
          reasoningDone = true;
          var workBlock = document.getElementById('streamWorkingBlock');
          if (workBlock) {
            workBlock.classList.add('working-collapsed');
            // Make the header clickable to expand
            var hdr = workBlock.querySelector('.working-header');
            if (hdr) {
              hdr.style.cursor = 'pointer';
              hdr.addEventListener('click', function () {
                workBlock.classList.toggle('working-collapsed');
              });
            }
          }
          if (workingPhaseTimer) { clearInterval(workingPhaseTimer); workingPhaseTimer = null; }
        }
        streamText += m.content;
        if (streamBody) {
          streamBody.innerHTML = md(streamText) + '<span class="stream-cursor"></span>';
          autoScroll();
        }
        break;
      case 'streamEnd':
        // Remove streaming elements, render final message
        if (workingPhaseTimer) { clearInterval(workingPhaseTimer); workingPhaseTimer = null; }
        if (streamEl) { streamEl.remove(); streamEl = null; }
        streamBody = null; streamReason = null; streamReasonBody = null; streamReasonHdr = null;
        streamReasonText = '';
        if (m.message) renderMsg(m.message);
        isGenerating = false;
        snd.innerHTML = SEND_SVG;
        snd.classList.remove('stop-mode');
        snd.disabled = false;
        snd.title = 'Send message';
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
        // Mark connection as online when models arrive
        if (window._setConnStatus) window._setConnStatus(true);
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
        if (errSaveBtn) { errSaveBtn.textContent = t('saveKey'); errSaveBtn.disabled = false; }
        break;
      case 'cloudKeySaved':
        // Key saved — modelsData will arrive from _loadModels() and re-render the detail
        var okSaveBtn = document.getElementById('clSaveBtn');
        if (okSaveBtn) { okSaveBtn.textContent = t('savedKey'); }
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
      case 'hitlApprovalNeeded':
        renderInlineHitlApproval(m.request);
        break;
      case 'hitlApprovalResolved':
        resolveInlineHitlApproval(m.requestId, m.decision);
        break;
      case 'workspaceFiles':
        wsFiles = m.files || [];
        break;
      case 'customOpenAIData':
        // Restore saved custom OpenAI config into the fields
        if (m.config) {
          var coBase = document.getElementById('coBaseUrl');
          var coKey = document.getElementById('coApiKey');
          var coModel = document.getElementById('coModelId');
          if (coBase && m.config.baseUrl) coBase.value = m.config.baseUrl;
          if (coKey && m.config.apiKey) { coKey.value = '\u2022'.repeat(20); coKey.setAttribute('data-saved', 'true'); }
          if (coModel && m.config.modelId) coModel.value = m.config.modelId;
        }
        break;
      case 'customOpenAISaved':
        var coStat = document.getElementById('coStatus');
        if (coStat) { coStat.textContent = t('savedConfig'); coStat.className = 'cl-note co-status co-ok'; }
        var coSBtn = document.getElementById('coSaveBtn');
        if (coSBtn) { coSBtn.textContent = t('savedConfig'); setTimeout(function() { coSBtn.textContent = t('saveConfig'); }, 2000); }
        break;
      case 'customOpenAITestResult':
        var coSt = document.getElementById('coStatus');
        if (coSt) {
          if (m.ok) { coSt.textContent = t('connectionOk'); coSt.className = 'cl-note co-status co-ok'; }
          else { coSt.textContent = t('connectionFail') + (m.error ? ': ' + m.error : ''); coSt.className = 'cl-note co-status co-fail'; }
        }
        var coTBtn = document.getElementById('coTestBtn');
        if (coTBtn) { coTBtn.disabled = false; coTBtn.textContent = t('testConnection'); }
        break;
      case 'contextInfo':
        renderContextCompaction(m.summary || [], m.charCount || 0, m.activeSkills || [], m.contextWindow || null);
        break;
      case 'compactResult':
        if (m.message) {
          showNotification(m.message, 'info');
        }
        break;
    }
  });

  // ── Context compaction display ─────────────────────────────────
  function renderContextCompaction(summary, charCount, activeSkillIds, contextWindow) {
    var existing = document.querySelector('.ctx-compact');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.className = 'ctx-compact';

    // ─ Header: agent tag + skill tags + tokens badge
    var hdr = document.createElement('div');
    hdr.className = 'ctx-compact-hdr';
    var skillTags = '';
    skillTags += '<span class="ctx-agent-tag">' + esc(cAg) + '</span>';
    if (activeSkillIds && activeSkillIds.length) {
      for (var si = 0; si < activeSkillIds.length; si++) {
        var sName = activeSkillIds[si];
        for (var sj = 0; sj < allSk.length; sj++) {
          var skItem = allSk[sj].skill || allSk[sj];
          if (skItem.id === activeSkillIds[si]) { sName = skItem.displayName || skItem.name || activeSkillIds[si]; break; }
        }
        skillTags += '<span class="ctx-skill-tag">/' + esc(sName) + '</span>';
      }
    }

    // Token count display
    var tokenInfo = '';
    if (contextWindow) {
      var usedK = (contextWindow.usedTokens / 1000).toFixed(1);
      var maxK = Math.round(contextWindow.maxTokens / 1000);
      var pct = contextWindow.percentage || 0;
      var pctColor = pct > 80 ? 'var(--err)' : pct > 60 ? '#f59e0b' : 'var(--accent)';
      tokenInfo = '<span class="ctx-compact-tokens" style="color:' + pctColor + '">' + usedK + 'K / ' + maxK + 'K tokens</span>' +
        '<span class="ctx-compact-pct" style="background:' + pctColor + '22;color:' + pctColor + '">' + pct + '%</span>';
    } else {
      tokenInfo = '<span class="ctx-compact-size">' + Math.round(charCount / 1000) + 'K chars</span>';
    }

    hdr.innerHTML = '<span class="ctx-compact-icon">&#9881;</span>' +
      '<span>Context Window</span>' +
      skillTags + tokenInfo +
      '<button class="ctx-compact-toggle">&#9660;</button>';
    bar.appendChild(hdr);

    // ─ Body: category breakdown + progress bar + compact button
    var body = document.createElement('div');
    body.className = 'ctx-compact-body collapsed';
    var bodyHtml = '';

    // Progress bar
    if (contextWindow) {
      var pct2 = contextWindow.percentage || 0;
      var barColor = pct2 > 80 ? 'var(--err)' : pct2 > 60 ? '#f59e0b' : 'var(--accent)';
      bodyHtml += '<div class="ctx-progress-bar"><div class="ctx-progress-fill" style="width:' + pct2 + '%;background:' + barColor + '"></div></div>';

      // Category breakdown
      var bd = contextWindow.breakdown || {};
      var categories = ['system', 'tools', 'workspace', 'skills', 'history', 'userMessage'];
      for (var ci = 0; ci < categories.length; ci++) {
        var cat = bd[categories[ci]];
        if (cat && cat.tokens > 0) {
          var catPct = contextWindow.usedTokens > 0 ? ((cat.tokens / contextWindow.usedTokens) * 100).toFixed(1) : '0';
          bodyHtml += '<div class="ctx-breakdown-row"><span class="ctx-breakdown-label">' + esc(cat.label) + '</span><span class="ctx-breakdown-val">' + catPct + '%</span></div>';
        }
      }

      // Reserved for response
      bodyHtml += '<div class="ctx-breakdown-row ctx-reserved"><span class="ctx-breakdown-label">&#9998; Reserved for response</span></div>';
    }

    // Summary items
    for (var i = 0; i < summary.length; i++) {
      bodyHtml += '<div class="ctx-compact-item">&#8226; ' + esc(summary[i]) + '</div>';
    }

    // Compact button
    bodyHtml += '<button class="ctx-compact-btn" id="ctxCompactBtn">Compact Conversation</button>';
    body.innerHTML = bodyHtml;
    bar.appendChild(body);

    // Event: toggle body
    hdr.addEventListener('click', function () {
      body.classList.toggle('collapsed');
      var btn = hdr.querySelector('.ctx-compact-toggle');
      if (btn) btn.innerHTML = body.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
    });

    msgsEl.appendChild(bar);

    // Event: compact conversation button
    var compactBtn = document.getElementById('ctxCompactBtn');
    if (compactBtn) compactBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      vs.postMessage({ type: 'compactConversation' });
      compactBtn.textContent = 'Compacting...';
      compactBtn.disabled = true;
    });

    autoScroll();
  }

  // ── Toast notification helper ───────────────────────────────────
  function _getToastContainer() {
    var c = document.getElementById('tw-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'tw-toast-container';
      c.className = 'tw-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function showNotification(msg, type) {
    // Always show a small in-message notification too
    var note = document.createElement('div');
    note.className = 'ctx-notification ' + (type || 'info');
    note.textContent = msg;
    if (msgsEl) { msgsEl.appendChild(note); autoScroll(); }
    setTimeout(function () { if (note.parentNode) note.remove(); }, 4000);

    // Also show a floating toast
    var container = _getToastContainer();
    var toast = document.createElement('div');
    var cls = { ok: 'ok', success: 'ok', error: 'err', warn: 'warn', warning: 'warn' }[type] || 'info';
    toast.className = 'tw-toast ' + cls;
    toast.textContent = msg;
    container.appendChild(toast);
    var dismiss = function () {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', function () { if (toast.parentNode) toast.remove(); }, { once: true });
    };
    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, 3500);
  }

  // ── HITL panel rendering ─────────────────────────────────────
  function renderHitlPending(requests) {
    var c = document.getElementById('hitlPending');
    if (!c) return;
    // Update badge count
    var badge = document.querySelector('.rs-icon[data-rs="hitl"] .rs-badge');
    if (badge) { badge.textContent = requests.length; badge.style.display = requests.length ? 'flex' : 'none'; }
    if (!requests.length) { c.innerHTML = '<div class="nd">' + t('noPending') + '</div>'; return; }
    var h = '';
    for (var i = 0; i < requests.length; i++) {
      var r = requests[i];
      var sev = r.severity || 'medium';
      h += '<div class="hitl-card ' + esc(sev) + '">' +
        '<div class="hitl-action">' + esc(r.action || r.id) + '</div>' +
        '<div class="hitl-detail">' + esc(r.command || r.filePath || r.resource || r.description || '') + '</div>';
      if (r.reasons && r.reasons.length) {
        h += '<ul class="hitl-reasons">';
        for (var j = 0; j < r.reasons.length; j++) h += '<li>' + esc(r.reasons[j]) + '</li>';
        h += '</ul>';
      }
      h += '<div class="hitl-btns">' +
        '<button class="hitl-btn approve" data-rid="' + esc(r.id) + '">' + t('approve') + '</button>' +
        '<button class="hitl-btn deny" data-rid="' + esc(r.id) + '">' + t('deny') + '</button>' +
        '</div></div>';
    }
    c.innerHTML = h;
    c.querySelectorAll('.hitl-card').forEach(function (card, idx) {
      card.classList.add('hitl-card-enter');
      if (idx < 8) card.classList.add('stagger-' + (idx + 1));
    });
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
      '<div class="hitl-stat"><span class="hitl-stat-lbl">' + t('totalEvaluated') + '</span><span class="hitl-stat-val">' + (stats.totalEvaluated || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">' + t('approved') + '</span><span class="hitl-stat-val">' + (stats.approved || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">' + t('denied') + '</span><span class="hitl-stat-val">' + (stats.denied || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">' + t('expired') + '</span><span class="hitl-stat-val">' + (stats.expired || 0) + '</span></div>' +
      '<div class="hitl-stat"><span class="hitl-stat-lbl">' + t('pending') + '</span><span class="hitl-stat-val">' + (stats.pending || 0) + '</span></div>';
  }

  function renderHitlRecent(decisions) {
    var c = document.getElementById('hitlRecent');
    if (!c) return;
    if (!decisions.length) { c.innerHTML = '<div class="nd">' + t('noRecent') + '</div>'; return; }
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

  // ── Inline HITL approval cards in the chat stream ─────────────
  // Shown during active agent execution when HITL triggers "ask"
  // Only shown for medium and high/critical risk tasks — low risk auto-approved
  function renderInlineHitlApproval(req) {
    if (!req || !req.id) return;
    // Skip low-risk tasks — don't interrupt the user for minor actions
    if (req.severity === 'low') return;
    var msgsEl = document.getElementById('msgs');
    if (!msgsEl) return;
    var card = document.createElement('div');
    card.className = 'hitl-inline-card ' + esc(req.severity || 'medium');
    card.setAttribute('data-hitl-id', req.id);
    var detail = req.command || req.filePath || req.url || req.description || '';
    // Compact card: just the action label + short detail + two buttons
    var h = '<div class="hitl-inline-task">' + esc(req.action || 'Action') + (detail ? '<span class="hitl-inline-detail"> — ' + esc(detail.slice(0, 80)) + '</span>' : '') + '</div>';
    h += '<div class="hitl-inline-btns">' +
      '<button class="hitl-btn approve" data-rid="' + esc(req.id) + '">' + t('approve') + '</button>' +
      '<button class="hitl-btn deny" data-rid="' + esc(req.id) + '">' + t('deny') + '</button>' +
      '</div>';
    card.innerHTML = h;
    card.querySelectorAll('.hitl-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var rid = b.getAttribute('data-rid');
        var action = b.classList.contains('approve') ? 'approve' : 'deny';
        vs.postMessage({ type: 'hitlResolve', requestId: rid, decision: action });
        // Auto-vanish immediately after click — no lingering resolved state
        card.style.transition = 'opacity .25s, max-height .3s';
        card.style.opacity = '0';
        card.style.maxHeight = '0';
        card.style.overflow = 'hidden';
        setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 320);
      });
    });
    msgsEl.appendChild(card);
    autoScroll();
  }

  function resolveInlineHitlApproval(requestId, decision) {
    var card = document.querySelector('.hitl-inline-card[data-hitl-id="' + requestId + '"]');
    if (!card) return;
    var statusEl = card.querySelector('.hitl-inline-status');
    var btnsEl = card.querySelector('.hitl-inline-btns');
    if (statusEl) {
      var icon = decision === 'approved' ? '✅' : '❌';
      statusEl.textContent = icon + ' ' + (decision === 'approved' ? t('approved') : t('denied'));
      statusEl.className = 'hitl-inline-status ' + (decision === 'approved' ? 'resolved-approved' : 'resolved-denied');
    }
    if (btnsEl) btnsEl.remove();
    card.classList.add('resolved');
  }

  // ── OpenAI Compatible config save/test buttons ──────────────────
  var coSaveBtn = document.getElementById('coSaveBtn');
  if (coSaveBtn) {
    coSaveBtn.addEventListener('click', function () {
      var baseUrl = (document.getElementById('coBaseUrl') || {}).value || '';
      var apiKey = (document.getElementById('coApiKey') || {}).value || '';
      var modelId = (document.getElementById('coModelId') || {}).value || '';
      // Don't send masked placeholder as the key
      var coKeyEl = document.getElementById('coApiKey');
      if (coKeyEl && coKeyEl.getAttribute('data-saved') === 'true' && apiKey.indexOf('\u2022') !== -1) apiKey = '';
      vs.postMessage({ type: 'setCustomOpenAI', baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: modelId.trim() });
    });
  }
  var coTestBtn = document.getElementById('coTestBtn');
  if (coTestBtn) {
    coTestBtn.addEventListener('click', function () {
      var baseUrl = (document.getElementById('coBaseUrl') || {}).value || '';
      var apiKey = (document.getElementById('coApiKey') || {}).value || '';
      var coKeyEl = document.getElementById('coApiKey');
      if (coKeyEl && coKeyEl.getAttribute('data-saved') === 'true' && apiKey.indexOf('\u2022') !== -1) apiKey = '';
      coTestBtn.disabled = true;
      coTestBtn.textContent = '...';
      var coSt = document.getElementById('coStatus');
      if (coSt) { coSt.textContent = ''; coSt.className = 'cl-note co-status'; }
      vs.postMessage({ type: 'testCustomOpenAI', baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
    });
  }
  // Clear masked state on focus so user can type a new key
  var coApiKeyEl = document.getElementById('coApiKey');
  if (coApiKeyEl) {
    coApiKeyEl.addEventListener('focus', function () {
      if (coApiKeyEl.getAttribute('data-saved') === 'true') {
        coApiKeyEl.value = '';
        coApiKeyEl.removeAttribute('data-saved');
      }
    });
  }

  // ── Auth / Login ─────────────────────────────────────────────────
  var authScreen = document.getElementById('authScreen');
  var loginForm = document.getElementById('loginForm');
  var registerForm = document.getElementById('registerForm');
  var authError = document.getElementById('authError');
  var authOk = document.getElementById('authOk');
  var authError2 = document.getElementById('authError2');
  var authOk2 = document.getElementById('authOk2');
  var logoutBtn = document.getElementById('logoutBtn');
  var acctBtn = document.getElementById('acctBtn');
  var acctInitials = document.getElementById('acctInitials');
  var acctAvatarLg = document.getElementById('acctAvatarLg');
  var acctDropEmail = document.getElementById('acctDropEmail');
  var acctDropRole = document.getElementById('acctDropRole');
  var apiKeyGate = document.getElementById('apiKeyGate');

  // Account button toggles account tab — click again to go back to chat
  if (acctBtn) acctBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var rsidebar = document.getElementById('rsidebar');
    var acctPnl = document.getElementById('rp-account');
    // If account panel is already open, close sidebar to return to chat
    if (rsidebar && rsidebar.classList.contains('open') && acctPnl && acctPnl.classList.contains('active')) {
      rsidebar.classList.remove('open');
      document.querySelectorAll('.rs-icon').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.rs-pnl').forEach(function (p) { p.classList.remove('active'); });
      return;
    }
    // Otherwise open sidebar and activate account tab
    if (rsidebar) rsidebar.classList.add('open');
    document.querySelectorAll('.rs-icon').forEach(function (b) { b.classList.remove('active'); });
    var acctTabBtn = document.querySelector('.rs-icon[data-rs="account"]');
    if (acctTabBtn) acctTabBtn.classList.add('active');
    document.querySelectorAll('.rs-pnl').forEach(function (p) { p.classList.remove('active'); });
    if (acctPnl) acctPnl.classList.add('active');
  });

  function showAuthError(msg) {
    // Show in whichever form is currently visible
    var inLogin = loginForm && loginForm.style.display !== 'none';
    var el = inLogin ? authError : authError2;
    var elOk = inLogin ? authOk : authOk2;
    if (el) { el.textContent = msg; }
    if (elOk) { elOk.textContent = ''; }
  }
  function showAuthOk(msg) {
    var inLogin = loginForm && loginForm.style.display !== 'none';
    var el = inLogin ? authOk : authOk2;
    var elErr = inLogin ? authError : authError2;
    if (el) { el.textContent = msg; }
    if (elErr) { elErr.textContent = ''; }
  }
  function clearAuthMessages() {
    [authError, authOk, authError2, authOk2].forEach(function(el) { if (el) el.textContent = ''; });
  }
  function showLoginState() {
    if (registerForm) registerForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
  }

  function showRegPendingState(requestId, message) {
    // Hide both forms and show a pending-approval notice inside the auth screen
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    var existingPanel = document.getElementById('regPendingPanel');
    if (existingPanel) existingPanel.remove();
    var panel = document.createElement('div');
    panel.id = 'regPendingPanel';
    panel.style.cssText = 'padding:20px 16px;text-align:center;';
    panel.innerHTML = '<div style="font-size:2rem;margin-bottom:12px">⏳</div>'
      + '<div style="font-weight:600;font-size:1rem;margin-bottom:8px">Waiting for Admin Approval</div>'
      + '<div style="font-size:0.82rem;color:var(--vscode-descriptionForeground);margin-bottom:16px">' + (message || 'Your registration is pending.') + '</div>'
      + (requestId ? '<div style="font-size:0.72rem;color:var(--vscode-descriptionForeground);font-family:monospace;margin-bottom:16px">Request ID: ' + requestId + '</div>' : '')
      + '<div id="regPendingStatus" style="font-size:0.82rem;margin-bottom:12px;min-height:18px"></div>'
      + '<button id="regBackBtn" style="background:none;border:1px solid var(--vscode-button-border,#555);border-radius:6px;color:var(--vscode-foreground);cursor:pointer;padding:6px 16px;font-size:0.82rem">Back to Login</button>';
    var authCard = document.querySelector('.auth-card') || (authScreen && authScreen.firstElementChild) || authScreen;
    if (authCard) authCard.appendChild(panel);
    var backBtn = document.getElementById('regBackBtn');
    if (backBtn) backBtn.addEventListener('click', function() {
      panel.remove();
      showLoginState();
    });
  }

  function showAuthStatus(msg, type) {
    // Update the reg-pending status line if visible, otherwise use authOk/authError
    var statusEl = document.getElementById('regPendingStatus');
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = type === 'ok' ? 'var(--vscode-testing-iconPassed,#4caf50)' : type === 'err' ? 'var(--vscode-testing-iconFailed,#f44336)' : 'var(--vscode-descriptionForeground)';
    } else {
      if (type === 'err') showAuthError(msg);
      else showAuthOk(msg);
    }
  }

  // Show login form / hide register form
  var showRegBtn = document.getElementById('showRegBtn');
  var showLoginBtn = document.getElementById('showLoginBtn');
  if (showRegBtn) showRegBtn.addEventListener('click', function () {
    clearAuthMessages();
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'block';
  });
  if (showLoginBtn) showLoginBtn.addEventListener('click', function () {
    clearAuthMessages();
    if (registerForm) registerForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
  });

  // Login button
  var loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', function () {
    var email = (document.getElementById('authEmail') || {}).value || '';
    var pass = (document.getElementById('authPass') || {}).value || '';
    if (!email || !pass) { showAuthError('Please enter email and password'); return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    clearAuthMessages();
    vs.postMessage({ type: 'login', email: email.trim(), password: pass });
  });

  // Register button
  var regBtn = document.getElementById('regBtn');
  if (regBtn) regBtn.addEventListener('click', function () {
    var name = (document.getElementById('regName') || {}).value || '';
    var email = (document.getElementById('regEmail') || {}).value || '';
    var pass = (document.getElementById('regPass') || {}).value || '';
    if (!email || !pass) { showAuthError('Please enter email and password'); return; }
    if (pass.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
    regBtn.disabled = true;
    regBtn.textContent = 'Registering...';
    clearAuthMessages();
    vs.postMessage({ type: 'register', email: email.trim(), password: pass, fullName: name.trim() || undefined });
  });

  // Logout button (inside account sidebar panel)
  if (logoutBtn) logoutBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'logout' });
  });

  // Enter key on login fields
  var authPassEl = document.getElementById('authPass');
  if (authPassEl) authPassEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && loginBtn) loginBtn.click();
  });
  var regPassEl = document.getElementById('regPass');
  if (regPassEl) regPassEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && regBtn) regBtn.click();
  });

  // ── Profile section ─────────────────────────────────────────────
  var saveProfileBtn = document.getElementById('saveProfileBtn');
  var profileNameEl = document.getElementById('profileName');
  var profileInfoEl = document.getElementById('profileInfo');
  var profileMsgEl = document.getElementById('profileMsg');
  var userApiKeyEl = document.getElementById('userApiKey');
  var saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
  var apiKeyMsgEl = document.getElementById('apiKeyMsg');
  var apiKeyListEl = document.getElementById('apiKeyList');
  var activeKeyDisplayEl = document.getElementById('activeKeyDisplay');
  var activeKeyFieldEl = document.getElementById('activeKeyField');
  var activeKeyMetaEl = document.getElementById('activeKeyMeta');
  var activeKeyToggleBtn = document.getElementById('activeKeyToggle');
  var apiKeyStatusEl = document.getElementById('apiKeyStatus');
  var apiKeyInputArea = document.getElementById('apiKeyInputArea');

  // Gate page elements (Codex-style)
  var gateApiKeyEl = document.getElementById('gateApiKey');
  var gateSaveBtn = document.getElementById('gateSaveBtn');
  var gateStatusEl = document.getElementById('gateStatus');
  var gateLogoutBtn = document.getElementById('gateLogout');
  var gateErrorEl = document.getElementById('gateError');
  var gateOkEl = document.getElementById('gateOk');
  var gateCheckStatusBtn = document.getElementById('gateCheckStatus');

  function updateProfileUI(user) {
    if (user) {
      if (profileNameEl) profileNameEl.value = user.fullName || '';
      var initial = (user.fullName || user.email || '?').charAt(0).toUpperCase();
      if (acctInitials) acctInitials.textContent = initial;
      if (acctAvatarLg) acctAvatarLg.textContent = initial;
      if (acctDropEmail) acctDropEmail.textContent = user.email || '';
      if (acctDropRole) acctDropRole.textContent = (user.roleName || user.role || 'user');
    } else {
      if (profileNameEl) profileNameEl.value = '';
      if (acctInitials) acctInitials.textContent = '?';
      if (acctAvatarLg) acctAvatarLg.textContent = '?';
      if (acctDropEmail) acctDropEmail.textContent = '';
      if (acctDropRole) acctDropRole.textContent = '';
    }
    if (profileMsgEl) profileMsgEl.style.display = 'none';
  }

  function showProfileMsg(msg, type) {
    profileMsgEl.textContent = msg;
    profileMsgEl.style.display = 'block';
    profileMsgEl.style.color = type === 'ok' ? 'var(--vscode-testing-iconPassed, #4caf50)' : 'var(--vscode-testing-iconFailed, #f44336)';
    setTimeout(function() { if (profileMsgEl) profileMsgEl.style.display = 'none'; }, 4000);
  }

  function showApiKeyMsg(msg, type) {
    if (!apiKeyMsgEl) return;
    apiKeyMsgEl.textContent = msg;
    apiKeyMsgEl.style.display = 'block';
    apiKeyMsgEl.style.color = type === 'ok' ? 'var(--vscode-testing-iconPassed, #4caf50)' : 'var(--vscode-testing-iconFailed, #f44336)';
    setTimeout(function () { if (apiKeyMsgEl) apiKeyMsgEl.style.display = 'none'; }, 5000);
  }

  // Active key display — shows the full key in a masked field with show/hide
  function updateActiveKeyDisplay(fullKey) {
    if (!activeKeyDisplayEl || !activeKeyFieldEl) return;
    if (!fullKey) {
      activeKeyDisplayEl.style.display = 'none';
      return;
    }
    activeKeyDisplayEl.style.display = 'block';
    activeKeyFieldEl.value = fullKey;
    activeKeyFieldEl.classList.add('masked');
    if (activeKeyToggleBtn) activeKeyToggleBtn.classList.remove('active');
  }

  // Toggle active key visibility
  if (activeKeyToggleBtn && activeKeyFieldEl) {
    activeKeyToggleBtn.addEventListener('click', function () {
      var isMasked = activeKeyFieldEl.classList.contains('masked');
      activeKeyFieldEl.classList.toggle('masked', !isMasked);
      activeKeyToggleBtn.classList.toggle('active', isMasked);
      activeKeyToggleBtn.title = isMasked ? 'Hide key' : 'Show key';
    });
  }

  function renderApiKeys(keys) {
    if (!apiKeyListEl) return;
    if (!keys || !keys.length) {
      apiKeyListEl.innerHTML = 'No API key saved yet.';
      if (activeKeyDisplayEl) activeKeyDisplayEl.style.display = 'none';
      if (apiKeyStatusEl) apiKeyStatusEl.style.display = 'none';
      if (apiKeyInputArea) apiKeyInputArea.style.display = '';
      return;
    }
    var active = keys.filter(function (k) { return k.status === 'active'; });
    var latest = active.length ? active[0] : keys[0];
    var isVerified = latest.adminVerified === true;
    var html = '';

    // Show status badge
    if (apiKeyStatusEl) {
      if (isVerified) {
        apiKeyStatusEl.style.display = 'block';
        apiKeyStatusEl.style.background = 'rgba(76,175,80,0.12)';
        apiKeyStatusEl.style.color = 'var(--vscode-testing-iconPassed, #4caf50)';
        apiKeyStatusEl.style.border = '1px solid rgba(76,175,80,0.3)';
        apiKeyStatusEl.textContent = t('keyVerifiedActive');
      } else {
        apiKeyStatusEl.style.display = 'block';
        apiKeyStatusEl.style.background = 'rgba(255,152,0,0.12)';
        apiKeyStatusEl.style.color = 'var(--vscode-editorWarning-foreground, #ff9800)';
        apiKeyStatusEl.style.border = '1px solid rgba(255,152,0,0.3)';
        apiKeyStatusEl.textContent = t('pendingAdminVerify');
      }
    }

    // Show saved date
    if (latest.createdAt) {
      html += '<div style="margin-bottom:6px;font-size:11px;color:var(--mt)">' + t('saved') + ': ' + new Date(latest.createdAt).toLocaleString() + '</div>';
    }
    if (latest.keyPreview) {
      html += '<div style="margin-bottom:6px;font-size:11px;color:var(--mt)">' + t('key') + ': ' + latest.keyPreview + '</div>';
    }

    // If verified: hide input, show Rotate Key button
    // If pending: hide input, show Cancel/Enter New Key option
    if (isVerified) {
      if (apiKeyInputArea) apiKeyInputArea.style.display = 'none';
      html += '<button class="auth-btn secondary" id="rotateApiKeyBtn" style="font-size:12px;padding:6px 0">' + t('rotateChangeKey') + '</button>';
    } else {
      if (apiKeyInputArea) apiKeyInputArea.style.display = 'none';
      html += '<button class="auth-btn secondary" id="changeApiKeyBtn" style="font-size:12px;padding:6px 0;margin-top:4px">' + t('enterDifferentKey') + '</button>';
    }

    apiKeyListEl.innerHTML = html;

    var rotateBtn = document.getElementById('rotateApiKeyBtn');
    if (rotateBtn) {
      rotateBtn.addEventListener('click', function () {
        // Show input area for entering a new key
        if (apiKeyInputArea) apiKeyInputArea.style.display = '';
        if (userApiKeyEl) { userApiKeyEl.value = ''; userApiKeyEl.focus(); }
        if (saveApiKeyBtn) saveApiKeyBtn.textContent = t('saveNewKey');
        rotateBtn.style.display = 'none';
      });
    }

    var changeBtn = document.getElementById('changeApiKeyBtn');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        // Revoke old and show input
        vs.postMessage({ type: 'revokeApiKey', keyId: latest.id });
      });
    }

    // Fetch the full key for the active key display
    if (active.length) {
      vs.postMessage({ type: 'getActiveKey' });
    }
  }

  if (saveProfileBtn) saveProfileBtn.addEventListener('click', function () {
    var name = profileNameEl ? profileNameEl.value.trim() : '';
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = 'Saving...';
    vs.postMessage({ type: 'updateProfile', fullName: name });
    setTimeout(function() { saveProfileBtn.disabled = false; saveProfileBtn.textContent = 'Save Name'; }, 2000);
  });

  if (profileNameEl) profileNameEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && saveProfileBtn) saveProfileBtn.click();
  });

  if (saveApiKeyBtn) saveApiKeyBtn.addEventListener('click', function () {
    var apiKey = userApiKeyEl ? userApiKeyEl.value.trim() : '';
    if (!apiKey) { showApiKeyMsg('Enter your vLLM API key first', 'err'); return; }
    saveApiKeyBtn.disabled = true;
    saveApiKeyBtn.textContent = 'Saving...';
    vs.postMessage({ type: 'saveApiKey', apiKey: apiKey, displayName: 'Infra vLLM Key' });
  });

  // ── Gate page (Codex-style) handlers ──────────────────────────

  function showGateStatus(msg, type) {
    if (gateStatusEl) {
      gateStatusEl.textContent = msg;
      gateStatusEl.className = 'gate-status ' + (type || '');
    }
    // Also use gateError/gateOk for prominent messages
    if (type === 'err' && gateErrorEl) { gateErrorEl.textContent = msg; if (gateOkEl) gateOkEl.textContent = ''; }
    else if (type === 'ok' && gateOkEl) { gateOkEl.textContent = msg; if (gateErrorEl) gateErrorEl.textContent = ''; }
    else { if (gateErrorEl) gateErrorEl.textContent = ''; if (gateOkEl) gateOkEl.textContent = ''; }
    // Show check-status button when key is pending verification
    if (gateCheckStatusBtn) {
      gateCheckStatusBtn.style.display = (type === 'pending') ? 'block' : 'none';
      gateCheckStatusBtn.disabled = false;
      gateCheckStatusBtn.textContent = 'Check Verification Status';
    }
  }

  // Enable/disable OK button based on input
  if (gateApiKeyEl && gateSaveBtn) {
    gateApiKeyEl.addEventListener('input', function () {
      var hasVal = gateApiKeyEl.value.trim().length > 0;
      gateSaveBtn.classList.toggle('ready', hasVal);
    });
  }

  // Gate OK button saves the key
  if (gateSaveBtn) gateSaveBtn.addEventListener('click', function () {
    var apiKey = gateApiKeyEl ? gateApiKeyEl.value.trim() : '';
    if (!apiKey) { showGateStatus('Enter your vLLM API key first', 'err'); return; }
    gateSaveBtn.disabled = true;
    gateSaveBtn.textContent = 'Saving...';
    vs.postMessage({ type: 'saveApiKey', apiKey: apiKey, displayName: 'Infra vLLM Key' });
  });

  // Gate sign-out button
  if (gateLogoutBtn) gateLogoutBtn.addEventListener('click', function () {
    vs.postMessage({ type: 'logout' });
  });

  // Gate check-status button — re-checks auth without signing out
  if (gateCheckStatusBtn) gateCheckStatusBtn.addEventListener('click', function () {
    gateCheckStatusBtn.disabled = true;
    gateCheckStatusBtn.textContent = 'Checking...';
    showGateStatus('Checking verification status...', 'pending');
    vs.postMessage({ type: 'checkAuth' });
    // Re-enable after a timeout in case no response
    setTimeout(function () {
      if (gateCheckStatusBtn) { gateCheckStatusBtn.disabled = false; gateCheckStatusBtn.textContent = 'Check Verification Status'; }
    }, 5000);
  });

  // Enter key on gate page input
  if (gateApiKeyEl) gateApiKeyEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && gateSaveBtn) gateSaveBtn.click();
  });

  // API key show/hide toggles (account panel)
  function setupKeyToggle(toggleBtn, inputEl) {
    if (!toggleBtn || !inputEl) return;
    toggleBtn.addEventListener('click', function () {
      var isPassword = inputEl.type === 'password';
      inputEl.type = isPassword ? 'text' : 'password';
      toggleBtn.classList.toggle('active', isPassword);
      toggleBtn.title = isPassword ? 'Hide key' : 'Show key';
    });
  }
  setupKeyToggle(document.getElementById('acctKeyToggle'), userApiKeyEl);
  setupKeyToggle(document.getElementById('gateKeyToggle'), gateApiKeyEl);

  // ── Connection status dot in topbar ───────────────────────────
  (function () {
    var titleEl = document.getElementById('topbarTitle');
    if (!titleEl) return;
    var dot = document.createElement('span');
    dot.id = 'connDot';
    dot.className = 'conn-dot checking';
    dot.title = 'Checking connection...';
    dot.style.cssText = 'margin-left:6px;vertical-align:middle;display:inline-block;';
    titleEl.parentNode.insertBefore(dot, titleEl.nextSibling);
    // Will be updated when we receive 'init' or 'modelsData' messages
    window._setConnStatus = function (online) {
      dot.className = 'conn-dot ' + (online ? 'online' : 'offline');
      dot.title = online ? 'Connected to platform' : 'Platform offline';
    };
  })();

  // Signal ready to extension
  vs.postMessage({ type: 'ready' });

})();
