import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agyHost } from "../adapters/agy";
import { codexHost } from "../adapters/codex";
import { dshHost } from "../adapters/dsh";
import { lineageDirectory } from "../host/lineage";
import { sessionTree } from "../host/session-host";
import { layoutRounds, topicId } from "../lib/topic-map";

test("Codex 按历史轮次分叉，重启后只在子分支绘制新增轮次", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "conversation-tree-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = topicId.parse("root");
  const child = topicId.parse("child");
  const turn = (id: string, text: string, status = "completed") => ({ id, status, items: [
    { id: "q", type: "userMessage", content: [{ type: "text", text }] },
    { id: "a", type: "agentMessage", text: `Reply to ${text}` },
  ] });
  const first = turn("t1", "First question");
  const second = turn("t2", "Second question");
  const active = turn("t3", "In progress", "inProgress");
  const newTurn = turn("t2", "Child question");
  let forks = 0;
  const host = codexHost(async (method, params) => {
    if (method === "thread/read" && "threadId" in params) return { thread: { id: params.threadId, name: params.threadId } };
    if (method === "thread/turns/list" && "threadId" in params) {
      if (params.threadId === child && forks === 1) return { data: [first, newTurn] };
      if ("cursor" in params && params.cursor === "page-2") return { data: [second, active] };
      return { data: [first], nextCursor: "page-2" };
    }
    assert.equal(method, "thread/fork");
    assert.deepEqual(params, { threadId: root, lastTurnId: "t1", excludeTurns: true });
    forks++;
    return { thread: { id: child } };
  });
  const tree = sessionTree(host, root, lineageDirectory(directory));
  const initial = await tree.snapshot();
  assert.deepEqual(initial.turns.map((item) => item.forkable), [true, true, false]);
  await assert.rejects(tree.forkAt(root, initial.turns[2].id), /已完成/u);
  assert.equal(forks, 0);
  assert.deepEqual(await tree.forkAt(root, initial.turns[0].id), { topic_id: child });

  const restored = sessionTree(host, root, lineageDirectory(directory));
  const snapshot = await restored.snapshot({ topic: child });
  assert.equal(snapshot.turns.length, 4);
  assert.deepEqual(snapshot.messages.map((entry) => entry.text), ["Child question", "Reply to Child question"]);
  const branchTurn = snapshot.turns.find((item) => item.topic_id === child);
  assert.equal(branchTurn?.parent_turn_id, initial.turns[0].id);
  assert.notEqual(branchTurn?.id, initial.turns[1].id);
  assert(layoutRounds(snapshot.topics, snapshot.turns, new Set(), "").edges.some((edge) => edge.id === branchTurn?.id && !edge.trunk));
  assert.deepEqual(await restored.resume(child), { command: "codex resume child" });
});

test("DSH 把一个用户轮次里的多次模型调用归在一起，并用 turn/end 的 seq 分叉", async () => {
  const event = (type: string, seq: number, data: object) => ({ type, seq, time: 1000, data });
  const content = (text: string) => [{ type: "text", text }];
  const events = [
    event("turn/start", 0, { turn: 1 }),
    event("user/message", 1, { source: { kind: "user" }, content: content("question") }),
    event("user/message", 2, { source: { kind: "injected" }, content: content("internal context") }),
    event("assistant/message", 3, { message: { content: content("checking") } }),
    event("tool/call", 4, { name: "read" }),
    event("tool/result", 5, { message: { content: content("result") } }),
    event("assistant/message", 6, { message: { content: content("answer") } }),
    event("turn/end", 7, { turn: 1, reason: { kind: "completed" } }),
  ];
  const host = dshHost({
    async readSession() { return { session: { id: "dsh-1" }, events }; },
    async fork(params) {
      assert.deepEqual(params, { sessionId: "dsh-1", atSeq: 7, allowMigration: false });
      return { sessionId: "dsh-2" };
    },
  });
  const session = await host.readSession("dsh-1");
  assert.equal(session.turns.length, 1);
  assert.deepEqual(session.turns[0].entries.map((entry) => entry.text), ["question", "checking", "read", "result", "answer"]);
  assert.equal(await host.forkAtTurn?.("dsh-1", session.turns[0].id), "dsh-2");
});

test("AGY 读取指定记录，隐藏系统与思考内容，并提供对应会话的续聊命令", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "conversation-tree-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const id = "00000000-0000-4000-8000-000000000001";
  const path = join(directory, "transcript.jsonl");
  await writeFile(path, [
    { step_index: 0, type: "SYSTEM_MESSAGE", source: "SYSTEM", content: "internal" },
    { step_index: 1, type: "USER_INPUT", source: "USER_EXPLICIT", content: "hello" },
    { step_index: 2, type: "PLANNER_RESPONSE", source: "MODEL", tool_calls: [{ name: "read" }], thinking: "internal" },
    { step_index: 3, type: "PLANNER_RESPONSE", source: "MODEL", content: "hello there" },
  ].map((entry) => JSON.stringify({ ...entry, status: "DONE" })).join("\n") + "\n{unflushed");
  const host = agyHost({ id, path });
  const session = await host.readSession(id);
  assert.deepEqual(session.turns[0].entries.map((entry) => entry.text), ["hello", "read", "hello there"]);
  assert.equal(host.resumeCommand?.(session), `agy --conversation ${id}`);
  assert.equal(host.forkAtTurn, undefined);
});
