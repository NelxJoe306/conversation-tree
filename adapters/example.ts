import { snapshotSchema } from "@/lib/topic-map";
import type { TreeSource } from "@/lib/tree-source";

const rounds = [
  { id: "r1", topic: "main", parent: null, number: 1, question: "部署前要检查什么？", answer: "先确认运行环境、配置和存储目录，再检查服务状态。" },
  { id: "r2", topic: "main", parent: "r1", number: 2, question: "健康检查怎么设计？", answer: "用 `GET /health` 检查服务是否能接收请求，并单独记录依赖状态。" },
  { id: "r3", topic: "main", parent: "r2", number: 3, question: "回滚时保留哪些数据？", answer: "保留会话数据库和配置，并记录切换前的版本。" },
  { id: "r4", topic: "database", parent: "r1", number: 1, question: "SQLite 迁移前怎么备份？", answer: "用 SQLite 的备份接口生成一致性快照。\n\n| 阶段 | 检查 |\n| --- | --- |\n| 迁移前 | 备份可读 |\n| 迁移后 | 会话可恢复 |" },
  { id: "r5", topic: "database", parent: "r4", number: 2, question: "怎么验证备份可以恢复？", answer: "用临时目录恢复一份副本，再读取旧会话和话题索引。" },
  { id: "r6", topic: "monitoring", parent: "r2", number: 1, question: "如何计算请求成功率？", answer: "成功率为 $p = n_{ok} / n_{total}$。同时记录样本量。" },
];

const messages = rounds.flatMap((round, index) =>
  [round.question, round.answer].map((text, offset) => ({
    id: `${round.id}-${offset}`,
    seq: index * 2 + offset + 1,
    role: offset === 0 ? "user" : "assistant",
    text,
    timestamp: 1795420800 + index * 120 + offset * 10,
    request_id: round.id,
  })),
);

const fixture = snapshotSchema.parse({
  session_id: "example",
  title: "示例 · 部署检查",
  selected_topic_id: "main",
  viewed_topic_id: "main",
  active_topic_id: null,
  running: false,
  messages,
  has_more: false,
  before: null,
  turns: rounds.map((round, index) => ({
    id: round.id,
    topic_id: round.topic,
    first_entry_id: `${round.id}-0`,
    last_entry_id: `${round.id}-1`,
    first_seq: index * 2 + 1,
    title: round.question,
    message_count: 2,
    parent_turn_id: round.parent,
    number: round.number,
    entry_ids: [`${round.id}-0`, `${round.id}-1`],
  })),
  topics: [
    { id: "main", parent_id: null, anchor_entry_id: null, title: "部署检查", kind: "trunk", branch_label: "主干", parent_label: null, latest_entry_id: "r3-1", message_count: 6 },
    { id: "database", parent_id: "main", anchor_entry_id: "r1-1", title: "数据库备份", kind: "branch", branch_label: "分支 1", parent_label: "主干", latest_entry_id: "r5-1", message_count: 4 },
    { id: "monitoring", parent_id: "main", anchor_entry_id: "r2-1", title: "监控指标", kind: "branch", branch_label: "分支 2", parent_label: "主干", latest_entry_id: "r6-1", message_count: 2 },
  ],
});

export const exampleSource: TreeSource = {
  name: "离线示例",
  async readSnapshot(query = {}) {
    const { before, after } = query;
    const topic = query.topic ?? fixture.selected_topic_id;
    const entryIds = new Set(
      fixture.turns.filter((turn) => turn.topic_id === topic).flatMap((turn) => turn.entry_ids),
    );
    const records = fixture.messages.filter((message) => entryIds.has(message.id));
    const page = records.filter(
      (message) => message.seq < (before ?? Infinity) && message.seq > (after ?? 0),
    );
    return {
      ...fixture,
      viewed_topic_id: topic,
      messages: page,
      after: page.at(-1)?.seq ?? after ?? null,
      has_newer: before !== undefined && records.some((message) => message.seq >= before),
    };
  },
  async locateEntry(entry) {
    const message = fixture.messages.find((item) => item.id === entry);
    const turn = fixture.turns.find((item) => item.entry_ids.includes(entry));
    if (!message || !turn) throw new Error("找不到这条示例消息。");
    return { topic_id: turn.topic_id, seq: message.seq, entry_id: message.id };
  },
};
