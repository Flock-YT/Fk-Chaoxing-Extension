// AI 答题助手主入口
const AIAnswerHelper = {
  // 初始化
  init() {
    try {
      DialogueAssistant.init();
      AIChat.init();
    } catch (err) {
      GlobalLogger.error('AI 初始化失败');
    }
  }
};
