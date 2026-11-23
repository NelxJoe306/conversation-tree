# 宿主接入设计

`host/session-host.ts` 定义宿主侧接口。`readSession(id)` 返回一个会话按时间排序的轮次，每轮包含消息、工具记录、稳定 ID 和完成状态。`resumeCommand(session)` 与 `forkAtTurn(sessionId, turnId)` 是可选能力。适配器只应提供宿主可以完整履行的操作。

## 会话与分支

- Octo 使用同一个会话的共享历史。话题操作继续走既有 `/map` 接口。
- 宿主原生分叉接受真实已完成轮次的切点，返回独立的子会话 ID。树用父会话 ID、父轮次 ID、子会话 ID 和继承轮次数保存这条边。父会话展示共享前段，子分支展示宿主新增的轮次。分叉只改变对话历史的续接位置，宿主决定实际上下文。
- 轮次和消息 ID 带上所属会话，即使宿主复制了同一条 ID，也能定位到正确记录。分页游标在每条线上独立，每页最多 60 条。页面访问旧轮次时只读原文。
- 当前树从显式指定的根会话开始。它会恢复自己创建的分叉关系。通过宿主其他入口创建的会话可以按 ID 单独打开。
- 分叉成功但索引保存失败时，错误会附带宿主返回的子会话 ID，方便直接打开现有会话。

## 本机协议 v1

`serveTree` 把 `out/` 和以下路由绑定在同一个回环地址。页面从启动链接的片段中读取连接令牌，用 `X-Tree-Token` 请求同源接口。

| 方法和路径 | 作用 |
| --- | --- |
| `GET /api/tree/v1` | 返回 `{version, name, open, fork}`，页面依据这些能力显示操作 |
| `GET /api/tree/v1/snapshot` | 返回全树结构和指定会话的一页记录。查询参数为 `topic` 与互斥的 `before`、`after` |
| `GET /api/tree/v1/anchor?entry=…` | 返回消息所在会话和页内定位游标 |
| `GET /api/tree/v1/resume?topic=…` | 返回 `{command}`，由用户在宿主中执行 |
| `POST /api/tree/v1/fork` | 接收 `{topic, turn}`，仅从该会话已完成的轮次分叉，返回 `{topic_id}` |

## 各宿主的映射

**Codex** 用 `thread/read` 读取标题，用 `thread/turns/list` 按原生游标读取历史。分叉把原生轮次 ID 交给 `thread/fork.lastTurnId`。可用 `--command` 绕过指向旧安装的命令代理。查看会话只发读取请求。 [Codex App Server](https://learn.chatgpt.com/docs/app-server)

**DSH** 的原生宿主可以把 `ctx.sessionQuery.readSession` 和 `ctx.sessionController.fork` 注入 `dshHost`，并在宿主扩展卸载时关闭 `serveTree` 返回的连接。接线处负责用 DSH 当前版本的 `brandString<SessionId>` 转换会话 ID。`readSession` 返回逻辑日志，`fork` 接收 `{sessionId, atSeq, allowMigration: false}`。先在 DSH 打开需要迁移的旧会话，再执行分叉。文件入口读取手动选定的日志，适合独立预览。 [会话查询](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-query/README.md) · [原生分叉](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.md) · [日志导出](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-log-export/README.md)

在已经取得 DSH 插件 `ctx` 和用户所选 `rootId` 的位置，接线如下。`assets` 指向构建后的静态目录，`stateDirectory` 在本机按根会话分配。

```ts
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { dshHost } from "./adapters/dsh";
import { lineageDirectory } from "./host/lineage";
import { serveTree } from "./host/server";

const host = dshHost({
  readSession: (id) => ctx.sessionQuery.readSession(brandString<SessionId>(id)),
  fork: ({ sessionId, atSeq, allowMigration }) => ctx.sessionController.fork({
    sessionId: brandString<SessionId>(sessionId), atSeq, allowMigration,
  }),
});
const connection = await serveTree({ host, rootId, assets, lineage: lineageDirectory(stateDirectory) });
ctx.on("dispose", () => { connection.close(); });
// 浏览器打开 connection.url。
```

**AGY** 读取用户选定的 CLI 会话记录，按显式用户输入划分轮次，显示模型正文和工具名称。以 `step_index` 去重，适配同一条记录重复写入状态的情况。用 `agy --conversation ID` 继续提问。当前接入路径兼容本机 AGY 1.4.5 的记录形状。 [状态栏字段](https://antigravity.google/docs/cli/statusline/) · [续聊](https://antigravity.google/docs/cli/conversations/)
