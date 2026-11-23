"use client";

import { useEffect, useState } from "react";
import { browserHostSource } from "@/adapters/browser-host";
import { exampleSource } from "@/adapters/example";
import { octoSource, readOctoToken } from "@/adapters/octo";
import { ConversationTree } from "@/components/conversation-tree";
import type { TreeSource } from "@/lib/tree-source";

export default function Home() {
  const [source, setSource] = useState<TreeSource | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(location.search).get("source") === "host") {
      let disposed = false;
      void browserHostSource().then(
        (connected) => { if (!disposed) setSource(connected); },
        (failure: unknown) => { if (!disposed) setError(failure instanceof Error ? failure.message : "连接失败"); },
      );
      return () => { disposed = true; };
    }
    const token = readOctoToken();
    setSource(token ? octoSource(token) : exampleSource);
  }, []);

  if (error) return <p className="notice error" role="alert">{error}</p>;
  return source ? <ConversationTree source={source} /> : null;
}
