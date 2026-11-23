# Conversation Tree · 对话树

把长会话里的主干、分支和每轮问答放在一张图里。点击轮次可以定位原文，打开多个话题时会保留各自的标签页。记录区支持 Markdown、表格和数学公式。

## 本机预览

需要 Node.js 20.9 或更高版本及 npm。

```sh
npm ci
npm run dev
```

打开 [本机预览](http://127.0.0.1:18300)。首页展示六轮离线示例。可以搜索、折叠和缩放树，打开分支、切换标签页并回看消息。

```sh
npm test
npm run build
npm run typecheck
```

生产构建生成 `out/`，由静态文件服务器从站点根目录提供。

## 连接 Octo

从 Octo 的 `baedfa3` 主线版本抽取。项目保留了现有 `/map` 通信协议和 MIT 许可。

1. 构建本项目。将 `out/` 作为 Octo 话题服务器的静态目录。当前 Octo 的默认位置是它仓库内的 `web/out/`，可在替换前保留原目录以便切回；自行启动 `TopicWeb` 时也可以用 `directory` 参数指定目录。
2. 在 Octo 终端运行 `/map`，打开它生成的完整链接。页面和 Octo 的接口由同一个地址提供。
3. 在页面新建、重命名或切换话题。回到 Octo 终端继续提问。Octo 管理共享上下文、模型调用、消息存储和回复归属。

## 宿主适配

`components/conversation-tree.tsx` 是可挂载的 React 页面。`lib/tree-source.ts` 定义页面所需的接口。`readSnapshot` 提供话题、轮次和一页消息，`locateEntry` 定位轮次或原文，`watch` 可选地通知页面重读数据，`editTopic` 可选地提供共享会话里的话题操作。

Octo 的 HTTP、校验和 SSE 代码在 `adapters/octo.ts`，离线数据在 `adapters/example.ts`。Codex、DSH 和 AGY 通过本机连接进程使用同一个页面。运行 `npm run build` 后，用下面的命令启动连接，再打开命令输出的地址。

```sh
npm run connect -- codex --session <thread-id>
npm run connect -- dsh --session <session-id> --file <session.v4.jsonl>
npm run connect -- agy --session <conversation-uuid> --file <transcript.jsonl>
```

| 宿主 | 入口 | 可用操作 |
| --- | --- | --- |
| Codex | 本机 App Server。可用 `--command` 指定原生 CLI 可执行文件路径 | 读取历史、从已完成轮次复制会话、查看该会话的续聊命令 |
| DSH | 从 `/export` ZIP 解压对应会话的 `session.v2.jsonl`、`session.v3.jsonl` 或 `session.v4.jsonl`。也可指定 `readSession` 输出的逻辑快照 JSON | 导入入口支持查看历史。DSH 原生适配可绑定 `sessionController.fork`，按 `turn/end` 的 `seq` 分叉 |
| AGY | 选择会话 ID 及其本机 `transcript.jsonl`，路径可以从官方 hooks 的 `transcriptPath` 或状态栏取得 | 读取历史、查看按 ID 续聊的命令。AGY 自身的分叉在宿主里完成 |

已连接的外部会话用页面的刷新按钮读取新记录。「查看续聊命令」显示由宿主适配器生成的命令，由用户在终端执行。分叉关系保存在本机 `~/.conversation-tree/`，可用 `--state` 指定目录。详细接口见 [宿主接入设计](docs/host-integration.md)。
