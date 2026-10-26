// In-page assistant. The AI-practice conversation in dialogue.js has its own port and state.
const AIChat = {
  root: null, questions: [], history: [], pending: null, selected: new Set(),
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
      <div id="references"></div><textarea id="input" rows="3" placeholder="留空可直接生成并填写答案；输入内容可先讨论，再点击“填入答案”…"></textarea>
      <div class="actions"><button id="clear-context" title="清除本页对话记录，保留题目引用" disabled>清空上下文</button><button id="preview">预览</button><button id="regenerate" title="重新执行上一轮操作">重新生成</button><button id="stop" hidden>停止</button><button id="fill" disabled>填入答案</button><button id="send">生成答案</button></div><div id="status" role="status" hidden></div></main></div>`;
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
    this.el('send').onclick = () => this.send();
    this.el('fill').onclick = () => this.send('extract');
    this.el('input').oninput = () => this.updateActions();
    this.el('input').onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault(); this.send();
      }
    };
    this.el('regenerate').onclick = () => this.regenerate();
    this.el('clear-context').onclick = () => this.clearContext();
    this.el('preview').onclick = async () => {
      const config = await AIApi.loadConfig();
      if (this.quickEffort !== null) config.reasoningEffort = this.quickEffort;
      const context = this.chosen().map(q => this.snapshot(q));
      const target = this.targets(this.chosen()).map(q => this.snapshot(q));
      const settings = await AIConfig.loadBatchSettings();
      const request = { input: this.el('input').value.trim(), context, target,
        contextScope: this.el('all').checked ? 'all' : 'selected' };
      const mode = request.input ? 'chat' : 'answer';
      const preview = mode => this.batchRequests({ ...request, mode }, settings.batchSize)
        .map(batch => ({ questions: this.batchLabel(batch), messages: this.messages(config, batch) }));
      this.el('preview-text').textContent = JSON.stringify({ ...settings,
        operation: mode, requests: preview(mode),
        fill: this.hasChatReply() && target.length ? preview('extract') : [] }, null, 2);
      this.el('question-panel').open = true;
      this.el('preview-panel').open = true;
    };
    this.el('stop').onclick = () => {
      this.pending?.controller.abort();
      this.task('正在停止请求和后续填写。');
    };
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local' || !this.root) return;
      if (changes.activeAiProfileId || changes.aiProfiles) {
        await this.loadModels();
      }
    });
  },
  async refresh() {
    if (this.pending) return;
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
    this.el('context-note').textContent = `${this.questions.length} 道题；请求按总体设置分批。留空生成并填写，输入内容只聊天，讨论后可点击“填入答案”。程序题会附带可读取的现有代码。`;
    this.updateContextSummary();
  },
  updateContextSummary() {
    const count = this.el('all').checked ? this.questions.length : this.selected.size;
    this.el('context-summary').textContent = count ? '编辑题目引用' : '＋ 引用题目';
    this.el('references').replaceChildren();
    const context = this.chosen().map(q => this.snapshot(q));
    if (context.length) this.el('references').append(this.reference(context, this.targets(this.chosen()), true));
    this.updateActions();
  },
  chosen() { return this.questions.filter((_, index) => this.el('all').checked || this.selected.has(index)); },
  targets(context) {
    const value = this.el('target').value;
    return value === 'all' ? context : [this.questions[Number(value)]].filter(Boolean);
  },
  snapshot(q) {
    return { id: q.id, index: q.index, type: q.type, title: q.title, options: q.options, blankCount: q.blankCount,
      parentTitle: q.parentTitle, parentId: q.parentId, subquestionId: q.subquestionId, images: q.images, parentImages: q.parentImages,
      subquestionNumber: q.subquestionNumber,
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
  async clearContext() {
    if (this.pending) return;
    this.history = [];
    this.el('preview-text').textContent = '';
    this.el('preview-panel').open = false;
    this.renderHistory();
    this.task('上下文已清空，已保留题目引用。', 'success');
    try { await this.persist(); }
    catch (error) { this.task(`清空记录保存失败：${error.message}`, 'error'); }
  },
  renderHistory() {
    const feed = this.el('feed'); feed.replaceChildren();
    this.history.forEach(item => {
      const bubble = this.addBubble(item.role, item.text, item.modelLabel ||
        (item.role === 'assistant' ? 'AI · 旧记录未保存模型' : ''), item.request);
      if (item.role === 'assistant' && (item.thought || item.thoughtStatus)) this.addThought(bubble,
        item.thought || this.thoughtNote(item.thoughtStatus), item);
    });
    if (!this.history.length) {
      const empty = document.createElement('p'); empty.className = 'empty-state';
      empty.textContent = '引用本页题目，询问答案、解析或解题方法。'; feed.append(empty);
    }
    this.updateActions();
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
  thoughtNote(status) {
    return { encrypted: '接口仅返回了加密思考数据，无法展示文本。', hidden: '接口隐藏了本次思考内容。',
      failed: '请求失败，未能获取完整思考内容。', cancelled: '已停止，思考内容未接收完成。'
    }[status] || '接口未返回可展示的思考内容。';
  },
  addThought(bubble, text = '', metadata = {}) {
    const entry = document.createElement('details'); entry.className = 'thought-entry'; entry.open = false;
    const label = document.createElement('summary');
    label.title = '耗时从请求发出计至首次答案正文，包含连接和等待时间。';
    const state = document.createElement('span');
    const spinner = document.createElement('span'); spinner.className = 'thought-spinner'; spinner.hidden = true;
    spinner.setAttribute('aria-hidden', 'true');
    const elapsed = document.createElement('span'); elapsed.className = 'thought-elapsed';
    const duration = metadata.thoughtDurationMs;
    const hasDuration = Number.isFinite(duration) && duration >= 0;
    state.textContent = hasDuration ? '已思考' : '思考记录';
    elapsed.hidden = !hasDuration;
    if (hasDuration) elapsed.textContent = `${Math.floor(duration / 1000)} 秒`;
    label.append(state, ' ', spinner, ' ', elapsed);
    const body = document.createElement('pre'); body.textContent = text;
    entry.append(label, body); bubble.box.insertBefore(entry, bubble.body);
    let following = true, lastScrollTop = 0;
    const trackScroll = () => {
      if (!entry.open || body.scrollTop === lastScrollTop) return;
      if (body.scrollTop < lastScrollTop) following = false;
      else if (body.scrollHeight - body.clientHeight - body.scrollTop <= 2) following = true;
      lastScrollTop = body.scrollTop;
    };
    const scrollToLatest = () => {
      if (entry.open && following) body.scrollTop = body.scrollHeight;
      lastScrollTop = body.scrollTop;
    };
    body.addEventListener('scroll', trackScroll);
    entry.addEventListener('toggle', () => {
      if (!entry.open) return;
      following = true;
      scrollToLatest();
    });
    const setText = value => {
      // Capture manual movement even if its scroll event has not been dispatched yet.
      trackScroll();
      body.textContent = value;
      scrollToLatest();
    };
    return { body, entry, label, state, spinner, elapsed, setText };
  },
  addBubble(role, text, modelLabel = '', request) {
    this.el('feed').querySelector('.empty-state')?.remove();
    const box = document.createElement('article'); box.className = `message ${role}`;
    const name = document.createElement('b'); name.textContent = modelLabel || 'AI';
    const body = document.createElement('pre'); body.textContent = text || '';
    if (role === 'assistant') box.append(name);
    if (role === 'user' && request?.context?.length) box.append(this.reference(request.context, request.mode !== 'chat' ? request.target : [], false, request.contextScope || 'selected'));
    box.append(body); this.el('feed').append(box); box.scrollIntoView({ block: 'end' });
    return { box, body };
  },
  questionKey(question) { return `${question.index}:${question.id}`; },
  batchRequests(request, batchSize) {
    const questions = request.mode !== 'chat' ? request.target : request.context;
    const targetKeys = new Set(request.target.map(q => this.questionKey(q)));
    const extraContext = request.context.filter(q => !targetKeys.has(this.questionKey(q)));
    const batches = [];
    for (let offset = 0; offset < questions.length; offset += batchSize) {
      const batch = questions.slice(offset, offset + batchSize);
      const keys = new Set(batch.map(q => this.questionKey(q)));
      const context = request.mode !== 'chat'
        ? [...batch, ...extraContext.slice(0, batchSize - batch.length)].sort((a, b) => a.index - b.index) : batch;
      batches.push({ ...request, context, target: request.target.filter(q => keys.has(this.questionKey(q))),
        contextScope: context.length === request.context.length ? request.contextScope : 'selected' });
    }
    return batches.length ? batches : [{ ...request, context: [], target: [] }];
  },
  batchLabel(request) {
    const questions = request.mode !== 'chat' ? request.target : request.context;
    return questions.length ? `第 ${questions[0].index}${questions.length > 1 ? `–${questions.at(-1).index}` : ''} 题` : '对话';
  },
  async retryRequest(work, maxRetries, job, label) {
    const signal = job.controller.signal;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try { return await work(); }
      catch (error) {
        signal.throwIfAborted();
        if (!error.retryable || attempt >= maxRetries) throw error;
        this.task(`${label}失败，准备第 ${attempt + 1}/${maxRetries} 次重试：${error.message}`);
        await new Promise((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); },
            1000 * (2 ** attempt) + Math.floor(Math.random() * 250));
          signal.addEventListener('abort', cancel, { once: true });
        });
      }
    }
  },
  async send(mode, prior) {
    if (this.pending) return;
    const input = prior?.input ?? this.el('input').value.trim();
    mode ??= input ? 'chat' : 'answer';
    if (mode === 'extract' && this.el('input').value.trim()) return this.task('请先发送输入框中的内容，再填入答案。', 'error');
    if (mode === 'extract' && !this.hasChatReply()) return this.task('请先与模型讨论并确定答案。', 'error');
    const snapshots = items => items.map(item => this.snapshot(this.questions.find(q => this.questionKey(q) === this.questionKey(item)) || item));
    const context = JSON.parse(JSON.stringify(snapshots(prior?.context || this.chosen())));
    const target = JSON.parse(JSON.stringify(snapshots(prior?.target || this.targets(this.chosen()))));
    if (!input && !context.length && mode === 'chat') return;
    if (mode !== 'chat' && !target.length) return this.task('请先选择作答目标', 'error');
    const config = await AIApi.loadConfig();
    if (this.quickEffort !== null) config.reasoningEffort = this.quickEffort;
    try { AIApi.validateConfig(config); } catch (error) { return this.task(error.message, 'error'); }
    const settings = await AIConfig.loadBatchSettings();
    if (this.pending) return;
    const request = { mode, input, context, target,
      contextScope: prior?.contextScope || (this.el('all').checked ? 'all' : 'selected'), configId: config.id, regenerate: Boolean(prior) };
    const history = prior ? this.history.slice(0, this.history.findLastIndex(item => item.role === 'user' && item.request)) : this.history.slice();
    const batches = this.batchRequests(request, settings.batchSize);
    const job = { controller: new AbortController(), completed: 0, failures: [], failedQuestions: new Set(),
      unansweredQuestions: new Set(), offered: 0, written: 0, timeoutSeconds: settings.timeoutSeconds, applyQueue: Promise.resolve() };
    this.pending = job;
    this.setBusy(true);
    try {
      if (!prior) {
        const text = mode === 'extract' ? '请填入聊天中已确定的答案' : input || '请解答所选题目并填入答案';
        this.history.push({ role: 'user', text, request });
        this.addBubble('user', text, '', request);
        this.el('input').value = '';
        await this.persist();
      }
      this.task(`共 ${batches.length} 批，每批最多引用 ${settings.batchSize} 题，同时处理 ${Math.min(settings.concurrency, batches.length)} 批，每次请求最多等待 ${settings.timeoutSeconds} 秒。`);
      let nextBatch = 0;
      const worker = async () => {
        while (nextBatch < batches.length && !job.controller.signal.aborted) {
          const batch = batches[nextBatch++];
          const label = this.batchLabel(batch);
          const modelLabel = this.modelLabel(config);
          const assistant = this.addBubble('assistant', '', batches.length > 1 ? `${modelLabel} · ${label}` : modelLabel);
          const thoughtView = this.addThought(assistant);
          try {
            // The same request generates the answer and its structure; validation runs locally.
            const done = await this.retryRequest(async () => {
              const reply = await this.streamReply(config, batch, history, job, assistant, thoughtView);
              job.controller.signal.throwIfAborted();
              const entries = mode === 'chat' ? null : this.parseAnswerEntries(reply.text, batch);
              return { ...reply, entries };
            }, settings.maxRetries, job, `${label}${mode === 'extract' ? '答案提取' : '生成'}`);
            this.history.push({ role: 'assistant', text: done.text, thought: done.thought, mode,
              thoughtBlocks: done.thoughtBlocks, thoughtStatus: done.thoughtStatus, usage: done.usage, protocolState: done.protocolState,
              thoughtDurationMs: done.thoughtDurationMs,
              modelLabel, reasoningEffort: config.reasoningEffort, questionKeys: batch.context.map(q => this.questionKey(q)) });
            if (done.entries) {
              if (mode === 'extract') {
                const answered = new Set(done.entries.map(entry => entry.index));
                batch.target.forEach((q, index) => { if (!answered.has(index)) job.unansweredQuestions.add(q.index); });
              }
              // API requests can finish out of order; page writes remain serial.
              const offer = job.applyQueue.then(() => {
                job.controller.signal.throwIfAborted();
                return this.offerAnswers(done.entries, batch, job);
              });
              job.applyQueue = offer.catch(() => {});
              await offer;
            }
            job.completed++;
            this.task(`已完成 ${job.completed}/${batches.length} 批${job.offered ? `，提供 ${job.offered} 道题答案，写入 ${job.written} 道题` : ''}。`);
          } catch (error) {
            if (job.controller.signal.aborted) break;
            job.failures.push(label);
            assistant.body.textContent += `\n\n${label}失败：${error.message}`;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(settings.concurrency, batches.length) }, worker));
      this.task(`${job.controller.signal.aborted ? '已停止' : '处理结束'}：完成 ${job.completed}/${batches.length} 批` +
        `${job.offered ? `，提供 ${job.offered} 道题答案，写入 ${job.written} 道题` : ''}` +
        `${job.failures.length ? `；失败：${job.failures.join('、')}，可重新选择这些题目重试` : ''}` +
        `${job.unansweredQuestions.size ? `；第 ${[...job.unansweredQuestions].join('、')} 题在聊天中未确定答案，未填写` : ''}` +
        `${job.failedQuestions.size ? `；第 ${[...job.failedQuestions].join('、')} 题写入失败，请刷新题目后重试` : ''}。`,
        job.failures.length || job.failedQuestions.size ? 'error' : 'info');
    } catch (error) { this.task(error.message, 'error'); }
    finally {
      this.pending = null;
      this.setBusy(false);
      await this.persist();
    }
  },
  streamReply(config, request, history, job, assistant, thoughtView) {
    const signal = job.controller.signal;
    signal.throwIfAborted();
    assistant.body.textContent = '';
    thoughtView.state.textContent = '思考中';
    thoughtView.spinner.hidden = false;
    thoughtView.elapsed.hidden = false;
    thoughtView.elapsed.textContent = '0 秒';
    thoughtView.setText(config.reasoningEffort === 'none'
      ? '当前选择不思考；若模型仍返回可展示内容，会实时显示在这里。' : '正在等待模型返回思考内容…');
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let port, finished = false, keepAliveTimer, thoughtTimer, thoughtDurationMs;
      let text = '', thought = '', thoughtStatus = 'not_returned', usage, protocolState;
      let thoughtBlocks = [];
      const updateElapsed = () => {
        thoughtView.elapsed.textContent = `${Math.floor((thoughtDurationMs ?? performance.now() - startedAt) / 1000)} 秒`;
      };
      const stopThinking = error => {
        thoughtDurationMs ??= performance.now() - startedAt;
        clearInterval(thoughtTimer);
        thoughtView.spinner.hidden = true;
        thoughtView.state.textContent = error ? error.name === 'AbortError' ? '已停止 ·' : '请求失败 ·' : '已思考';
        updateElapsed();
      };
      const complete = error => {
        if (finished) return;
        finished = true;
        clearInterval(keepAliveTimer);
        signal.removeEventListener('abort', cancel);
        stopThinking(error);
        if (error) thoughtStatus = error.name === 'AbortError' ? 'cancelled' : 'failed';
        thoughtView.setText(thought ? thought + (error ? `\n\n${this.thoughtNote(thoughtStatus)}` : '') : this.thoughtNote(thoughtStatus));
        assistant.body.textContent = text;
        port?.disconnect();
        if (error) reject(error); else resolve({ text, thought, thoughtBlocks, thoughtStatus, usage, protocolState, thoughtDurationMs });
      };
      const cancel = () => {
        try { port.postMessage({ type: 'cancel' }); }
        catch (error) { /* The port may already be disconnected. */ }
        complete(signal.reason);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        port = chrome.runtime.connect({ name: 'AI_CHAT_STREAM' });
        port.onMessage.addListener(message => {
          if (finished) return;
          if (message.type === 'delta') {
            if (message.delta?.trim() && thoughtDurationMs === undefined) stopThinking();
            text += message.delta;
            assistant.body.textContent = text;
            assistant.box.scrollIntoView({ block: 'end' });
          }
          if (message.type === 'thought') {
            if (message.blocks) thoughtBlocks = message.blocks;
            else {
              const id = message.blockId || 'legacy';
              let block = thoughtBlocks.find(item => item.id === id);
              if (!block) { block = { id, kind: message.kind || 'content', text: '' }; thoughtBlocks.push(block); }
              block.text += message.delta;
            }
            thought = thoughtBlocks.map(item => item.text).join('\n\n');
            thoughtStatus = 'visible';
            thoughtView.setText(thought);
          }
          if (message.type === 'done') {
            if (typeof message.text === 'string') text = message.text;
            if (message.thoughtBlocks) { thoughtBlocks = message.thoughtBlocks; thought = thoughtBlocks.map(item => item.text).join('\n\n'); }
            thoughtStatus = message.thoughtStatus || thoughtStatus;
            usage = message.usage; protocolState = message.protocolState;
            complete();
          }
          if (message.type === 'error') complete(Object.assign(new Error(message.message), { retryable: message.retryable === true }));
          if (message.type === 'cancelled') complete(new DOMException('已停止生成', 'AbortError'));
        });
        port.onDisconnect.addListener(() => {
          if (!finished) complete(Object.assign(new Error(chrome.runtime.lastError?.message || '流式连接中断'), { retryable: true }));
        });
        thoughtTimer = setInterval(updateElapsed, 1000);
        keepAliveTimer = setInterval(() => {
          try { port.postMessage({ type: 'ping' }); }
          catch (error) { complete(Object.assign(error, { retryable: true })); }
        }, 20000);
        port.postMessage({ type: 'start', messages: this.messages(config, request, history),
          reasoningEffort: config.reasoningEffort, profileId: config.id, config, timeoutSeconds: job.timeoutSeconds });
      } catch (error) { complete(error); }
    });
  },
  conversationHistory(history = this.history) {
    let chatting = false;
    return history.filter(item => {
      if (item.role === 'user') chatting = item.request?.mode === 'chat';
      return chatting && (item.role !== 'assistant' || !item.mode || item.mode === 'chat');
    });
  },
  hasChatReply() {
    return this.conversationHistory().some(item => item.role === 'assistant' && item.text?.trim());
  },
  historyMessages(request, history, extracting = false, config) {
    const keys = new Set(request.context.map(q => this.questionKey(q)));
    const recent = [];
    let includeReply = false, includeLegacyReply = false;
    for (const item of extracting ? this.conversationHistory(history) : history.slice(-12)) {
      if (item.role === 'user' && item.request) {
        const context = item.request.context.filter(q => keys.has(this.questionKey(q)));
        includeReply = !item.request.context.length || context.length > 0;
        includeLegacyReply = context.length === item.request.context.length;
        if (includeReply) {
          const target = item.request.target.filter(q => keys.has(this.questionKey(q)));
          recent.push({ role: 'user', content: AIApi.withImages(this.requestText({ ...item.request, context, target }), context) });
        }
      } else if (item.questionKeys
        ? (extracting ? item.questionKeys.some(key => keys.has(key)) || !item.questionKeys.length : item.questionKeys.every(key => keys.has(key)))
        : includeReply && includeLegacyReply) {
        const scope = extracting && item.questionKeys?.length ? `本条回复原引用的页面题号：${item.questionKeys.map(key => key.split(':')[0]).join('、')}\n` : '';
        const state = config && item.protocolState?.identity === AIConfig.protocolIdentity(config) ? item.protocolState : undefined;
        if (scope && state) recent.push({ role: 'user', content: scope });
        recent.push({ role: item.role, content: state ? item.text : scope + item.text, ...(state ? { protocolState: state } : {}) });
      }
    }
    return recent;
  },
  messages(config, request, history = this.history) {
    const structured = request.mode !== 'chat';
    const relatedOnly = request.mode === 'extract';
    return [{ role: 'system', content: AIConfig.buildSystemPrompt(config.systemPrompt, { structured, relatedOnly }) },
      ...this.historyMessages(request, history, relatedOnly, config),
      { role: 'user', content: AIApi.withImages(this.requestText(request, config.userPrompt), request.context) }];
  },
  requestText(request, userPrompt = '') {
    if (request.mode !== 'chat') {
      const targetKeys = new Set(request.target.map(q => this.questionKey(q)));
      const extra = request.context.filter(q => !targetKeys.has(this.questionKey(q)));
      return `${AIApi.buildPrompt(request.target, request.mode === 'extract')}\n\n辅助题目上下文：\n${JSON.stringify(extra, null, 2)}\n\n` +
        (request.mode === 'extract'
          ? '请根据上面的聊天记录提取已确定的答案，按 pageIndex 对应页面题号，按 questionIndex 返回当前批次序号。只输出 JSON，不得补做未解答题目。'
          : `用户提示词：\n${userPrompt}\n\n${request.input || '请直接解答作答目标并返回完整 JSON。'}`);
    }
    const scope = request.contextScope === 'all' ? '全部题目' : request.context.length === 1 ? '单题' : '勾选多题';
    const reference = request.context.length ? `${scope}，第 ${request.context.map(q => q.index).join('、')} 题` : '无题目引用';
    return `引用范围：${reference}\n题目上下文：\n${JSON.stringify(request.context, null, 2)}\n\n用户提示词：\n${userPrompt}\n\n本轮输入：\n${request.input || '请解答指定题目'}`;
  },
  async regenerate() {
    if (this.pending) return;
    const prior = [...this.history].reverse().find(item => item.role === 'user' && item.request)?.request;
    if (!prior) return this.task('没有可重新生成的请求', 'error');
    await this.send(prior.mode, prior);
  },
  parseAnswerEntries(text, request) {
    if (request.mode === 'answer') return AIApi.parseAnswers(text, request.target).map((answer, index) => ({ index, answer }));
    try {
      const result = JSON.parse(AIApi.stripCodeFence(text));
      if (result.related === false) {
        if (result.answers !== undefined && (!Array.isArray(result.answers) || result.answers.length)) throw new Error('AI 返回的答案与关联标记冲突');
        return [];
      }
      if (!Array.isArray(result.answers)) throw new Error('AI 未返回可校验答案');
      const indices = result.answers.map(item => Number(item?.questionIndex));
      if (new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || index < 1 || index > request.target.length)) {
        throw new Error('AI 返回的题号越界或重复');
      }
      return result.answers.map(entry => ({
        index: Number(entry.questionIndex) - 1,
        answer: AIApi.parseAnswers(JSON.stringify({ answers: [{ ...entry, questionIndex: 1 }] }), [request.target[Number(entry.questionIndex) - 1]])[0]
      }));
    } catch (error) { error.retryable = true; throw error; }
  },
  async offerAnswers(entries, request, job) {
    for (const { index, answer } of entries) {
      job.controller.signal.throwIfAborted();
      const snap = request.target[index];
      const q = this.questions.find(q => q.index === snap.index && q.id === snap.id && q.title === snap.title);
      const current = q && (q.remote ? q : AIAnswerCore.parseQuestionContainer(q.container, q.docRef, q.sectionHeader));
      if (!current || current.id !== snap.id || current.title !== snap.title || current.type !== snap.type || !QuestionContainers.sameContext(current, snap) ||
          JSON.stringify(current.options) !== JSON.stringify(snap.options) ||
          JSON.stringify(current.existingAnswer) !== JSON.stringify(snap.existingAnswer) ||
          (snap.type === 'programming' && current.answerDraft !== snap.answerDraft) ||
          JSON.stringify(current.matchingGroups) !== JSON.stringify(snap.matchingGroups) || this.editorState(q) !== q.editorState) {
        job.failedQuestions.add(snap.index);
        this.task(`题目 ${snap.index} 或答题区已变化，拒绝写入`, 'error'); continue;
      }
      const card = document.createElement('div'); card.className = 'candidate';
      const code = document.createElement('pre'); code.textContent = JSON.stringify(answer, null, 2);
      const apply = document.createElement('button'); apply.textContent = `写入题目 ${q.index}`;
      apply.onclick = async () => {
        apply.disabled = true;
        try {
          job.controller.signal.throwIfAborted();
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
          job.failedQuestions.delete(q.index);
          job.written++;
          this.task(`已写入 ${job.written} 道题`, 'success');
        }
        catch (error) {
          job.failedQuestions.add(q.index);
          apply.disabled = false;
          this.task(`题目 ${q.index} 写入失败：${error.message}`, 'error');
        }
      };
      card.append(code, apply); this.el('feed').append(card);
      job.offered++;
      await apply.onclick();
    }
  },
  task(message, type = 'info') {
    if (!this.root) return;
    const status = this.el('status'); status.hidden = false; status.className = type; status.textContent = message;
  },
  updateActions() {
    const input = this.el('input').value.trim();
    const hasTarget = this.targets(this.chosen()).length > 0;
    this.el('send').textContent = input ? '发送' : '生成答案';
    this.el('send').disabled = Boolean(this.pending) || (!input && !hasTarget);
    this.el('fill').disabled = Boolean(this.pending) || !hasTarget || !this.hasChatReply();
    this.el('regenerate').disabled = Boolean(this.pending) || !this.history.some(item => item.role === 'user' && item.request);
    this.el('clear-context').disabled = Boolean(this.pending) || !this.history.length;
  },
  setBusy(value) {
    this.updateActions();
    this.el('refresh').disabled = value;
    this.el('stop').hidden = !value;
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
      const same = current && current.id === s.id && current.title === s.title && current.type === s.type && QuestionContainers.sameContext(current, s) &&
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
