const DialogueAssistant = {
  port: null,
  busy: false,
  generated: '',
  status: '',
  statusType: '',
  keepAliveTimer: null,
  lockedInputs: new Map(),

  init() {
    if (window.self !== window.top || window.location.hostname !== 'mooc2-ans.chaoxing.com' ||
        !window.location.pathname.startsWith('/mooc2-ans-vue/situationalDialogue')) return;

    this.ensureUI();
    const observer = new MutationObserver(() => this.ensureUI());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('keydown', event => this.guardSend(event), true);
    window.addEventListener('click', event => this.guardSend(event), true);
    window.addEventListener('submit', event => this.guardSend(event), true);
    window.addEventListener('pagehide', () => this.stop(), { once: true });
  },

  isChatPage() {
    return window.location.pathname === '/mooc2-ans-vue/situationalDialogue/chat';
  },

  ensureUI() {
    if (!this.isChatPage()) {
      if (this.busy) this.stop();
      return;
    }
    const toolbar = document.querySelector('.chat-container .input-toolbar__actions');
    if (!toolbar) return;
    toolbar.classList.add('cx-dialogue-actions');

    if (!toolbar.querySelector('#cx-dialogue-generate')) {
      const button = document.createElement('button');
      button.id = 'cx-dialogue-generate';
      button.type = 'button';
      button.className = 'cx-dialogue-generate';
      button.addEventListener('click', () => this.busy ? this.stop() : this.start());
      toolbar.appendChild(button);
    }
    if (!toolbar.querySelector('#cx-dialogue-status')) {
      const status = document.createElement('span');
      status.id = 'cx-dialogue-status';
      status.className = 'cx-dialogue-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      toolbar.appendChild(status);
    }
    this.render();
    if (this.busy) {
      this.lockInput();
      if (this.generated) {
        const input = document.querySelector('.chat-container .input-textarea');
        if (input && input.value !== this.generated) this.setDraft(this.generated);
      }
    }
  },

  render() {
    const button = document.getElementById('cx-dialogue-generate');
    const status = document.getElementById('cx-dialogue-status');
    if (button) {
      const label = this.busy ? '停止生成' : '生成回复';
      if (button.textContent !== label) button.textContent = label;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      if (button.classList.contains('cx-dialogue-generate--busy') !== this.busy) {
        button.classList.toggle('cx-dialogue-generate--busy', this.busy);
      }
    }
    if (status) {
      if (status.textContent !== this.status) status.textContent = this.status;
      if (status.title !== this.status) status.title = this.status;
      if (status.dataset.type !== this.statusType) status.dataset.type = this.statusType;
    }
    const footer = document.querySelector('.chat-container .chat-footer');
    if (footer && footer.classList.contains('cx-dialogue-generating') !== this.busy) {
      footer.classList.toggle('cx-dialogue-generating', this.busy);
    }
  },

  setStatus(message, type = '') {
    this.status = message;
    this.statusType = type;
    this.render();
  },

  readText(element) {
    return String(element?.innerText || element?.textContent || '').trim();
  },

  collectMessages(root = document) {
    const task = root.querySelector('.task-detail');
    const title = this.readText(task?.querySelector('.task-detail__title'));
    const description = this.readText(task?.querySelector('.task-detail__description'));
    const scenario = this.readText(task?.querySelector('.task-detail__scenario-text'));
    const roles = Array.from(task?.querySelectorAll('.task-detail__role') || []);
    const selfName = this.readText(roles[0]?.querySelector('.task-detail__role-name')) || '学生';
    const agentName = this.readText(roles[1]?.querySelector('.task-detail__role-name')) || '智能体';
    const rows = Array.from(root.querySelectorAll('.chat-container .message-list .message-row'));
    const turns = rows.map(row => ({
      role: row.classList.contains('message-row--ai') ? 'user' : 'assistant',
      content: this.readText(row.querySelector('.message-bubble'))
    })).filter(turn => turn.content);

    if (!title && !description && !scenario) throw new Error('未找到任务说明');
    if (!turns.length) throw new Error('未找到对话消息');
    if (turns[turns.length - 1].role !== 'user') throw new Error('请等待智能体回复后再生成下一轮');

    const system = [
      `你正在完成 AI 实践情景对话。请扮演“${selfName}”，与“${agentName}”交流。`,
      '下面的 user 消息是智能体发言，assistant 消息是学生已发送的发言。',
      '根据最新一条智能体消息生成学生下一轮回复。只输出可直接发送的回复正文，不要角色标签、解释或 Markdown 代码块。',
      `任务标题：${title}`,
      `任务说明：${description}`,
      `情景：${scenario}`
    ].join('\n');
    return [{ role: 'system', content: system }, ...turns];
  },

  lockInput() {
    const input = document.querySelector('.chat-container .input-textarea');
    if (input && !this.lockedInputs.has(input)) {
      this.lockedInputs.set(input, input.readOnly);
      input.readOnly = true;
    }
  },

  unlockInputs() {
    for (const [input, readOnly] of this.lockedInputs) input.readOnly = readOnly;
    this.lockedInputs.clear();
  },

  setDraft(value) {
    const input = document.querySelector('.chat-container .input-textarea');
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.scrollTop = input.scrollHeight;
  },

  guardSend(event) {
    if (!this.busy) return;
    const target = event.target;
    const isEnter = event.type === 'keydown' && event.key === 'Enter' &&
      target?.matches?.('.chat-container .input-textarea');
    const isSendClick = event.type === 'click' && target?.closest?.('.chat-container .send-button');
    const isSubmit = event.type === 'submit' && target?.closest?.('.chat-container');
    if (isEnter || isSendClick || isSubmit) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },

  start() {
    if (this.busy) return;
    if (!document.querySelector('.chat-container .input-textarea')) {
      this.setStatus('未找到对话输入框', 'error');
      return;
    }
    let messages;
    try {
      messages = this.collectMessages();
    } catch (err) {
      this.setStatus(err.message, 'error');
      return;
    }

    this.generated = '';
    this.busy = true;
    this.lockInput();
    this.setStatus('正在连接模型…');
    let port;
    try {
      port = chrome.runtime.connect({ name: 'AI_DIALOGUE_STREAM' });
      this.port = port;
      port.onMessage.addListener(message => {
        if (this.port !== port) return;
        if (message.type === 'delta') {
          this.generated += message.delta;
          this.setDraft(this.generated);
          this.setStatus('正在生成…');
        } else if (message.type === 'done') {
          this.finish(port, '回复已生成，请检查后发送');
        } else if (message.type === 'error') {
          this.finish(port, `生成失败：${message.message}`, 'error');
        } else if (message.type === 'cancelled') {
          this.finish(port, '已停止生成');
        }
      });
      port.onDisconnect.addListener(() => {
        if (this.port === port) this.finish(port, '连接已中断，已生成内容可继续编辑', 'error');
      });
      port.postMessage({ type: 'start', messages });
      this.keepAliveTimer = setInterval(() => {
        if (this.port !== port) return;
        try { port.postMessage({ type: 'ping' }); }
        catch (err) { this.finish(port, '连接已中断，已生成内容可继续编辑', 'error'); }
      }, 20000);
    } catch (err) {
      this.finish(port, `启动失败：${err.message}`, 'error');
    }
  },

  finish(port, message, type = '') {
    if (port && this.port !== port) return;
    this.port = null;
    this.busy = false;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    this.unlockInputs();
    this.setStatus(message, type);
    try { port?.disconnect(); } catch (err) { /* Already disconnected. */ }
  },

  stop() {
    if (!this.busy) return;
    const port = this.port;
    try { port?.postMessage({ type: 'cancel' }); } catch (err) { /* The port may be closed. */ }
    this.finish(port, '已停止生成');
  }
};
