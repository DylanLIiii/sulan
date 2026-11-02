# 速览 · sulan

Claude Code mod：在侧边 pane 实时显示会话速览，另有一个独立的侧聊 pane。离开几天回来，扫一眼就能接着干；工作进行中，也可以随时追问。

- 分节摘要：目标、做了什么、结论、现状、需要你、名词与概念，每条带状态图标
- 末尾是进度区：进度条、彩色流程图（✓ 完成 ◐ 进行中 ○ 未开始 ✗ 失败），再加一两行说明
- 输入框下方常驻一行 TL;DR
- 侧聊结合当前会话上下文回答问题，支持选择已有模型、连续追问、快捷提问和复制回答
- 每轮用过工具后，Haiku 把新消息滚动合并进摘要；打开有历史的会话会先补一次，没有历史就不动

```
 ❖ 进度  2/4 · 50%
   ━━━━━━━━━━━━━━──────────
         ╭────────────╮
         │ ✓ 读原仓库 │
         ╰──────┬─────╯
                ▼
         ╭────────────╮
         │  ◐ 写代码  │
         ╰────────────╯
   › 窄 pane 放不下图时自动改成步骤列表
```

## 安装

在 Claude Code 里：

```
/plugin marketplace add DylanLIiii/sulan
/plugin install sulan@sulan
```

或者用命令行：

```sh
claude plugin marketplace add DylanLIiii/sulan
claude plugin install sulan@sulan
```

本地开发时直接加载目录：`claude --plugin-dir /path/to/sulan`。

## 使用

- `/sulan` 打开速览侧栏；终端够宽时会自动停靠
- `/sulan-chat` 另开一个独立的侧聊侧栏，并尝试聚焦输入框；Enter 发送，Esc 将键盘交还主输入框
- 速览中按 `r` 刷新、`b` 从头重建；写作规则在 `INSTRUCTIONS.md`，可以直接改
- 侧聊可用快捷问题开始，也可以复制最近的回答；失败后可重试或编辑问题，清空前需要确认

点击侧聊顶部的「模型」可选择 Claude Code 已配置的模型；选择会保存，清空侧聊也会保留。插件读取合并后的 `modelPicker.options`，保留模型的完整路由和名称，并遵循 `replaceBuiltInOptions`。未替换内置选项时，也提供由 Claude Code 解析的 Sonnet、Opus、Haiku 别名；当前主会话模型也会加入列表。每次打开侧聊会重新读取列表，切换侧聊模型只影响侧聊，模型权限仍由 Claude Code 校验。

默认「跟随主会话」使用 `model.fork`，自动继承主会话最近一次请求的上下文；需要主会话已有可用请求快照。选择具体模型时，使用 `model.complete`，插件自动附上速览摘要、可读取的主会话历史与之前的侧聊问答，无需手动复制。此模式不继承 fork 内部的完整系统提示、工具定义或多模态附件。

指定模型时，主会话历史按最近优先保留，JSON 文本预算为 80,000 字符，另附最多 10,000 字符速览；单条消息超过 16,000 字符、工具输入超过 2,000 字符或结果超过 4,000 字符时也会截短。发生省略时，侧栏和模型收到的上下文都会明确说明，因此不能把它视为完整 fork。默认「跟随主会话」不使用这条手动截取策略。

侧聊不会打断主任务，回答不会自动进入主会话，也不能调用工具或修改文件。每次提问会消耗当前订阅或 API 额度；fork 可复用主会话提示缓存，指定模型的请求使用独立的缓存前缀，缓存命中由服务端决定。

侧聊记录按会话保存在本机插件存储中，`/clear`、`/resume` 和 `/branch` 会切换到对应记录。每个会话保留最近 8 组问答，最多保留 15 个会话；问题限 2000 字符，过长的回答会在 4000 字符处截断。清空侧聊只删除当前会话的侧聊记录。

## 图标

默认使用 Nerd Font，终端需要装 Nerd Font。没有的话在插件设置里把 `icons` 改为 `unicode`。Desktop 和 VS Code 总是用 unicode 符号。

## 开发

```sh
cd scripts
npm install
npm test                         # 纯函数单测
npm run preview -- --cols 44     # 在终端预览速览，可加 --icons unicode
npm run preview -- --chat --cols 40  # 预览侧聊；加 --empty 查看空状态，加 --models 查看选模
npm run build:vendor             # 重新打包流程图引擎
cd ..
claude plugin test               # 速览与侧聊的会话级测试
```

## 致谢

- [Side Chat](https://github.com/moka-apps/side-chat)：侧聊功能的灵感来源
- [catch-me-up](https://github.com/oliverow/catch-me-up)（MIT，Oliver Wang）：更新调度、存储与 `/clear`、`/resume` 处理沿用自它
- [prismantis](https://github.com/NahumLitvin/prismantis)（MIT）：终端里画 Mermaid 的方法，以及引擎的两处补丁
- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)（MIT，Craft Docs）：字符画引擎，打包在 `hooks/vendor/`，许可见 `hooks/vendor/LICENSE.beautiful-mermaid`
