import type { Snapshot } from "./topic-map";

export type PageDirection = "replace" | "older" | "newer";

export function mergeMessagePage(
  current: Snapshot | null,
  page: Snapshot,
  direction: PageDirection,
): Snapshot {
  if (
    !current ||
    direction === "replace" ||
    current.session_id !== page.session_id ||
    current.viewed_topic_id !== page.viewed_topic_id
  )
    return page;
  const messages = [
    ...new Map(
      [...current.messages, ...page.messages].map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ].sort((left, right) => left.seq - right.seq);
  return {
    ...page,
    messages,
    before:
      direction === "older" ? (page.before ?? current.before) : current.before,
    has_more: direction === "older" ? page.has_more : current.has_more,
    after:
      direction === "newer" ? (page.after ?? current.after) : current.after,
    has_newer: direction === "newer" ? page.has_newer : current.has_newer,
  };
}
