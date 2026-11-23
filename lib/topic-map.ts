import { z } from "zod";

export const topicId = z.string().min(1).max(128).brand<"TopicId">();
const sessionId = z.string().min(1).brand<"SessionId">();
const entryId = z.string().min(1).brand<"EntryId">();
const topicSchema = z.object({
  id: topicId,
  parent_id: topicId.nullable(),
  anchor_entry_id: entryId.nullable(),
  title: z.string(),
  kind: z.enum(["trunk", "branch"]),
  branch_label: z.string(),
  parent_label: z.string().nullable(),
  latest_entry_id: entryId.nullable(),
  message_count: z.number().int().nonnegative(),
});
export const turnSchema = z.object({
  id: z.string(),
  topic_id: topicId,
  first_entry_id: entryId,
  last_entry_id: entryId,
  first_seq: z.number().int(),
  title: z.string(),
  message_count: z.number().int(),
  parent_turn_id: z.string().nullable(),
  entry_ids: z.array(entryId),
  number: z.number().int().positive(),
  forkable: z.boolean().optional(),
});
export type Turn = z.infer<typeof turnSchema>;
export const messageSchema = z.object({
  id: entryId,
  seq: z.number().int(),
  role: z.string(),
  text: z.string(),
  timestamp: z.number().nullable(),
  request_id: z.string().nullable(),
});
export const snapshotSchema = z
  .object({
    session_id: sessionId,
    title: z.string(),
    topics: z.array(topicSchema).min(1),
    turns: z.array(turnSchema),
    selected_topic_id: topicId,
    viewed_topic_id: topicId,
    active_topic_id: topicId.nullable(),
    running: z.boolean(),
    messages: z.array(messageSchema),
    has_more: z.boolean(),
    before: z.number().nullable(),
    after: z.number().int().nonnegative().nullable().default(null),
    has_newer: z.boolean().default(false),
  })
  .superRefine((snapshot, context) => {
    const ids = new Set(snapshot.topics.map((topic) => topic.id));
    if (
      ids.size !== snapshot.topics.length ||
      !ids.has(snapshot.selected_topic_id) ||
      !ids.has(snapshot.viewed_topic_id)
    ) {
      context.addIssue({ code: "custom", message: "Invalid topic identities" });
    }
    const parents = new Map(
      snapshot.topics.map((topic) => [topic.id, topic.parent_id]),
    );
    for (const topic of snapshot.topics) {
      const visited = new Set<TopicId>();
      let current: TopicId | null = topic.id;
      while (current !== null) {
        if (!ids.has(current) || visited.has(current)) {
          context.addIssue({
            code: "custom",
            message: "Invalid topic hierarchy",
          });
          break;
        }
        visited.add(current);
        current = parents.get(current) ?? null;
      }
    }
  });
export type TopicId = z.infer<typeof topicId>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Topic = Snapshot["topics"][number];
export type Message = Snapshot["messages"][number];
export type TopicCommand = {
  session_id: Snapshot["session_id"];
  topic_id: TopicId;
} & (
  | {
      action: "create";
      title: string;
      anchor_entry_id: Message["id"] | null;
      activate: boolean;
    }
  | { action: "rename"; title: string }
  | { action: "select" }
);

export function visibleTopics(
  topics: Topic[],
  collapsed: Set<TopicId>,
  query: string,
) {
  const byParent = new Map<TopicId | null, Topic[]>();
  for (const topic of topics) {
    const siblings = byParent.get(topic.parent_id) ?? [];
    siblings.push(topic);
    byParent.set(topic.parent_id, siblings);
  }
  const included = new Set<TopicId>();
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  for (const topic of topics) {
    if (
      !topic.title
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
    )
      continue;
    let current: Topic | undefined = topic;
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current =
        current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
  }
  const rows: { topic: Topic; depth: number; hasChildren: boolean }[] = [];
  const stack = [...(byParent.get(null) ?? [])]
    .reverse()
    .map((topic) => ({ topic, depth: 0 }));
  while (stack.length) {
    const row = stack.pop();
    if (!row || !included.has(row.topic.id)) continue;
    const children = byParent.get(row.topic.id) ?? [];
    rows.push({ ...row, hasChildren: children.length > 0 });
    if (!query && collapsed.has(row.topic.id)) continue;
    for (const topic of [...children].reverse())
      stack.push({ topic, depth: row.depth + 1 });
  }
  return rows;
}

