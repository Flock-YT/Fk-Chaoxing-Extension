# Fk-Chaoxing 学习通助手 - Chrome 插件

Chrome 扩展，为超星学习通提供一键复制、字体解密、AI 自动答题等能力。基于 Manifest V3，全部逻辑在内容脚本中运行，零后端依赖。

好好学习天天向上！本插件仅供学习交流，使用者所产生的一切后果由使用者自行承担，与开发者无关。

<p align="center">
  <img src="示例.png" alt="Fk-Chaoxing 插件界面示例" width="380">
</p>

## 贡献
<p align="center">
  <a href="https://github.com/leoravyn"><img src="https://avatars.githubusercontent.com/u/81819833?v=4" width="48" height="48" alt="leoravyn" title="leoravyn"></a>
  <a href="https://github.com/Sukaetha"><img src="https://avatars.githubusercontent.com/u/188673093?v=4" width="48" height="48" alt="Sukaetha" title="Sukaetha"></a>
  <a href="https://github.com/Acidthing"><img src="https://avatars.githubusercontent.com/u/217921316?v=4" width="48" height="48" alt="Acidthing" title="Acidthing"></a>
  <a href="https://github.com/Flock-YT"><img src="https://avatars.githubusercontent.com/u/109157284?v=4" width="48" height="48" alt="Flock-YT" title="Flock-YT"></a>
  <a href="https://github.com/LLLeadstars"><img src="https://avatars.githubusercontent.com/u/238437846?v=4" width="48" height="48" alt="LLLeadstars" title="LLLeadstars"></a>
</p>

## 功能特性

- **解除限制**：解除复制/粘贴禁用、富文本编辑器限制、字体加密混淆
- **页面内 AI 对话**：可将整页、一题或多题加入上下文，指定作答目标；普通聊天显示回复，生成答案后展示可校验的候选答案
- **自动作答**：支持接入 OpenAI 兼容 API，批量识别并写入单选题、多选题、填空题、简答题、排序题、连线题及受支持的程序题编辑器
- **程序题上下文**：读取答题区现有代码与注释，保留换行和缩进；答题区变化时拒绝覆盖
- **多模型配置**：支持保存多个 AI 模型，可快速切换并执行连接测试
- **独立提示词**：每个模型可编辑完整作答提示词和独立对话提示词，支持恢复默认及发送预览
- **一键提取**：自动收集作业、考试、章节页面的题目

## 技术栈

- Manifest V3
- ES Module
- Shadow DOM 隔离样式
- MutationObserver + postMessage 跨 iframe 通信
- Chrome `storage.local` 本地配置持久化
- Chrome `permissions` + `optional_host_permissions` 动态申请 AI 接口域名权限
- OpenAI 兼容 Chat Completions / Responses API

## 项目结构

```
Fk-Chaoxing-Extension/
├── manifest.json              # 扩展权限、内容脚本与可选 Host 权限声明
├── background.js              # 后台 Service Worker
├── popup.html                 # 弹窗 UI 结构
├── popup.css                  # 弹窗样式
├── popup.js                   # 弹窗控制器
├── content-message-handler.js # 统一消息路由
├── content.js                 # 内容脚本入口
├── injected.js                # 注入页面上下文
├── modules/
│   ├── logger.js              # 全局日志
│   ├── ui/                    # 可复用组件
│   │   ├── Modal.js
│   │   └── Toast.js
│   ├── extractors/            # 题目提取器
│   │   ├── HomeworkExtractor.js
│   │   └── ExamExtractor.js
│   ├── services/              # 业务聚合
│   │   └── QuestionCollector.js
│   ├── ai-answer/             # AI 答题子系统
│   │   ├── api.js
│   │   ├── chat.js             # 页面内对话模态窗与会话状态
│   │   ├── chat.css
│   │   ├── core.js
│   │   ├── index.js
│   │   ├── ui.js
│   │   └── dialogue.js
│   ├── PasteEnabler.js        # 破解粘贴限制
│   ├── CopyEnabler.js         # 字体解密
│   └── UEditorUnlock.js       # 富文本编辑器解锁
└── assets/
    ├── TyprMd5.js
    └── table.json
```


## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)

## 快速开始

### 一、安装插件

1. 下载\克隆本仓库代码到本地
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择本项目文件夹，点击"选择文件夹"
6. 插件图标将出现在浏览器工具栏


### 二、配置 AI 模型

首次使用 AI 答题功能前，需要先配置 AI 模型。

#### 步骤 1：打开插件配置

1. 点击浏览器工具栏上的插件图标
2. 在弹出的面板中点击“配置”，进入总体设置，再打开“模型管理”并点击“添加”

#### 步骤 2：填写 AI 配置

在模型编辑页填写以下信息：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| **显示名称** | 给这个配置取个名字 | 答题助手 |
| **API 地址** | AI 服务的 base URL | `https://xxx.com/v1` |
| **API Key** | 你的 API 密钥 | `sk-xxxxxxxxxxxxxxxx` |
| **模型选择** | 在同一个框内输入模型 ID，或点击右侧箭头选择已拉取的模型 | `model-id` |
| **API 类型** | 每个模型配置独立选择协议 | `Chat Completions` / `Responses` / `Claude Messages` / `Gemini GenerateContent` |
| **请求路径** | 随 API 类型切换标准路径，自定义路径保留 | `/chat/completions`、`/responses`、`/messages`、`/models/{model}:{method}` |
| **默认思考等级** | 使用模型默认、不思考、Low、Medium、High、XHigh、Max | `High` |
| **温度系数** | 0–2，可留空；Chat Completions 默认 `0.3`，Responses 默认留空；显式指定思考等级时禁用并省略 | `0.3` |

“使用模型默认”不指定思考强度。其余等级按接口协议原值透传：Chat Completions 使用 `reasoning_effort`，Responses 使用 `reasoning.effort`，Claude Messages 使用 `output_config.effort`，Gemini GenerateContent 使用 `thinkingConfig.thinkingLevel`。插件不按模型名称或版本限制等级，也不把 Max 转成 XHigh；服务商决定实际支持范围和等级映射，不支持时显示接口返回的错误。“不思考”在兼容协议中发送 `none`，Claude 原生接口发送 `thinking.type: "disabled"`，Gemini 原生接口发送 `thinkingBudget: 0`。旧配置的地址、路径和等级保留。

弹窗的“本次思考等级”会带入页面对话窗；对话窗顶部也可切换模型和本次思考等级。切换模型后会采用该模型的默认等级。已发起的请求保持原模型与等级。

页面聊天、直接生成和主动提取答案均使用流式请求；连接测试及其他非流式入口共用同一套协议适配和结果解析。Responses 使用 `store: false`。思考区域默认折叠，可手动展开查看实时内容；请求期间显示“思考中”、转圈动画及秒数，首次收到答案正文后显示“已思考 N 秒”。耗时包含连接和等待时间，每批及每次重试独立计时；新记录保留耗时，旧记录显示“思考记录”。思考文本、摘要、加密数据和签名不会混入答案或情境对话草稿。

