importScripts('modules/ai-answer/config.js');
importScripts('modules/ai-answer/stream.js');

// Background Service Worker - 处理 API 请求和后台任务

const BACKGROUND_PREFIX = '[Fk-Chaoxing] [Background]';

// 简单的日志封装
const log = {
  info: (msg) => console.log(`${BACKGROUND_PREFIX} ${msg}`),
  error: (msg) => console.error(`${BACKGROUND_PREFIX} ${msg}`)
};

chrome.runtime.onInstalled.addListener(() => {
  log.info('Extension installed/updated');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AI_API_REQUEST') {
    log.info('Received AI API request');
    callOpenAICompatibleAPI(request.data)
      .then(result => {
        log.info('AI API request successful');
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        log.error(`AI API request failed: ${error.message}`);
        sendResponse({ success: false, error: error.message, retryable: error.retryable === true });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'updateBadge') {
    // 允许 content script 触发徽章更新
    try {
      if (sender.tab && sender.tab.id) {
        chrome.action.setBadgeText({
          text: request.count.toString(),
          tabId: sender.tab.id
        });
        chrome.action.setBadgeBackgroundColor({
          color: '#f53f3f', // 红色背景比较醒目
          tabId: sender.tab.id
        });
        sendResponse({ success: true });
      }
    } catch (e) {
      log.error('Update badge error: ' + e.message);
    }
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (!['AI_DIALOGUE_STREAM', 'AI_CHAT_STREAM'].includes(port.name)) return;
  let started = false;
  let finished = false;
  let controller;

  const complete = (message) => {
    if (finished) return;
    finished = true;
    try { port.postMessage(message); } catch (err) { /* The page may have closed. */ }
  };

  port.onMessage.addListener(message => {
    if (message?.type === 'ping') return;
    if (message?.type === 'cancel') {
      controller?.abort();
      complete({ type: 'cancelled' });
      return;
    }
    if (message?.type !== 'start' || started) return;
    started = true;
    controller = new AbortController();
    streamDialogueReply(message.messages, message.reasoningEffort, controller, delta => {
      if (!finished) port.postMessage({ type: 'delta', delta });
    }, port.name === 'AI_CHAT_STREAM' ? delta => {
      if (!finished) port.postMessage({ type: 'thought', delta });
    } : undefined, port.name === 'AI_CHAT_STREAM' ? message.profileId : undefined, message.timeoutSeconds)
      .then(() => complete({ type: 'done' }))
      .catch(error => {
        if (!finished) complete({ type: 'error', message: error.message, retryable: error.retryable === true });
      });
  });

  port.onDisconnect.addListener(() => {
    finished = true;
    controller?.abort();
  });
});

async function streamDialogueReply(messages, reasoningEffort, controller, onDelta, onThought, profileId, timeoutSeconds) {
  if (!Array.isArray(messages) || !messages.length ||
      messages.some(item => !['system', 'user', 'assistant'].includes(item?.role) || !validMessageContent(item))) {
    throw new Error('对话内容无效');
  }
  if (!AIConfig.efforts.includes(reasoningEffort)) throw new Error('不支持的思考等级');

  const data = await chrome.storage.local.get(['aiProfiles', 'activeAiProfileId', 'aiConfig']);
  const profiles = Array.isArray(data.aiProfiles) ? data.aiProfiles : [];
  const active = profileId
    ? profiles.find(item => item.id === profileId)
    : profiles.find(item => item.id === data.activeAiProfileId) || profiles[0] || data.aiConfig;
  if (profileId && !active) throw new Error('所选模型配置已删除，请重新选择');
  if (!active) throw new Error('请先在插件弹窗配置 AI 模型');
  const config = normalizeApiConfig({ ...active, reasoningEffort });
  if (!config.baseUrl || !config.apiKey || !config.model) throw new Error('当前 AI 模型配置不完整');
  const apiUrl = new URL(buildApiUrl(config));
  if (!['https:', 'http:'].includes(apiUrl.protocol)) throw new Error('AI API 地址必须使用 HTTP 或 HTTPS');
  if (!await chrome.permissions.contains({ origins: [`${apiUrl.origin}/*`] })) {
    throw new Error('尚未授权模型 API 域名，请在插件弹窗重新保存或切换模型以授权');
  }

  timeoutSeconds = AIConfig.normalizeTimeoutSeconds(timeoutSeconds ?? (await AIConfig.loadBatchSettings()).timeoutSeconds);
  controller.signal.throwIfAborted();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutSeconds * 1000);
  try {
    const response = await fetch(apiUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(buildRequestBody(config, messages, true)),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`AI API 请求失败（${response.status}）：${(await response.text()).slice(0, 500)}`);
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }
    await AIStream.consume(response.body, config.apiType, onDelta, onThought);
  } catch (err) {
    if (timedOut) throw retryableError(`AI API 请求超时（${timeoutSeconds} 秒）`);
    if (err instanceof TypeError) err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeApiConfig(config = {}) {
  return AIConfig.normalize(config);
}

function buildApiUrl(config) {
  try {
    const baseUrl = new URL(config.baseUrl);
    return `${baseUrl.toString().replace(/\/+$/, '')}${config.path}`;
  } catch (err) {
    throw new Error('AI API 地址格式不正确，请检查配置');
  }
}

async function callOpenAICompatibleAPI(data) {
  const config = normalizeApiConfig(data.config || data);

  if (!config.baseUrl) {
    throw new Error('请先配置 AI API 地址');
  }
  if (!config.apiKey) {
    throw new Error('请先配置 AI API 密钥');
  }
  if (!config.model) {
    throw new Error('请先配置模型 ID');
  }

  const timeoutSeconds = AIConfig.normalizeTimeoutSeconds(data.timeoutSeconds ?? (await AIConfig.loadBatchSettings()).timeoutSeconds);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutSeconds * 1000);
  let response;
  try {
    response = await fetch(buildApiUrl(config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(buildRequestBody(config, data.messages)),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`API Request Failed: ${response.status} - ${await response.text()}`);
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }

    let result;
    try {
      result = await response.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const error = new Error('API 返回内容不是合法 JSON');
      error.retryable = true;
      throw error;
    }
    return extractResponseText(result, config.apiType);
  } catch (err) {
    if (timedOut) throw retryableError(`AI API 请求超时（${timeoutSeconds} 秒）`);
    if (err instanceof TypeError) err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function retryableError(message) {
  const error = new Error(message);
  error.retryable = true;
  return error;
}

function validMessageContent(message) {
  if (typeof message.content === 'string') return true;
  return message.role === 'user' && Array.isArray(message.content) && message.content.length > 0 && message.content.every(part =>
    (part?.type === 'text' && typeof part.text === 'string') ||
    (part?.type === 'image_url' && typeof part.image_url?.url === 'string' &&
      (/^https?:\/\//i.test(part.image_url.url) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(part.image_url.url))));
}

function buildRequestBody(config, messages, stream = false) {
  const body = { model: config.model, stream };
  if (config.apiType === 'responses') {
    body.input = messages.map(message => ({ ...message, content: Array.isArray(message.content)
      ? message.content.map(part => part.type === 'image_url'
        ? { type: 'input_image', image_url: part.image_url.url }
        : { type: 'input_text', text: part.text }) : message.content }));
    body.store = false;
    if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
  } else {
    body.messages = messages;
    if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
  }
  if (!config.reasoningEffort && config.temperature !== null) {
    body.temperature = config.temperature;
  }
  return body;
}

function extractResponseText(result, apiType) {
  if (result?.error) {
    throw new Error(result.error.message || 'AI API 返回错误');
  }
  if (apiType === 'responses') {
    if (result?.status !== 'completed') {
      const message = `Responses 请求未完成：${result?.status || '未知状态'}（${result?.incomplete_details?.reason || '未返回完整答案'}）`;
      throw result?.status === 'failed' ? new Error(message) : retryableError(message);
    }
    const parts = [];
    for (const item of result.output || []) {
      if (item.type !== 'message') continue;
      for (const content of item.content || []) {
        if (content.type === 'refusal') throw new Error(`AI 拒绝回答：${content.refusal || '未提供原因'}`);
        if (content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
      }
    }
    const text = parts.join('');
    if (!text.trim()) throw retryableError('Responses API 未返回答案文本');
    return text;
  }
  const choice = result?.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`AI 拒绝回答：${choice.message.refusal}`);
  if (choice?.finish_reason && choice.finish_reason !== 'stop') {
    throw retryableError(`Chat Completions 请求未完成：${choice.finish_reason}`);
  }
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw retryableError('API 返回格式不符合 OpenAI Chat Completions 规范，或未返回答案文本');
  }
  return content;
}
