import type { Message, Snapshot, TopicCommand, TopicId } from "./topic-map";

export type SnapshotQuery = { topic?: TopicId } & (
  | { before?: number; after?: never }
  | { before?: never; after?: number }
);

export interface TreeSource {
  kind: "example" | "topics" | "sessions";
  name: string;
  readSnapshot(query?: SnapshotQuery): Promise<Snapshot>;
  locateEntry(entry: Message["id"]): Promise<{
    topic_id: TopicId;
    seq: number;
    entry_id: string;
  }>;
  editTopic?(command: TopicCommand): Promise<TopicId>;
  resume?(topic: TopicId): Promise<string>;
  fork?(topic: TopicId, turn: string): Promise<TopicId>;
  watch?(
    onChange: () => void,
    onDisconnect: (reason: string) => void,
  ): () => void;
}
