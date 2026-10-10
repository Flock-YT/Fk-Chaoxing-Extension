// In-page assistant. The AI-practice conversation in dialogue.js has its own port and state.
const AIChat = {
  root: null, questions: [], history: [], pending: null, extracting: false, port: null, selected: new Set(),
  frameQuestions: new Map(), remoteWindows: new Map(), replies: new Map(), scanToken: '',
  quickEffort: null, historyKey: '', opening: null, frameId: `${Date.now()}-${Math.random()}`, launcher: null,
  pageKey() { return `aiChat:${location.origin}${location.pathname}${location.search}`; },
  el(id) { return this.root?.getElementById(id); },
  clampPosition() {
    const host = this.root?.host;
    if (!host || host.classList.contains('expanded')) return;
    const rect = host.getBoundingClientRect();
    if (rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight) return;
    host.style.left = `${Math.max(0, Math.min(innerWidth - rect.width, rect.left))}px`;
    host.style.top = `${Math.max(0, Math.min(innerHeight - rect.height, rect.top))}px`;
    host.style.right = 'auto'; host.style.bottom = 'auto';
  },
  bindDragging(header) {
    const host = this.root.host;
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button, select, label') || host.classList.contains('expanded')) return;
      const rect = host.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      header.setPointerCapture(event.pointerId);
      const move = next => {
        const bounds = host.getBoundingClientRect();
        host.style.left = `${Math.max(0, Math.min(innerWidth - bounds.width, start.left + next.clientX - start.x))}px`;
        host.style.top = `${Math.max(0, Math.min(innerHeight - bounds.height, start.top + next.clientY - start.y))}px`;
        host.style.right = 'auto'; host.style.bottom = 'auto';
      };
      const end = () => {
        header.removeEventListener('pointermove', move);
        header.removeEventListener('pointerup', end);
        header.removeEventListener('lostpointercapture', end);
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', end);
      header.addEventListener('lostpointercapture', end);
    });
    window.addEventListener('resize', () => this.clampPosition());
  },
  init() {
    if (window !== window.top) return;
    this.mountLauncher();
    const check = async () => {
      if (this.root) { observer.disconnect(); return; }
      if (this.opening) return;
      this.opening = this.scanQuestions();
      try {
        await this.opening;
        if (this.questions.length) { await this.open(true); observer.disconnect(); }
      } catch (_) { /* The question frame may still be loading. */ }
      finally { this.opening = null; }
    };
    const observer = new MutationObserver(() => {
      clearTimeout(this.initTimer);
      this.initTimer = setTimeout(check, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('load', event => { if (event.target?.tagName === 'IFRAME') check(); }, true);
    check();
  },
  mountLauncher() {
    if (this.launcher) return;
    const host = document.createElement('div');
    host.id = 'fk-ai-chat-launcher';
    host.style.cssText = 'position:fixed!important;right:24px!important;bottom:24px!important;z-index:2147483641!important;width:48px!important;height:48px!important;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host([hidden]){display:none!important}button{display:flex;align-items:center;justify-content:center;width:48px;height:48px;padding:8px;border:1px solid #d8dadd;border-radius:12px;background:white;cursor:pointer;box-shadow:0 2px 8px #0002}button:hover{background:#f3f4f6}button:focus-visible{outline:2px solid #70757a;outline-offset:2px}img{width:32px;height:32px;object-fit:contain}</style><button title="打开 AI 对话" aria-label="打开 AI 对话"><img src="${chrome.runtime.getURL('icons/chaoxing.png')}" alt="超星"></button>`;
    root.querySelector('button').onclick = () => this.open().catch(error => this.task(error.message, 'error'));
    document.body.append(host);
    this.launcher = host;
  },
  async open(automatic = false) {
    if (window !== window.top) return;
    if (!this.root) this.mount();
    this.root.host.hidden = false;
    if (this.launcher) this.launcher.hidden = true;
    if (!automatic && this.root.host.classList.contains('minimized')) this.el('minimize').click();
    if (this.pending) { if (!automatic) this.el('input').focus(); return; }
    const key = this.pageKey();
    const data = await chrome.storage.local.get(key);
    if (this.historyKey !== key) {
      this.historyKey = key;
      this.history = Array.isArray(data[key]) ? data[key].slice(-60) : [];
    }
    this.renderHistory();
    await this.refresh();
    if (!automatic) this.el('input').focus();
  },
  mount() {
    const host = document.createElement('div');
    host.id = 'fk-ai-chat';
    document.body.append(host);
    this.root = host.attachShadow({ mode: 'open' });
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = chrome.runtime.getURL('modules/ai-answer/chat.css');
    this.root.append(css);
    const panel = document.createElement('section');
    panel.className = 'shell';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'AI 对话');
    panel.innerHTML = `<header><strong>AI 对话</strong><select id="model-select" aria-label="当前模型" title="当前模型"></select>
      <label class="effort-label" for="effort">思考等级</label><select id="effort" aria-label="思考等级">
      <option value="">模型默认</option><option value="none">不思考</option><option value="low">Low</option>
      <option value="medium">Medium</option><option value="high">High</option><option value="xhigh">XHigh</option><option value="max">Max</option></select>
      <button id="minimize" title="收起对话" aria-label="收起对话" aria-expanded="true">−</button>
      <button id="maximize" title="放大对话" aria-label="放大对话" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1"/></svg></button><button id="close" title="关闭" aria-label="关闭">×</button></header>
      <div class="layout"><main><div id="feed" aria-live="polite"></div><div class="composer">
      <details id="question-panel"><summary id="context-summary">引用题目</summary>
      <div class="context-tools"><label class="all"><input type="checkbox" id="all" checked>整页题目</label><button id="refresh">刷新题目</button></div>
      <div id="questions"></div><div class="target-row"><label for="target">作答目标</label><select id="target"><option value="all">所选全部题目</option></select></div>
      <p id="context-note"></p>
      <details id="preview-panel"><summary>查看发送内容</summary><pre id="preview-text"></pre></details></details>
      <div id="references"></div><textarea id="input" rows="3" placeholder="询问题目，或描述希望怎样作答…"></textarea>
      <div class="actions"><label><input id="auto" type="checkbox">自动写入</label><button id="preview">预览</button><button id="regenerate" title="重新生成上一轮回复">重新生成</button><button id="stop" hidden>停止</button><button id="chat">发送</button><button id="answer">生成答案</button></div><div id="status" role="status" hidden></div></main></div>`;
    this.root.append(panel);
    this.el('minimize').onclick = () => {
      const minimized = host.classList.toggle('minimized');
      this.el('minimize').textContent = minimized ? '+' : '−';
      this.el('minimize').setAttribute('aria-expanded', String(!minimized));
      this.el('minimize').title = minimized ? '展开对话' : '收起对话';
      this.el('minimize').setAttribute('aria-label', this.el('minimize').title);
      this.clampPosition();
    };
    this.el('maximize').onclick = () => {
      if (host.classList.contains('minimized')) this.el('minimize').click();
      const expanded = host.classList.toggle('expanded');
      this.el('maximize').innerHTML = expanded
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V4h12v12h-4"/><rect x="4" y="8" width="12" height="12" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>';
      this.el('maximize').setAttribute('aria-pressed', String(expanded));
      this.el('maximize').title = expanded ? '还原对话大小' : '放大对话';
      this.el('maximize').setAttribute('aria-label', this.el('maximize').title);
      this.clampPosition();
    };
    this.el('close').onclick = () => { host.hidden = true; if (this.launcher) this.launcher.hidden = false; };
    this.bindDragging(panel.querySelector('header'));
    this.el('refresh').onclick = () => this.refresh();
    this.el('model-select').onchange = async event => {
      await chrome.storage.local.set({ activeAiProfileId: event.target.value });
      this.quickEffort = null;
      const config = await AIApi.loadConfig();
      this.el('effort').value = config.reasoningEffort;
    };
    this.el('effort').onchange = event => { this.quickEffort = event.target.value; };
    this.el('all').onchange = event => {
      this.selected = event.target.checked
        ? new Set(this.questions.map((_, index) => index)) : new Set();
      this.renderQuestions();
    };
    this.el('target').onchange = () => this.updateContextSummary();
    this.el('chat').onclick = () => this.send('chat');
    this.el('answer').onclick = () => this.send('answer');
    this.el('input').onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault(); this.send('chat');
      }
    };
    this.el('regenerate').onclick = () => this.regenerate();
    this.el('preview').onclick = async () => {
      const config = await AIApi.loadConfig();
      const context = this.chosen().map(q => this.snapshot(q));
      const target = this.targets(this.chosen()).map(q => this.snapshot(q));
      this.el('preview-text').textContent = JSON.stringify(this.messages(config, {
        input: this.el('input').value.trim(), context, target, preview: true
      }), null, 2);
      this.el('question-panel').open = true;
      this.el('preview-panel').open = true;
    };
    this.el('stop').onclick = () => this.port?.postMessage({ type: 'cancel' });
    this.el('auto').onchange = async event => chrome.storage.local.set({ autoApplyAnswers: event.target.checked });
    chrome.storage.local.get('autoApplyAnswers').then(data => { this.el('auto').checked = data.autoApplyAnswers === true; });
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local' || !this.root) return;
      if (changes.autoApplyAnswers) this.el('auto').checked = changes.autoApplyAnswers.newValue === true;
      if (changes.activeAiProfileId || changes.aiProfiles) {
        await this.loadModels();
      }
    });
  },
  async refresh() {
    if (this.pending || this.extracting) return;
    await this.scanQuestions();
    this.selected = new Set(this.questions.map((_, index) => index));
    this.renderQuestions();
    const config = await AIApi.loadConfig();
    this.el('effort').value = this.quickEffort ?? config.reasoningEffort;
    await this.loadModels();
  },
  async scanQuestions() {
    this.scanToken = `${Date.now()}-${Math.random()}`;
    this.questions = QuestionContainers.find(document).map(container =>
      AIAnswerCore.parseQuestionContainer(container, document, QuestionCollector.findHeaderTitle(document) || document.title || '')
    ).filter(Boolean);
    this.frameQuestions.clear(); this.remoteWindows.clear();
    document.querySelectorAll('iframe').forEach(frame => frame.contentWindow?.postMessage({ fkAiChat: 'scan', token: this.scanToken, topOrigin: location.origin }, '*'));
    await new Promise(resolve => setTimeout(resolve, 350));
    this.questions.forEach((q, index) => { q.index = index + 1; q.editorState ??= this.editorState(q); });
  },
  async loadModels() {
    const data = await chrome.storage.local.get(['aiProfiles', 'activeAiProfileId', 'aiConfig']);
    const profiles = Array.isArray(data.aiProfiles) && data.aiProfiles.length
      ? data.aiProfiles : (data.aiConfig ? [data.aiConfig] : []);
    const select = this.el('model-select');
    select.replaceChildren();
    for (const profile of profiles) {
      const label = `${profile.name || '未命名模型'}:${profile.model || '未配置 ID'}`;
      select.append(new Option(label, profile.id || 'default'));
    }
    if (!profiles.length) select.append(new Option('未配置模型', ''));
    const active = profiles.find(profile => profile.id === data.activeAiProfileId) || profiles[0];
    select.value = active?.id || (active ? 'default' : '');
    select.title = active ? `${active.name || '未命名模型'}:${active.model || '未配置 ID'}` : '未配置模型';
  },
  modelLabel(config) {
    return `${config.name || '未命名模型'}:${config.model || '未配置 ID'}`;
  },
  renderQuestions() {
    const list = this.el('questions');
    const target = this.el('target');
    const previousTarget = target.value;
    list.replaceChildren();
    target.replaceChildren(new Option('所选全部题目', 'all'));
    this.questions.forEach((q, index) => {
      const row = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox'; check.value = index;
      check.checked = this.el('all').checked || this.selected.has(index);
      check.disabled = this.el('all').checked;
      check.onchange = () => {
        check.checked ? this.selected.add(index) : this.selected.delete(index);
        this.updateContextSummary();
      };
      const codeNote = q.type === 'programming' && q.codeStatus !== 'read' ? '（未读取到答题区代码）' : '';
      row.append(check, document.createTextNode(`${index + 1}. ${q.title}${codeNote}`));
      list.append(row);
      target.append(new Option(`${index + 1}. ${q.title.slice(0, 28)}`, String(index)));
    });
    if (Array.from(target.options).some(option => option.value === previousTarget)) target.value = previousTarget;
    this.el('context-note').textContent = `${this.questions.length} 道题；程序题会附带答题区现有代码，无法读取时会明确标注。`;
    this.updateContextSummary();
  },
  updateContextSummary() {
    const count = this.el('all').checked ? this.questions.length : this.selected.size;
    this.el('context-summary').textContent = count ? '编辑题目引用' : '＋ 引用题目';
    this.el('references').replaceChildren();
    const context = this.chosen().map(q => this.snapshot(q));
    if (context.length) this.el('references').append(this.reference(context, this.targets(this.chosen()), true));
  },
  chosen() { return this.questions.filter((_, index) => this.el('all').checked || this.selected.has(index)); },
  targets(context) {
    const value = this.el('target').value;
    return value === 'all' ? context : [this.questions[Number(value)]].filter(Boolean);
  },
  snapshot(q) {
    return { id: q.id, index: q.index, type: q.type, title: q.title, options: q.options, blankCount: q.blankCount,
      existingAnswer: q.existingAnswer,
      answerDraft: q.type === 'programming' ? q.answerDraft : undefined,
      codeStatus: q.type === 'programming' ? q.codeStatus : undefined, matchingGroups: q.matchingGroups, sortingLabels: q.sortingLabels };
  },
  editorState(q) {
    if (q.remote) return q.editorState;
    // Compare answer content, not UEditor's asynchronously synchronized backing textarea.
    const current = AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader);
    return JSON.stringify(current?.existingAnswer ?? null);
  },
  async persist() { await chrome.storage.local.set({ [this.pageKey()]: this.history.slice(-60) }); },
  renderHistory() {
    const feed = this.el('feed'); feed.replaceChildren();
    this.history.forEach(item => {
      const bubble = this.addBubble(item.role, item.text, item.modelLabel ||
        (item.role === 'assistant' ? 'AI · 旧记录未保存模型' : ''), item.request);
      if (item.role === 'assistant' && item.thought) this.addThought(bubble, item.thought, false);
    });
    if (!this.history.length) {
      const empty = document.createElement('p'); empty.className = 'empty-state';
      empty.textContent = '引用本页题目，询问答案、解析或解题方法。'; feed.append(empty);
    }
  },
  reference(context, target = [], removable = false, scope) {
    const wrapper = document.createElement('div'); wrapper.className = 'reference';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const indices = context.map(q => q.index).join('、');
    const all = scope ? scope === 'all' : this.el('all').checked;
    summary.textContent = `▤ ${all ? `全部题目 · ${context.length} 题` : `第 ${indices} 题 · ${context.length === 1 ? '单题' : `已选 ${context.length} 题`}`}`;
    const content = document.createElement('div'); content.className = 'reference-content';
    for (const q of context) {
      const line = document.createElement('p');
      line.textContent = `第 ${q.index} 题 · ${this.typeLabel(q.type)}\n${q.title}`;
      content.append(line);
    }
    if (target.length) {
      const hint = document.createElement('p');
      hint.textContent = `作答目标：第 ${target.map(q => q.index).join('、')} 题`;
      content.append(hint);
    }
    details.append(summary, content); wrapper.append(details);
    if (removable) {
      const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', '移除题目引用');
      remove.onclick = () => { this.el('all').checked = false; this.selected.clear(); this.el('target').value = 'all'; this.renderQuestions(); };
      wrapper.append(remove);
    }
    return wrapper;
  },
  typeLabel(type) { return ({ single_choice: '单选题', multiple_choice: '多选题', fill_blank: '填空题', short_answer: '简答题', programming: '程序题', sorting: '排序题', matching: '连线题' })[type] || type; },
  addThought(bubble, text = '', open = true) {
    const entry = document.createElement('details'); entry.className = 'thought-entry'; entry.open = open;
    const label = document.createElement('summary'); label.textContent = open ? '正在思考…' : '思考过程';
    const body = document.createElement('pre'); body.textContent = text;
    entry.append(label, body); bubble.box.insertBefore(entry, bubble.body);
    return { body, entry, label };
  },
  addBubble(role, text, modelLabel = '', request) {
    this.el('feed').querySelector('.empty-state')?.remove();
    const box = document.createElement('article'); box.className = `message ${role}`;
    const name = document.createElement('b'); name.textContent = modelLabel || 'AI';
    const body = document.createElement('pre'); body.textContent = text || '';
    if (role === 'assistant') box.append(name);
    if (role === 'user' && request?.context?.length) box.append(this.reference(request.context, request.mode === 'answer' ? request.target : [], false, request.contextScope || 'selected'));
    box.append(body); this.el('feed').append(box); box.scrollIntoView({ block: 'end' });
    return { box, body };
  },
  async send(mode, prior) {
    if (this.pending || this.extracting) return;
    const context = JSON.parse(JSON.stringify(prior?.context || this.chosen().map(q => this.snapshot(q))));
    const target = JSON.parse(JSON.stringify(prior?.target || this.targets(this.chosen()).map(q => this.snapshot(q))));
    const input = prior?.input ?? this.el('input').value.trim();
    if (!input && !context.length && mode === 'chat') return;
    if (mode === 'answer' && !target.length) return this.task('请先选择作答目标', 'error');
    const config = await AIApi.loadConfig();
    if (this.quickEffort !== null) config.reasoningEffort = this.quickEffort;
    try { AIApi.validateConfig(config); } catch (error) { return this.task(error.message, 'error'); }
    const request = { mode, input, context, target, autoApply: prior?.autoApply ?? this.el('auto').checked,
      contextScope: prior?.contextScope || (this.el('all').checked ? 'all' : 'selected'), configId: config.id, regenerate: Boolean(prior) };
    this.el('status').hidden = true;
    if (!prior) { this.history.push({ role: 'user', text: input || '请解答所选题目', request }); this.addBubble('user', input || '请解答所选题目', '', request); this.el('input').value = ''; await this.persist(); }
    const modelLabel = this.modelLabel(config);
    const assistant = this.addBubble('assistant', '', modelLabel);
    const thoughtView = this.addThought(assistant, config.reasoningEffort === 'none'
      ? '当前选择不思考；若模型仍返回可展示内容，会实时显示在这里。'
      : '正在等待模型返回思考内容…');
    const thoughtBody = thoughtView.body;
    this.pending = { request, assistant, thoughtBody, thoughtView, text: '', thought: '' };
    this.setBusy(true);
    const messages = this.messages(config, request);
    const port = chrome.runtime.connect({ name: 'AI_CHAT_STREAM' }); this.port = port;
    port.onMessage.addListener(async message => {
      if (!this.pending || this.port !== port) return;
      if (message.type === 'delta') { if (!this.pending.text) this.finishThought(this.pending); this.pending.text += message.delta; assistant.body.textContent = this.pending.text; assistant.box.scrollIntoView({ block: 'end' }); }
      if (message.type === 'thought') {
        this.pending.thought += message.delta;
        this.pending.thoughtBody.textContent = this.pending.thought;
        this.pending.thoughtBody.parentElement.scrollIntoView({ block: 'end' });
      }
      if (message.type === 'done') {
        this.finishThought(this.pending);
        const done = this.pending;
        const shouldExtract = mode === 'answer' || (request.autoApply && request.context.length && request.target.length);
        this.pending = null; this.port = null; this.extracting = shouldExtract;
        this.setBusy(shouldExtract, false); port.disconnect();
        if (!done.thought) done.thoughtBody.textContent = '模型未返回可展示的思考过程。';
        this.history.push({ role: 'assistant', text: done.text, thought: done.thought,
          modelLabel, reasoningEffort: config.reasoningEffort }); await this.persist();
        if (shouldExtract) await this.extractAndOffer(done.text, request, config);
      }
      if (message.type === 'error' || message.type === 'cancelled') {
        this.finishThought(this.pending);
        this.task(message.type === 'error' ? message.message : '已停止生成', 'error');
        if (!this.pending.thought) this.pending.thoughtBody.textContent = '本轮未获得思考内容。';
        this.pending = null; this.port = null; this.setBusy(false); port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port || !this.pending) return;
      this.finishThought(this.pending);
      this.task(chrome.runtime.lastError?.message || '流式连接中断，请重试', 'error');
      this.pending = null; this.port = null; this.setBusy(false);
    });
    port.postMessage({ type: 'start', messages, reasoningEffort: config.reasoningEffort, profileId: config.id });
  },
  finishThought(pending) { pending.thoughtView.entry.open = false; pending.thoughtView.label.textContent = '思考过程'; },
  messages(config, request) {
    const system = AIConfig.buildSystemPrompt(config.systemPrompt);
    const current = this.requestText(request, config.userPrompt);
    const lastUser = request.preview ? this.history.length : this.history.findLastIndex(item => item.role === 'user' && item.request);
    const recent = this.history.slice(Math.max(0, lastUser - 12), lastUser).map(item => ({ role: item.role, content: item.role === 'user' && item.request ? this.requestText(item.request) : item.text }));
    return [{ role: 'system', content: system }, ...recent, { role: 'user', content: current }];
  },
  requestText(request, userPrompt = '') {
    const scope = request.contextScope === 'all' ? '全部题目' : request.context.length === 1 ? '单题' : '勾选多题';
    const reference = request.context.length ? `${scope}，第 ${request.context.map(q => q.index).join('、')} 题` : '无题目引用';
    return `引用范围：${reference}\n题目上下文：\n${JSON.stringify(request.context, null, 2)}\n\n用户提示词：\n${userPrompt}\n\n本轮输入：\n${request.input || '请解答指定题目'}\n\n作答目标：\n${JSON.stringify(request.mode === 'answer' ? request.target : [], null, 2)}`;
  },
  async regenerate() {
    if (this.pending || this.extracting) return;
    const prior = [...this.history].reverse().find(item => item.role === 'user' && item.request)?.request;
    if (!prior) return this.task('没有可重新生成的请求', 'error');
    await this.send(prior.mode, prior);
  },
  async extractAndOffer(text, request, config) {
    this.extracting = true;
    this.setBusy(true, false);
    this.task('正在将回复提取为可校验答案，此步骤会产生一次额外请求。');
    try {
      const targets = request.target.map(s => this.questions.find(q => q.index === s.index && q.title === s.title)).filter(Boolean);
      if (targets.length !== request.target.length) throw new Error('题目已变化，请刷新后重试');
      const relatedOnly = request.mode === 'chat';
      const raw = await AIApi.getAnswers(targets, config,
        `本轮用户提问：\n${request.input || '请解答指定题目'}\n\n本轮助手回复：\n${text}`, relatedOnly);
      let entries;
      if (relatedOnly) {
        const result = JSON.parse(AIApi.stripCodeFence(raw));
        if (result.related === false || !Array.isArray(result.answers) || !result.answers.length) {
          this.task('回复未包含可写入的题目答案。'); return;
        }
        const indices = result.answers.map(item => Number(item?.questionIndex));
        if (new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || index < 1 || index > targets.length)) {
          throw new Error('AI 返回的题号不完整或重复');
        }
        entries = result.answers.map(entry => ({
          index: Number(entry.questionIndex) - 1,
          answer: AIApi.parseAnswers(JSON.stringify({ answers: [{ ...entry, questionIndex: 1 }] }), [targets[Number(entry.questionIndex) - 1]])[0]
        }));
      } else {
        entries = AIApi.parseAnswers(raw, targets).map((answer, index) => ({ index, answer }));
      }
      let written = 0;
      for (const { index, answer } of entries) {
        const q = targets[index], snap = request.target[index];
        const current = q.remote ? q : AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader);
        if (!current || current.id !== snap.id || current.title !== snap.title || current.type !== snap.type ||
            JSON.stringify(current.options) !== JSON.stringify(snap.options) ||
            JSON.stringify(current.existingAnswer) !== JSON.stringify(snap.existingAnswer) ||
            (snap.type === 'programming' && current.answerDraft !== snap.answerDraft) ||
            JSON.stringify(current.matchingGroups) !== JSON.stringify(snap.matchingGroups) || this.editorState(q) !== q.editorState) {
          this.task(`题目 ${q.index} 或答题区已变化，拒绝写入`, 'error'); continue;
        }
        const card = document.createElement('div'); card.className = 'candidate';
        const code = document.createElement('pre'); code.textContent = JSON.stringify(answer, null, 2);
        const apply = document.createElement('button'); apply.textContent = `写入题目 ${q.index}`;
        apply.onclick = async () => {
          apply.disabled = true;
          try {
            if (!q.remote) {
              const fresh = AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader);
              if (!fresh || fresh.id !== snap.id || fresh.title !== snap.title || fresh.type !== snap.type ||
                  JSON.stringify(fresh.options) !== JSON.stringify(snap.options) ||
                  JSON.stringify(fresh.existingAnswer) !== JSON.stringify(snap.existingAnswer) ||
                  (snap.type === 'programming' && fresh.answerDraft !== snap.answerDraft) ||
                  JSON.stringify(fresh.matchingGroups) !== JSON.stringify(snap.matchingGroups) || this.editorState(q) !== q.editorState) {
                throw new Error('题目或答题区已变化，请刷新后重新生成');
              }
            }
            const remoteResult = q.remote ? await this.applyRemote(q, snap, answer) : null;
            const applied = q.remote ? true : await AIAnswerCore.applyAnswerToQuestion(q, answer);
            if (!applied) throw new Error('未找到可写入的编辑器或答案控件');
            if (q.remote) {
              if (remoteResult.question) Object.assign(q, remoteResult.question);
              q.editorState = remoteResult.editorState;
            } else {
              const updated = AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader);
              if (updated) Object.assign(q, updated);
              q.editorState = this.editorState(q);
            }
            apply.textContent = '已写入';
            written += 1;
            this.task(`已写入 ${written}/${entries.length} 道题`, 'success');
          }
          catch (error) { apply.disabled = false; this.task(`题目 ${q.index} 写入失败：${error.message}`, 'error'); }
        };
        card.append(code, apply); this.el('feed').append(card);
        if (request.autoApply) await apply.onclick();
      }
      if (!request.autoApply) this.task(`已提取 ${entries.length} 道题的答案，可逐题写入。`);
    } catch (error) { this.task(`答案提取失败：${error.message}`, 'error'); }
    finally { this.extracting = false; this.setBusy(false); }
  },
  task(message, type = 'info') {
    if (!this.root) return;
    const status = this.el('status'); status.hidden = false; status.className = type; status.textContent = message;
  },
  setBusy(value, allowStop = true) {
    for (const id of ['chat', 'answer', 'regenerate', 'refresh']) this.el(id).disabled = value;
    this.el('stop').hidden = !value || !allowStop;
  },
  applyRemote(q, snap, answer) {
    const target = this.remoteWindows.get(q.remote);
    if (!target) return Promise.reject(new Error('题目所在页面已失效'));
    const id = `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.replies.delete(id); reject(new Error('iframe 写入超时')); }, 3000);
      this.replies.set(id, result => { clearTimeout(timer); result.ok ? resolve(result) : reject(new Error(result.error)); });
      target.source.postMessage({ fkAiChat: 'apply', token: this.scanToken, id, questionId: q.remote, snap,
        editorState: q.editorState, answer }, target.origin);
    });
  },
  onFrameMessage(event) {
    if (!/^https?:\/\/([^.]+\.)*chaoxing\.com(?::\d+)?$/.test(event.origin)) return;
    const msg = event.data;
    if (!msg || !msg.fkAiChat) return;
    if (msg.fkAiChat === 'scan') {
      if (window === window.top || !msg.token) return;
      this.scanToken = msg.token;
      this.frameQuestions.clear();
      const found = QuestionContainers.find(document).map(container =>
        AIAnswerCore.parseQuestionContainer(container, document, QuestionCollector.findHeaderTitle(document) || document.title || '')
      ).filter(Boolean);
      const items = found.map((q, index) => {
        const id = `${msg.token}:${this.frameId}:${index}`; this.frameQuestions.set(id, q);
        return { ...this.snapshot({ ...q, index: index + 1 }), editorState: this.editorState(q), remote: id };
      });
      window.top.postMessage({ fkAiChat: 'scanned', token: msg.token, items }, msg.topOrigin);
      document.querySelectorAll('iframe').forEach(frame => frame.contentWindow?.postMessage(msg, '*'));
    } else if (msg.fkAiChat === 'scanned' && window === window.top && msg.token === this.scanToken) {
      for (const item of msg.items || []) {
        this.remoteWindows.set(item.remote, { source: event.source, origin: event.origin });
        item.index = this.questions.length + 1;
        this.questions.push(item);
      }
      if (this.root) this.renderQuestions();
    } else if (msg.fkAiChat === 'apply' && window !== window.top && msg.token === this.scanToken) {
      const q = this.frameQuestions.get(msg.questionId);
      const current = q && AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader);
      const s = msg.snap;
      const same = current && current.id === s.id && current.title === s.title && current.type === s.type &&
        JSON.stringify(current.options) === JSON.stringify(s.options) &&
        (s.type !== 'programming' || current.answerDraft === s.answerDraft) &&
        JSON.stringify(current.matchingGroups) === JSON.stringify(s.matchingGroups) &&
        JSON.stringify(current.existingAnswer) === JSON.stringify(s.existingAnswer) &&
        this.editorState(q) === msg.editorState;
      Promise.resolve().then(() => {
        if (!same) throw new Error('题目或答题区已变化');
        return AIAnswerCore.applyAnswerToQuestion(q, msg.answer);
      }).then(ok => {
        if (ok) {
          const updated = AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader);
          if (updated) Object.assign(q, updated);
          q.editorState = this.editorState(q);
        }
        window.top.postMessage({ fkAiChat: 'applied', id: msg.id, ok: Boolean(ok), error: ok ? '' : '无可写入控件',
          question: ok ? this.snapshot({ ...q, index: s.index }) : null,
          editorState: ok ? q.editorState : undefined }, event.origin);
      }).catch(error => window.top.postMessage({ fkAiChat: 'applied', id: msg.id, ok: false, error: error.message }, event.origin));
    } else if (msg.fkAiChat === 'applied' && window === window.top) {
      this.replies.get(msg.id)?.(msg); this.replies.delete(msg.id);
    }
  }
};

window.addEventListener('message', event => AIChat.onFrameMessage(event));
