"use client";

import { useEffect, useState } from "react";
import { exampleSource } from "@/adapters/example";
import { octoSource, readOctoToken } from "@/adapters/octo";
import { ConversationTree } from "@/components/conversation-tree";
import type { TreeSource } from "@/lib/tree-source";

export default function Home() {
  const [source, setSource] = useState<TreeSource | null>(null);

  useEffect(() => {
    const token = readOctoToken();
    setSource(token ? octoSource(token) : exampleSource);
  }, []);

  return source ? <ConversationTree source={source} /> : null;
}