export function layoutRounds(
  topics: Topic[],
  turns: Turn[],
  collapsed: Set<string>,
  query: string,
) {
  type Node = {
    id: string;
    parent_id: string | null;
    topic: Topic;
    title: string;
    entry_id: Message["id"] | null;
    number: number | null;
    message_count: number;
    isLatest: boolean;
    kind: "root" | "turn" | "empty";
  };
  const main = topics.find((topic) => topic.kind === "trunk");
  if (!main)
    return { nodes: [], edges: [], width: 280, height: 180, levels: 0 };
  const byTopic = new Map(topics.map((topic) => [topic.id, topic]));
  const entryTurn = new Map(
    turns.flatMap((turn) => turn.entry_ids.map((entry) => [entry, turn.id])),
  );
  const latest = new Map<TopicId, string>();
  for (const turn of turns) latest.set(turn.topic_id, turn.id);
  const source: Node[] = [
    {
      id: "session-root",
      parent_id: null,
      topic: main,
      title: "会话主干",
      entry_id: null,
      number: null,
      message_count: 0,
      isLatest: false,
      kind: "root",
    },
  ];
  for (const turn of turns) {
    const topic = byTopic.get(turn.topic_id);
    if (!topic) continue;
    source.push({
      id: turn.id,
      parent_id: turn.parent_turn_id ?? "session-root",
      topic,
      title: turn.title,
      entry_id: turn.last_entry_id,
      number: turn.number,
      message_count: turn.message_count,
      isLatest: turn.last_entry_id === topic.latest_entry_id,
      kind: "turn",
    });
  }
  for (const topic of topics) {
    if (topic.kind === "trunk" || latest.has(topic.id)) continue;
    const parent = topic.anchor_entry_id
      ? entryTurn.get(topic.anchor_entry_id)
      : undefined;
    source.push({
      id: "empty-" + topic.id,
      parent_id:
        parent ??
        (topic.parent_id
          ? (latest.get(topic.parent_id) ??
            (byTopic.get(topic.parent_id)?.kind === "trunk"
              ? "session-root"
              : "empty-" + topic.parent_id))
          : "session-root"),
      topic,
      title: topic.title,
      entry_id: null,
      number: null,
      message_count: 0,
      isLatest: true,
      kind: "empty",
    });
  }
  const byId = new Map(source.map((node) => [node.id, node]));
  const included = new Set<string>();
  for (const node of source) {
    if (
      !(node.title + node.topic.title + node.topic.branch_label)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
    )
      continue;
    let current: Node | undefined = node;
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }
  const children = new Map<string, Node[]>();
  for (const node of source) {
    if (!node.parent_id) continue;
    const siblings = children.get(node.parent_id) ?? [];
    siblings.push(node);
    children.set(node.parent_id, siblings);
  }
  const ordered: (Node & { depth: number; hasChildren: boolean })[] = [];
  const stack = [{ node: source[0], depth: 0 }];
  const visited = new Set<string>();
  while (stack.length) {
    const item = stack.pop();
    if (!item?.node || !included.has(item.node.id) || visited.has(item.node.id))
      continue;
    visited.add(item.node.id);
    const descendants = children.get(item.node.id) ?? [];
    ordered.push({
      ...item.node,
      depth: item.depth,
      hasChildren: descendants.length > 0,
    });
    if (!query && collapsed.has(item.node.id)) continue;
    for (const node of [...descendants].reverse())
      stack.push({ node, depth: item.depth + 1 });
  }
  const positions = new Map<string, number>();
  let leaf = 0;
  for (const node of [...ordered].reverse()) {
    const xs = (children.get(node.id) ?? [])
      .map((child) => positions.get(child.id))
      .filter((x) => x !== undefined);
    const first = xs[0],
      last = xs[xs.length - 1];
    positions.set(
      node.id,
      first !== undefined && last !== undefined
        ? (first + last) / 2
        : 28 + leaf++ * 232,
    );
  }
  const maxX = Math.max(28, ...positions.values());
  const nodes = ordered.map((node) => ({
    ...node,
    x: maxX - (positions.get(node.id) ?? 28) + 28,
    y: 22 + node.depth * 144,
  }));
  const positioned = new Map(nodes.map((node) => [node.id, node]));
  const edges = nodes.flatMap((node) => {
    const parent = node.parent_id ? positioned.get(node.parent_id) : undefined;
    if (!parent) return [];
    const x = parent.x + 95,
      y = parent.y + 92;
    return [
      {
        id: node.id,
        trunk: parent.topic.id === node.topic.id,
        path: `M ${x} ${y} V ${y + 26} H ${node.x + 95} V ${node.y}`,
      },
    ];
  });
  return {
    nodes,
    edges,
    width: maxX + 244,
    height: Math.max(180, ...nodes.map((node) => node.y + 130)),
    levels: Math.max(0, ...nodes.map((node) => node.depth)) + 1,
  };
}

export function openTopicTab(tabs: TopicId[], id: TopicId): TopicId[] {
  return tabs.includes(id) ? tabs : [...tabs, id];
}
