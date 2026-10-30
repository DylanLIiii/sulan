# 速览 · sulan

Claude Code mod：在侧边 pane 实时显示会话速览。离开几天回来，扫一眼就能接着干。

- 分节摘要：目标、做了什么、结论、现状、需要你，每条带状态图标
- 末尾是进度区：进度条、彩色流程图（✓ 完成 ◐ 进行中 ○ 未开始 ✗ 失败），再加一两行说明
- 输入框下方常驻一行 TL;DR
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

- `/sulan` 打开 pane；终端够宽时会自动停靠
- `r` 刷新，`b` 从头重建
- 写作规则在 `INSTRUCTIONS.md`，可以直接改

## 图标

默认使用 Nerd Font，终端需要装 Nerd Font。没有的话在插件设置里把 `icons` 改为 `unicode`。Desktop 和 VS Code 总是用 unicode 符号。

## 开发

```sh
cd scripts
npm install
npm test                         # 纯函数单测
npm run preview -- --cols 44     # 在终端预览 pane，可加 --icons unicode
npm run build:vendor             # 重新打包流程图引擎
claude plugin test               # 会话级测试（tests/sulan.test.ts）
```

## 致谢

- [catch-me-up](https://github.com/oliverow/catch-me-up)（MIT，Oliver Wang）：更新调度、存储与 `/clear`、`/resume` 处理沿用自它
- [prismantis](https://github.com/NahumLitvin/prismantis)（MIT）：终端里画 Mermaid 的方法，以及引擎的两处补丁
- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)（MIT，Craft Docs）：字符画引擎，打包在 `hooks/vendor/`，许可见 `hooks/vendor/LICENSE.beautiful-mermaid`
