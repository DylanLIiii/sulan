# 速览 · sulan

Claude Code mod：在侧边 pane 实时显示会话速览，另有一个独立的侧聊 pane。离开几天回来，扫一眼就能接着干；工作进行中，也可以随时追问。

- 分节摘要：目标、做了什么、结论、现状、需要你、名词与概念，每条带状态图标
- 末尾是进度区：进度条、彩色流程图（✓ 完成 ◐ 进行中 ○ 未开始 ✗ 失败），再加一两行说明
- 输入框下方常驻一行 TL;DR
- 侧聊结合当前会话上下文回答问题，支持连续追问、快捷提问和复制回答
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

侧聊使用主会话的模型和已有上下文，不会打断主任务，回答也不会自动进入主会话。它不能调用工具或修改文件；需要主会话先发出过一次模型请求，才能使用。每次提问会消耗当前订阅或 API 额度，主要上下文可由 Claude 的提示缓存复用。

侧聊记录按会话保存在本机插件存储中，`/clear`、`/resume` 和 `/branch` 会切换到对应记录。每个会话保留最近 8 组问答，最多保留 15 个会话；问题限 2000 字符，过长的回答会在 4000 字符处截断。清空侧聊只删除当前会话的侧聊记录。

## 图标

默认使用 Nerd Font，终端需要装 Nerd Font。没有的话在插件设置里把 `icons` 改为 `unicode`。Desktop 和 VS Code 总是用 unicode 符号。

## 开发

```sh
cd scripts
npm install
npm test                         # 纯函数单测
npm run preview -- --cols 44     # 在终端预览速览，可加 --icons unicode
npm run preview -- --chat --cols 40  # 预览侧聊；加 --empty 查看空状态
npm run build:vendor             # 重新打包流程图引擎
cd ..
claude plugin test               # 速览与侧聊的会话级测试
```

## 致谢

- [Side Chat](https://github.com/moka-apps/side-chat)：侧聊功能的灵感来源
- [catch-me-up](https://github.com/oliverow/catch-me-up)（MIT，Oliver Wang）：更新调度、存储与 `/clear`、`/resume` 处理沿用自它
- [prismantis](https://github.com/NahumLitvin/prismantis)（MIT）：终端里画 Mermaid 的方法，以及引擎的两处补丁
- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)（MIT，Craft Docs）：字符画引擎，打包在 `hooks/vendor/`，许可见 `hooks/vendor/LICENSE.beautiful-mermaid`
