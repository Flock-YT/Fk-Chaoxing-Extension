// SSE parser shared by the dialogue streaming request and its local tests.
const AIStream = {
  createParser(apiType, onDelta) {
    let buffer = '';
    let text = '';
    let terminal = false;
    let finishReason = '';

    const append = (delta) => {
      if (typeof delta !== 'string' || !delta) return;
      text += delta;
      onDelta(delta);
    };

    const processEvent = (frame) => {
      const data = frame.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) return;
      if (data === '[DONE]') {
        if (apiType === 'chat_completions') terminal = true;
        return;
      }

      let event;
      try {
        event = JSON.parse(data);
      } catch (err) {
        throw new Error('AI 流式响应包含无效 JSON');
      }
      if (event.error) throw new Error(event.error.message || 'AI API 返回错误');
      if (event.type === 'error') throw new Error(event.message || 'AI API 返回错误');

      if (apiType === 'responses') {
        if (event.type === 'response.output_text.delta') append(event.delta);
        if (event.type === 'response.output_text.done' && !text) append(event.text);
        if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') {
          throw new Error('AI 拒绝回答');
        }
        if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          throw new Error(event.response?.error?.message || event.response?.incomplete_details?.reason || 'Responses 请求未完成');
        }
        if (event.type === 'response.completed') terminal = true;
      } else {
        const choice = event.choices?.[0];
        if (choice?.delta?.refusal) throw new Error(`AI 拒绝回答：${choice.delta.refusal}`);
        append(choice?.delta?.content);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
    };

    return {
      feed(chunk) {
        buffer += chunk;
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          processEvent(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
      },
      finish() {
        if (buffer.trim()) processEvent(buffer);
        if (!terminal || (apiType === 'chat_completions' && finishReason !== 'stop')) {
          throw new Error('AI 流式响应未正常完成');
        }
        if (!text.trim()) throw new Error('AI API 未返回回复文本');
        return text;
      }
    };
  },

  async consume(body, apiType, onDelta) {
    if (!body?.getReader) throw new Error('AI API 未返回可读取的数据流');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = this.createParser(apiType, onDelta);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.feed(decoder.decode());
      return parser.finish();
    } finally {
      reader.releaseLock();
    }
  }
};
