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

Octo 的 HTTP、校验和 SSE 代码在 `adapters/octo.ts`，离线数据在 `adapters/example.ts`。当前实现支持这两种来源。接入 DSH、Codex 或 AGY 时，先实现历史读取和原文定位。涉及宿主原生的会话 fork 时，应由适配器显式提供独立会话的操作及可用切点，并在界面上与共享会话的话题操作区分。
