import assert from "node:assert/strict";
import test from "node:test";
import { snapshotSchema } from "../lib/topic-map";
import { mergeMessagePage } from "../lib/message-window";

function page(sequences: number[], options = {}) {
  return snapshotSchema.parse({
    session_id: "session",
    title: "fixture",
    selected_topic_id: "main",
    viewed_topic_id: "main",
    active_topic_id: null,
    running: false,
    turns: [],
    topics: [
      {
        id: "main",
        parent_id: null,
        anchor_entry_id: null,
        title: "main",
        kind: "trunk",
        branch_label: "主干",
        parent_label: null,
        latest_entry_id: null,
        message_count: 230,
      },
    ],
    messages: sequences.map((seq) => ({
      id: `entry-${seq}`,
      seq,
      role: "assistant",
      text: `answer-${seq}`,
      timestamp: 0,
      request_id: null,
    })),
    before: sequences[0] ?? null,
    after: sequences.at(-1) ?? null,
    has_more: false,
    has_newer: true,
    ...options,
  });
}
test("old node pages extend continuously to the latest and retain the old anchor", () => {
  let current = page([1, 2, 3]);
  current = mergeMessagePage(
    current,
    page([4, 5], { has_more: true }),
    "newer",
  );
  current = mergeMessagePage(
    current,
    page([5, 6], { has_more: true, has_newer: false }),
    "newer",
  );
  assert.deepEqual(
    current.messages.map((message) => message.seq),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(current.before, 1);
  assert.equal(current.after, 6);
  assert.equal(current.has_more, false);
  assert.equal(current.has_newer, false);
});
test("loading earlier history preserves newer messages and both window cursors", () => {
  const merged = mergeMessagePage(
    page([5, 6], { has_more: true, has_newer: false }),
    page([3, 4], { has_more: true }),
    "older",
  );
  assert.deepEqual(
    merged.messages.map((message) => message.seq),
    [3, 4, 5, 6],
  );
  assert.equal(merged.before, 3);
  assert.equal(merged.after, 6);
  assert.equal(merged.has_newer, false);
});
test("an empty refresh retains loaded history and cursor while updating metadata", () => {
  const merged = mergeMessagePage(
    page([1, 2, 3]),
    page([], { after: 3, has_newer: false, running: true }),
    "newer",
  );
  assert.equal(merged.messages.length, 3);
  assert.equal(merged.after, 3);
  assert.equal(merged.running, true);
});
test("a different topic, session or explicit jump replaces the window", () => {
  const current = page([1, 2, 3]);
  for (const options of [
    { session_id: "other" },
    {
      viewed_topic_id: "branch",
      selected_topic_id: "branch",
      topics: [
        {
          id: "branch",
          parent_id: null,
          anchor_entry_id: null,
          title: "branch",
          kind: "branch",
          branch_label: "分支",
          parent_label: null,
          latest_entry_id: null,
          message_count: 1,
        },
      ],
    },
  ]) {
    const next = page([9], options);
    assert.equal(mergeMessagePage(current, next, "newer"), next);
  }
  const latest = page([99]);
  assert.equal(mergeMessagePage(current, latest, "replace"), latest);
});