请求构造和思考解析均由接口协议决定，无需选择厂商。Responses 统一发送 `reasoning.summary: "auto"` 请求思考摘要，并读取接口返回的思考文本和摘要事件；服务端不支持该参数时显示接口错误，不静默删除参数或重试。OpenAI 可展示的是摘要，完整内部思考不公开。Chat Completions 使用独立的协议解析，支持 `reasoning_content`、`reasoning`、`reasoning_details` 及 `<think>` 标签；Claude 读取 thinking 内容块，Gemini 读取 thought 内容。接口仅返回加密数据、隐藏内容、没有返回可展示文本及请求失败时，会分别说明；缺少思考文本不影响正常答题。旧配置中的厂商字段不再参与请求，原有地址、协议、模型 ID 和其他连接设置继续可读。[OpenAI 文档](https://developers.openai.com/api/docs/guides/reasoning)、[DeepSeek 文档](https://api-docs.deepseek.com/api/create-response/)、[Grok 文档](https://docs.x.ai/developers/model-capabilities/text/reasoning)、[中转字段示例](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)

按服务商提供的信息填写 API 地址并选择对应协议；以下路径均相对于 API 地址：

| 厂商 | API 地址示例 | 协议与路径 |
|------|-------------|------------|
| OpenAI GPT | `https://api.openai.com/v1` | Responses，`/responses` |
| DeepSeek | `https://api.deepseek.com` | Chat Completions，`/chat/completions` |
| Claude | `https://api.anthropic.com/v1` | Claude Messages，`/messages` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | Gemini GenerateContent，`/models/{model}:{method}` |
| Grok | `https://api.x.ai/v1` | Responses，`/responses` |
| Kimi | `https://api.moonshot.cn/v1` | Chat Completions，`/chat/completions` |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | Chat Completions，`/chat/completions` |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Chat Completions，`/chat/completions` |

在模型编辑页填写 API 地址、密钥并选择接口协议后，点击“拉取模型”即可查询，无需先保存、填写显示名称或模型 ID。列表来自当前 API 基础地址下的 `/models`，会保留标准请求路径中的 `/v1` 等前缀；Claude 与 Gemini 自动读取后续分页。“模型选择”始终可直接输入任意模型 ID，拉取后点击框右侧箭头展开列表，选择时填入实际 ID；也可用上下键选择、Enter 确认、Escape 关闭。拉取不自动选择第一项或覆盖当前输入，允许保存列表之外的 ID；未拉取、列表为空或查询失败也可手动填写。列表可能包含不适合答题的模型，可用连接测试验证。拉取只查询信息，不答题、不保存配置。连接信息变更会清空旧候选列表并保留已输入的 ID；切换编辑对象或离开编辑页后，旧查询结果失效。

Claude 成功查询的上限在后台内存中缓存一小时（后台重启后重新查询），按模型查询地址、协议、密钥、工作区、API 版本和模型隔离；列表返回的有效上限可直接复用。主动拉取会刷新该连接的上限缓存；并发详情查询合并，单个请求取消不会影响其他等待者。[Claude 模型详情](https://platform.claude.com/docs/en/api/models/retrieve)、[Claude 模型列表](https://platform.claude.com/docs/en/api/models/list)、[Gemini 模型列表](https://ai.google.dev/api/models)

使用中转时填写中转地址、实际模型 ID 和中转提供的协议，与官方接口使用相同的协议适配逻辑，不根据域名或模型名称推断厂商。能否返回思考内容仍取决于型号和服务商，插件无法还原接口未公开的内容。

Claude 原生连接增加可选的“查询失败时的最大输出 tokens”（`claudeFallbackMaxTokens`，正整数）。生成前优先使用当前模型的有效缓存，否则查询 `/models/{modelId}`，仅采纳明确的 `max_tokens` 或中转的 `max_output_tokens`；查询失败或未返回有效上限时使用手动兜底值，未填写则停止并提示，不猜测型号上限。查询与生成共用停止信号和总超时，停止或超时后不会继续生成。其他三种协议不自动查询上限，也不发送最大输出参数。旧配置继续可读，保存配置本身不会查询远端。

Claude 原生连接可设置 API 版本（默认 `2026-10-21`）和工作区 ID（密钥未绑定工作区时需要），不发送温度，也不强制开启额外思考模式。Gemini 自动请求思考摘要，路径中的 `{model}` 和 `{method}` 分别替换为模型 ID 与生成/流式生成方法。图片 URL 需能被模型服务访问；接口拒绝图片时会报错，不会静默丢图。会话所需的思考块、加密数据及签名按原协议保存，只回传给同一模型配置。[Claude 文档](https://platform.claude.com/docs/en/manage-claude/authentication)、[Gemini 文档](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en)

#### 步骤 3：保存与测试

1. 点击“保存”即可保存有效配置，无需保持网络连接
2. 需要检查连接时，单独点击“测试连接”；测试会发送“仅回复 OK”并可能产生费用
3. 首次测试或使用新 API 地址答题时，浏览器会请求对应域名权限

#### 步骤 4：多模型管理（可选）

- **新增模型**：在“模型管理”点击“添加”，填完后保存
- **切换模型**：在模型列表点击“使用”，下次对话请求采用当前模型
- **编辑或删除模型**：在模型列表打开编辑页后操作；离开未保存的编辑页会提示确认
- **作答提示词和对话提示词**：每个模型单独保存，可恢复默认。作答提示词是直接生成时实际使用的完整系统提示词，包含 JSON 示例、题型约束和程序题要求；修改后若返回格式不符合本地校验要求，不会填写。对话提示词独立控制讨论，本轮输入作为用户消息发送。“填入答案”使用内部专用规则，只整理讨论中明确的答案，不使用这两项自定义提示词。模型页可预览三种用途的模板，页面对话窗可预览含当前题目的实际发送内容。旧配置的系统、用户提示词保留为作答偏好，对话采用独立默认值

#### 大题库答题设置

在弹窗“配置 → 总体设置”中设置每次请求题目数（1–100）、同时并发数（1–16）、失败重试次数（0–5）和请求超时（正整数秒）。默认每次请求 50 题、同时并发 4 个请求、每次请求最多额外重试 2 次、超时 300 秒。设置对所有模型生效，任务开始后固定本次参数。

“生成答案”和“填入答案”按题目数及并发设置分批，每批独立请求；生成可以带上限内的辅助题目，提取只带当前批次题目及相关聊天最终回复，不带思考内容。讨论每轮使用一个完整请求，包含已加入的题目资料和保留的聊天记录，不按题目数拆分，也不再仅发送最近 12 条消息。重试和超时设置仍对讨论生效。预览展示实际发送内容；聊天记录最多持久化最近 60 条，题目资料独立保存，不随早期消息截断而丢失。

超时限制包含模型思考和输出的整次请求总时长，持续收到内容也不会重置；重试会重新计时。该设置也适用于模型连接测试和其他 AI 请求。

直接答题每批只请求一次，返回结构化答案后在本地校验，再按批串行填写。网络或答案格式错误会重试当前批次；重试耗尽后显示失败题号范围，其他批次继续处理。停止会取消活动请求和待执行批次，不再继续填写；不会自动保存或提交试卷。



### 三、使用 AI 答题

#### 页面内对话与生成答案

1. 打开超星学习通作业/考试/章节页面
2. 等待页面题目加载完成
3. 点击插件图标打开弹窗
4. 点击“使用 AI 答题”打开对话窗
5. 勾选整页或指定题目作为本轮待发送资料；输入区分别显示“本轮待发送”和“已加入对话”的题目，可再限定作答目标
6. 当前上下文尚未讨论时，输入框留空，主按钮为“生成答案”：一次生成结构化答案，校验通过后直接填写
7. 输入内容后，主按钮变为“发送”：只聊天，不自动填写。发送后自动取消本轮勾选，题目资料保留在对话中；后续不必重新勾选即可继续讨论。再勾选新题发送，即可补充资料。重选已加入题目不会重复保存，内容有变化时会更新并标明。讨论模式允许只发送题目、不输入文字，此时仅在本地加入资料，不调用模型；没有文字也没有待发送题目时不能发送。Enter 与点击主按钮相同，Shift+Enter 换行
8. 答案讨论确定后，点击“填入答案”：默认从全部已加入题目中，根据聊天记录提取每题最后明确的答案，也可限定一道题；校验后填写。未确定的题会提示未填写，不会临时补做。输入框有未发送内容时请先发送

讨论模式随页面记录保存，刷新页面、切换模型、请求失败或停止、提取答案均不会解除。若要放弃讨论并直接生成，先点击“清空上下文”；已加入的资料和用量随聊天记录一起清除，本轮待发送勾选保留。此前直接生成的答案可以作为讨论参考，旧生成指令和提取结果不会混入讨论。

输入区仅显示一行“上下文：数值”，使用服务端返回的输入 token 数：讨论显示本轮请求的输入量，一步生成显示本次任务各批已返回的最大输入量，不累加多次调用。每次讨论或一步生成开始时重置为“上下文：—”，收到完整用量后更新；全部缺失或失败、停止且未收到完整用量时保持“—”，有效零值显示“0”。达到 1000 时使用 K，最多保留一位小数，例如 1K、1.5K、100K。Claude 缓存写入、读取计入输入，其他协议已包含的缓存不重复累计；不做本地估算。模型规格仍在后台查询并使用一小时缓存，用于接近上限提醒；切换模型不显示旧连接用量，提取答案不重置或覆盖该数值。

输入用量达到已知容量的 80% 时，会提醒先填入已确定答案，再自行清空上下文讨论剩余题目。接口明确报告上下文超限时保留题目和聊天，不自动重试同一请求、摘要或清空。“填入答案”仍可使用；若一批提取超限，会改为逐题整理。单题仍超限时明确提示，请用户手动填写已确定答案后再清空，不保证超限后一定能自动整理。只有用户自己点击“清空上下文”才会清除活动资料。

页面和插件弹窗不再提供自动写入开关，旧开关设置不影响上述流程。“重新生成”沿用上一轮操作，重新生成聊天回复不会填写答案。

发送预览会展示题目及答题区现有内容，程序题包括已有代码和注释；这些内容会发送到当前配置的 AI API。若显示“未读取到答题区代码”，请勿认为模型已看到编辑器内容。写入前会核对题目及答题区状态，避免覆盖用户在生成期间的改动。

#### 方式二：先提取再答题
1. 在超星页面，点击插件弹窗的"自动获取题目"按钮
2. 插件会收集所有题目并显示预览
3. 确认无误后打开 AI 对话窗，选择题目并发送对话或生成答案



### 四、提取题目

如果你只想收集题目（比如复制到其他地方），可以使用提取功能。

#### 步骤：

1. 打开超星页面
2. 点击插件图标
3. 点击"自动获取题目"按钮
4. 插件会：
   - 扫描页面所有题目
   - 自动复制到剪贴板
   - 显示预览弹窗
   - 插件图标右上角显示题目数量徽章



## 支持的页面类型

目前插件完整或部分支持以下超星页面：

| 页面类型 | URL 特征 | 支持状态 |
|----------|----------|----------|
| 章节学习 | `/mycourse/studentstudy` | 完全支持 |
| 作业作答（旧版） | `/work/doHomeWorkNew` | 完全支持 |
| 作业作答（新版） | `/mooc-ans/mooc2/work/dowork` | 完全支持 |
| 考试页面 | `/exam-ans/mooc2/exam/preview` | 完全支持 |
| 知识点 | `/knowledge/cards` | 完全支持 |

**注意**：如果你的作业页面显示"写入 0 题"，可能是因为该页面使用了新的 DOM 结构，请将相关页面 HTML 片段提供给开发者以便适配。

欢迎提交 Issue 和 PR！如果你发现新的超星页面结构不被支持，请提供相关 HTML 片段以便适配。


### 排序题与连线题

支持作业页面使用自定义下拉框的排序题和连线题。排序题按答案顺序从左到右填写；连线题按页面显示编号匹配，并自动转换到页面内部编号。复制题目时会保留连线题两组内容。

直接生成答案或主动点击“填入答案”后，插件通过页面原有选项事件填写。考试页核验下拉框显示和内部选中值，作业页同时核验同步的隐藏答案字段。答案不完整、选项无效或控件不匹配时会提示该题未完成填写，其他题目继续处理。普通聊天只展示回复。插件不会主动点击暂时保存或提交；填写结果请自行核对。
