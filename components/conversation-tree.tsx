"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mergeMessagePage } from "@/lib/message-window";
import type { PageDirection } from "@/lib/message-window";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranch,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import { MessageContent } from "@/components/message-content";
import { OctoMark } from "@/components/mark";
import { ResizeDivider } from "@/components/resize-divider";
import { layoutRounds, openTopicTab } from "@/lib/topic-map";
import type { Message, Snapshot, TopicCommand, TopicId } from "@/lib/topic-map";
import type { SnapshotQuery, TreeSource } from "@/lib/tree-source";

type Connection =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected"; reason: string };
type Editor =
  | { kind: "closed" }
  | {
      kind: "rename";
      session: Snapshot["session_id"];
      topic: TopicId;
      title: string;
    };

type MessageView = SnapshotQuery & { session?: Snapshot["session_id"] };
type ScrollTarget = { kind: "entry"; id: string } | { kind: "latest" };

export function ConversationTree({ source }: { source: TreeSource }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>({
    kind: "connecting",
  });
  const [tabs, setTabs] = useState<TopicId[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [zoom, setZoom] = useState(1);
  const [treeWidth, setTreeWidth] = useState(360);
  const [width, setWidth] = useState(0);
  const [mobile, setMobile] = useState<"tree" | "records">("tree");
  const [dragging, setDragging] = useState(false);
  const [dark, setDark] = useState(false);
  const [editor, setEditor] = useState<Editor>({ kind: "closed" });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resume, setResume] = useState("");
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const highlight = scrollTarget?.kind === "entry" ? scrollTarget.id : null;
  const [loadingPage, setLoadingPage] = useState(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const loadingRevision = useRef(0);
  const pendingRefresh = useRef(false);
  const recordsPane = useRef<HTMLDivElement>(null);
  const newerSentinel = useRef<HTMLDivElement>(null);
  const prependScroll = useRef<{ height: number; top: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const serial = useRef(0);
  const view = useRef<MessageView>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const topicMenu = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLDivElement>(null);

  async function load(
    next?: MessageView,
    openTab = false,
    direction: PageDirection = "replace",
  ) {
    const refresh = next === undefined;
    if ((refresh || direction !== "replace") && loadingRevision.current) {
      if (refresh) pendingRefresh.current = true;
      return;
    }
    const previous = snapshotRef.current;
    const target = next ?? {
      session: view.current.session,
      topic: view.current.topic,
      after:
        previous?.viewed_topic_id === view.current.topic
          ? (previous?.after ?? undefined)
          : undefined,
    };
    const mode = refresh && previous ? "newer" : direction;
    const oldSession = view.current.session;
    if (mode === "replace") view.current = target;
    const revision = ++serial.current;
    loadingRevision.current = revision;
    setLoadingPage(true);
    try {
      let parsed: Snapshot;
      try {
        parsed = await source.readSnapshot(target);
      } catch (cause) {
        if (!(cause instanceof Error) || cause.message !== "Unknown topic")
          throw cause;
        parsed = await source.readSnapshot();
      }
      const replaced =
        oldSession !== undefined && oldSession !== parsed.session_id;
      if (replaced)
        parsed = await source.readSnapshot();
      if (revision !== serial.current) return;
      const current = snapshotRef.current;
      const sameView =
        current?.session_id === parsed.session_id &&
        current?.viewed_topic_id === parsed.viewed_topic_id;
      if (mode === "older" && sameView && recordsPane.current) {
        prependScroll.current = {
          height: recordsPane.current.scrollHeight,
          top: recordsPane.current.scrollTop,
        };
      } else if (mode === "replace" || !sameView) prependScroll.current = null;
      const merged = mergeMessagePage(
        current,
        parsed,
        replaced ? "replace" : mode,
      );
      view.current = {
        session: merged.session_id,
        topic: merged.viewed_topic_id,
      };
      if (replaced) {
        setCollapsed(new Set());
        setEditor({ kind: "closed" });
        setScrollTarget(null);
      }
      setTabs((previous) => {
        const existing = replaced ? [] : previous;
        return openTab
          ? openTopicTab(existing, parsed.viewed_topic_id)
          : existing;
      });
      snapshotRef.current = merged;
      setSnapshot(merged);
      setConnection({ kind: "connected" });
      return merged;
    } catch (cause) {
      if (revision === serial.current)
        setConnection({
          kind: "disconnected",
          reason: cause instanceof Error ? cause.message : "连接失败",
        });
    } finally {
      if (loadingRevision.current === revision) {
        loadingRevision.current = 0;
        setLoadingPage(false);
        if (pendingRefresh.current) {
          pendingRefresh.current = false;
          void load();
        }
      }
    }
  }

  async function jumpToLatest() {
    const loaded = await load({ topic: snapshotRef.current?.viewed_topic_id });
    if (loaded) setScrollTarget({ kind: "latest" });
  }

  useEffect(() => {
    let disposed = false;
    const unsubscribe = source.watch?.(
      () => {
        if (!disposed) void load();
      },
      (reason) => {
        if (!disposed) setConnection({ kind: "disconnected", reason });
      },
    );
    void load();
    return () => {
      disposed = true;
      ++serial.current;
      loadingRevision.current = 0;
      pendingRefresh.current = false;
      unsubscribe?.();
    };
  }, [source]);

  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (editor.kind === "closed") dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [editor]);

  useLayoutEffect(() => {
    if (scrollTarget?.kind === "entry")
      document
        .getElementById("entry-" + scrollTarget.id)
        ?.scrollIntoView({ block: "center", behavior: "instant" });
    else if (scrollTarget?.kind === "latest" && recordsPane.current)
      recordsPane.current.scrollTo({
        top: recordsPane.current.scrollHeight,
        behavior: "instant",
      });
  }, [scrollTarget]);

  useLayoutEffect(() => {
    const previous = prependScroll.current;
    if (previous && recordsPane.current) {
      recordsPane.current.scrollTo({
        top: previous.top + recordsPane.current.scrollHeight - previous.height,
        behavior: "instant",
      });
      prependScroll.current = null;
    }
  }, [snapshot?.messages]);

  useEffect(() => {
    if (
      connection.kind !== "connected" ||
      !snapshot?.has_newer ||
      snapshot.after === null ||
      !newerSentinel.current ||
      !recordsPane.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const topic = snapshot.viewed_topic_id,
      after = snapshot.after;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          void load({ topic, after }, false, "newer");
      },
      { root: recordsPane.current, rootMargin: "0px 0px 160px 0px" },
    );
    observer.observe(newerSentinel.current);
    return () => observer.disconnect();
  }, [
    snapshot?.session_id,
    snapshot?.viewed_topic_id,
    snapshot?.after,
    snapshot?.has_newer,
    mobile,
    loadingPage,
    connection.kind,
  ]);

  useEffect(() => {
    tabBar.current
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs, mobile, snapshot?.viewed_topic_id]);

  async function locate(entry: Message["id"]) {
    try {
      const anchor = await source.locateEntry(entry);
      setMobile("records");
      setScrollTarget(null);
      const loaded = await load(
        { topic: anchor.topic_id, before: anchor.seq + 1 },
        true,
      );
      if (loaded) setScrollTarget({ kind: "entry", id: anchor.entry_id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法定位原文");
    }
  }

  const rows = snapshot ? snapshot.topics : [];
  const tree = layoutRounds(
    snapshot?.topics ?? [],
    snapshot?.turns ?? [],
    collapsed,
    query,
  );
  const selected = snapshot?.topics.find(
    (topic) => topic.id === snapshot.viewed_topic_id,
  );
  const current = snapshot?.topics.find(
    (topic) => topic.id === snapshot.selected_topic_id,
  );
  const split = width >= 780;
  const maxWidth = Math.max(260, Math.min(640, width - 390));
  const panelWidth = Math.max(260, Math.min(treeWidth, maxWidth));
  const connected = connection.kind === "connected";
  const forkableTurns = new Map(
    snapshot?.turns.filter((turn) => turn.forkable).map((turn) => [turn.last_entry_id, turn]),
  );

  async function command(body: TopicCommand, target?: TopicId) {
    if (!source.editTopic) return;
    setBusy(true);
    setError("");
    try {
      const topic = await source.editTopic(body);
      setEditor({ kind: "closed" });
      setMobile("records");
      await load({ topic: target ?? topic }, true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "操作失败，请刷新检查结果",
      );
    } finally {
      setBusy(false);
    }
  }
  async function activateTopic(
    id: TopicId,
    entry: Message["id"] | null = null,
  ) {
    if (!snapshot || busy) return;
    setResume("");
    setScrollTarget(null);
    if (!source.editTopic) {
      if (entry) await locate(entry);
      else {
        setMobile("records");
        if (await load({ topic: id }, true)) setScrollTarget({ kind: "latest" });
      }
      return;
    }
    await command({
      action: "select",
      session_id: snapshot.session_id,
      topic_id: id,
    });
    if (entry) await locate(entry);
    else setScrollTarget({ kind: "latest" });
  }
  function create(anchor: Message["id"] | null = null) {
    if (!selected || !snapshot) return;
    const number = snapshot.topics.length;
    let name = `新分支 ${number}`;
    for (
      let suffix = number;
      snapshot.topics.some((topic) => topic.title === name);
      suffix++
    )
      name = `新分支 ${suffix + 1}`;
    void command({
      action: "create",
      session_id: snapshot.session_id,
      topic_id: selected.id,
      title: name,
      anchor_entry_id: anchor,
      activate: true,
    });
  }

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(message.id);
    } catch {
      setError("复制失败，可选中消息正文手动复制。");
    }
  }

  async function showResume(id: TopicId) {
    if (!source.resume) return;
    setBusy(true);
    setError("");
    try {
      setResume(await source.resume(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取续聊命令");
    } finally {
      setBusy(false);
    }
  }

  async function fork(id: TopicId, turn: string) {
    if (!source.fork) return;
    setBusy(true);
    setError("");
    setResume("");
    try {
      const child = await source.fork(id, turn);
      setScrollTarget(null);
      await load({ topic: child }, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "会话分叉失败，请检查宿主");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className={`map-app ${dragging ? "is-dragging" : ""}`}
      data-theme={dark ? "dark" : "light"}
    >
      <header className="topbar">
        <div className="brand">
          <OctoMark />
          <strong>对话树</strong>
        </div>
        <div className="session-strip" title={snapshot?.title}>
          <Terminal size={17} />
          <strong>{snapshot?.title ?? source.name}</strong>
          {source.editTopic && <span>终端当前：{current?.title ?? "—"}</span>}
          {snapshot?.running && (
            <span className="running">
              <i />
              正在生成
            </span>
          )}
        </div>
        <div className="top-actions">
          <span className={`connection ${connected ? "online" : ""}`}>
            <i />
            {connected
              ? source.name
              : connection.kind === "connecting"
                ? "正在连接"
                : "未连接"}
          </span>
          <button
            className="icon-button"
            aria-label="刷新话题"
            onClick={() => void load()}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={dark ? "切换浅色主题" : "切换深色主题"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      {connection.kind === "disconnected" && (
        <div className="notice" role="status">
          {connection.reason}
          <button onClick={() => void load()}>重新连接</button>
        </div>
      )}
      {error && editor.kind === "closed" && (
        <div className="notice error" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="branch-toolbar">
        <div
          className="branch-tabs"
          ref={tabBar}
          role="tablist"
          aria-label="已打开的话题"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button[role=tab]",
              ),
            );
            const current = buttons.findIndex(
              (button) => button === document.activeElement,
            );
            if (current < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (current +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
            buttons[next]?.click();
          }}
        >
          <button
            role="tab"
            aria-selected={mobile === "tree"}
            onClick={() => setMobile("tree")}
          >
            <GitBranch size={15} />
            话题地图
          </button>
          {tabs.map((id) => {
            const topic = snapshot?.topics.find((item) => item.id === id);
            if (!topic) return null;
            return (
              <div
                className={`branch-tab ${mobile === "records" && selected?.id === id ? "active" : ""}`}
                key={id}
              >
                <button
                  role="tab"
                  disabled={busy || !connected}
                  aria-selected={mobile === "records" && selected?.id === id}
                  title={topic.title}
                  onClick={() => {
                    setMobile("records");
                    void activateTopic(id);
                  }}
                >
                  {topic.title}
                </button>
                <button
                  className="close-tab"
                  aria-label={`关闭${topic.title}标签`}
                  onClick={() => {
                    const index = tabs.indexOf(id);
                    const remaining = tabs.filter((item) => item !== id);
                    setTabs(remaining);
                    if (selected?.id === id) {
                      const neighbor = remaining[Math.max(0, index - 1)];
                      if (neighbor) void activateTopic(neighbor);
                      else setMobile("tree");
                    }
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="branch-controls">
          <button
            className="topic-switcher"
            aria-label="切换当前分支"
            aria-haspopup="menu"
            popoverTarget="topic-picker"
            disabled={!connected || busy || !snapshot}
          >
            <span>{(source.editTopic ? current : selected)?.title ?? "等待连接"}</span>
            <ChevronDown size={13} />
          </button>
          <div
            ref={topicMenu}
            id="topic-picker"
            className="topic-options"
            popover="auto"
            role="menu"
            aria-label="选择分支"
          >
            {snapshot?.topics.map((topic) => (
              <button
                key={topic.id}
                role="menuitemradio"
                aria-checked={topic.id === (source.editTopic ? snapshot.selected_topic_id : snapshot.viewed_topic_id)}
                disabled={busy || !connected}
                onClick={() => {
                  topicMenu.current?.hidePopover();
                  void activateTopic(topic.id);
                }}
              >
                <span>
                  {topic.kind === "trunk" ? "主干" : topic.branch_label} ·{" "}
                  {topic.title}
                </span>
                {topic.id === (source.editTopic ? snapshot.selected_topic_id : snapshot.viewed_topic_id) && <Check size={14} />}
              </button>
            ))}
          </div>
          {source.editTopic && <button
            className="new-branch"
            disabled={!connected || busy || !selected}
            onClick={() => create()}
            title="从正在查看的话题创建，并切换终端"
          >
            <Plus size={14} />
            新建分支
          </button>}
        </div>
      </div>
      <div
        ref={frame}
        className={`workspace ${split ? "split" : "compact"} ${mobile === "tree" ? "map-surface" : "topic-surface"}`}
      >
        <section
          className="tree-panel"
          style={
            mobile === "tree"
              ? { width: "100%" }
              : split
                ? { width: panelWidth }
                : { display: "none" }
          }
          aria-label="话题导航"
        >
          <div className="panel-heading">
            <div>
              <h1>对话轮次</h1>
            </div>
            {source.editTopic && <button
              className="icon-button"
              aria-label="新建并切换分支"
              disabled={!connected || !selected || busy}
              onClick={() => create()}
            >
              <Plus size={19} />
            </button>}
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索话题"
              placeholder="查找一个话题…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav className="tree-scroll" aria-label="话题树">
            {rows.length ? (
              <div
                className="tree-space"
                style={{
                  width: tree.width * zoom,
                  height: tree.height * zoom,
                }}
              >
                <div
                  className="tree-nodes"
                  style={{
                    transform: `scale(${zoom})`,
                    width: tree.width,
                    height: tree.height,
                  }}
                >
                  <svg
                    className="tree-connections"
                    width={tree.width}
                    height={tree.height}
                    aria-hidden="true"
                  >
                    {tree.edges.map((edge) => (
                      <path
                        key={edge.id}
                        d={edge.path}
                        className={edge.trunk ? "trunk-edge" : "branch-edge"}
                      />
                    ))}
                  </svg>
                  {tree.nodes.map(
                    ({
                      topic,
                      depth,
                      hasChildren,
                      x,
                      y,
                      id,
                      title: turnTitle,
                      entry_id,
                      number,
                      message_count,
                      kind,
                      isLatest,
                    }) => (
                      <div
                        className={`topic-row node-${kind} depth-${depth} ${snapshot?.viewed_topic_id === topic.id && (highlight ? highlight === entry_id : isLatest) ? "viewed" : ""}`}
                        key={id}
                        style={{ left: x, top: y }}
                      >
                        {hasChildren ? (
                          <button
                            className="collapse"
                            aria-label={`${collapsed.has(id) ? "展开" : "折叠"}${topic.title}`}
                            aria-expanded={!collapsed.has(id)}
                            onClick={() =>
                              setCollapsed((previous) => {
                                const next = new Set(previous);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                return next;
                              })
                            }
                          >
                            {collapsed.has(id) ? (
                              <ChevronRight size={15} />
                            ) : (
                              <ChevronDown size={15} />
                            )}
                          </button>
                        ) : (
                          <span className="node-dot" />
                        )}
                        <button
                          className="topic-card"
                          disabled={busy || !connected}
                          aria-current={
                            snapshot?.viewed_topic_id === topic.id
                              ? "true"
                              : undefined
                          }
                          onClick={() => {
                            void activateTopic(topic.id, entry_id);
                          }}
                        >
                          <span className={`branch-identity ${topic.kind}`}>
                            {topic.branch_label}
                            <small>
                              {topic.parent_label
                                ? `属 ${topic.parent_label}`
                                : "会话根"}
                            </small>
                          </span>
                          <span className="round-label">
                            {kind === "root"
                              ? "会话起点"
                              : kind === "empty"
                                ? "尚未开始"
                                : `第 ${number} 轮`}
                          </span>
                          <span className="topic-title" title={turnTitle}>
                            {turnTitle}
                          </span>
                          <span className="node-meta">
                            {kind === "turn"
                              ? `${message_count} 条消息`
                              : kind === "empty"
                                ? "未产生对话"
                                : source.kind === "sessions" ? "宿主会话" : "共享会话"}
                            {source.editTopic && snapshot?.selected_topic_id === topic.id &&
                              isLatest && <em>终端当前</em>}
                            {snapshot?.running &&
                              snapshot.active_topic_id === topic.id && (
                                <em className="running">
                                  <i />
                                  生成中
                                </em>
                              )}
                          </span>
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-small">
                {snapshot
                  ? "没有找到这个话题"
                  : "等待加载对话记录。"}
              </div>
            )}
          </nav>
          <footer className="tree-footer">
            <span>
              {snapshot?.turns.length ?? 0} 轮对话 ·{" "}
              {snapshot?.topics.length ?? 0} 条线
            </span>
            <div>
              <button
                className="fit-map"
                onClick={() =>
                  setZoom(
                    Math.max(0.35, Math.min(1, (width - 48) / tree.width)),
                  )
                }
              >
                适应窗口
              </button>
              <button
                className="icon-button"
                aria-label="缩小话题树"
                disabled={zoom <= 0.35}
                onClick={() =>
                  setZoom(Math.max(0.35, +(zoom - 0.1).toFixed(2)))
                }
              >
                <Minus size={15} />
              </button>
              <button
                className="zoom-value"
                aria-label="重置缩放"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="放大话题树"
                disabled={zoom >= 1.5}
                onClick={() => setZoom(Math.min(1.5, +(zoom + 0.1).toFixed(1)))}
              >
                <Plus size={15} />
              </button>
            </div>
          </footer>
        </section>
        {split && mobile === "records" && (
          <ResizeDivider
            side="left"
            value={panelWidth}
            min={260}
            max={maxWidth}
            onChange={setTreeWidth}
            onDragging={setDragging}
            label="调整话题树宽度"
            resetValue={360}
          />
        )}
        <section
          className="records-panel"
          style={mobile === "tree" ? { display: "none" } : undefined}
          aria-label="话题消息记录"
        >
          <div className="record-heading">
            <div>
              <span className="eyebrow">
                {selected?.branch_label ?? "话题记录"}
              </span>
              <h2>{selected?.title ?? "对话记录"}</h2>
            </div>
            {source.editTopic && selected && snapshot && (
              <div className="record-actions">
                <button
                  disabled={!connected || busy || selected.kind === "trunk"}
                  onClick={() => {
                    setTitle(selected.title);
                    setError("");
                    setEditor({
                      kind: "rename",
                      session: snapshot.session_id,
                      topic: selected.id,
                      title: selected.title,
                    });
                  }}
                >
                  重命名
                </button>
                <button
                  className="primary"
                  disabled={
                    !connected ||
                    busy ||
                    selected.id === snapshot.selected_topic_id
                  }
                  onClick={() =>
                    void command({
                      action: "select",
                      session_id: snapshot.session_id,
                      topic_id: selected.id,
                    })
                  }
                >
                  <ArrowUpRight size={16} />
                  {selected.id === snapshot.selected_topic_id
                    ? "终端当前话题"
                    : "在此继续"}
                </button>
              </div>
            )}
            {source.resume && selected && (
              <div className="record-actions">
                <button disabled={!connected || busy} onClick={() => void showResume(selected.id)}>
                  <ArrowUpRight size={16} />
                  查看续聊命令
                </button>
              </div>
            )}
          </div>
          {resume && (
            <div className="notice" role="status">
              <code>{resume}</code>
              <button type="button" onClick={() => setResume("")}>关闭</button>
            </div>
          )}
          <div
            className="records-scroll"
            ref={recordsPane}
            key={`${snapshot?.session_id}:${selected?.id}`}
          >
            {selected?.anchor_entry_id && (
              <div className="anchor-note">
                <GitBranch size={16} />
                <span>
                  从父话题中的消息建立 ·{" "}
                  <code>{selected.anchor_entry_id.slice(0, 10)}</code>
                </span>
                <button
                  onClick={() => {
                    if (selected.anchor_entry_id)
                      void locate(selected.anchor_entry_id);
                  }}
                >
                  定位原文
                </button>
              </div>
            )}
            {snapshot?.has_more && snapshot.before !== null && (
              <button
                className="page-button"
                onClick={() =>
                  void load(
                    {
                      topic: snapshot.viewed_topic_id,
                      before: snapshot.before ?? undefined,
                    },
                    false,
                    "older",
                  )
                }
              >
                加载更早的记录
              </button>
            )}
            {(snapshot?.has_newer || highlight) && (
              <button
                className="page-button"
                onClick={() => void jumpToLatest()}
              >
                回到最新记录
              </button>
            )}
            {snapshot?.messages.length ? (
              snapshot.messages.map((message) => (
                <article
                  className={`message role-${message.role} ${highlight === message.id ? "highlighted" : ""}`}
                  id={"entry-" + message.id}
                  key={message.id}
                >
                  <div className="message-meta">
                    <strong>
                      {message.role === "user"
                        ? "你"
                        : message.role === "assistant"
                          ? "助手"
                          : message.role === "toolResult"
                            ? "工具结果"
                            : "会话记录"}
                    </strong>
                    {message.timestamp !== null && (
                      <time>{new Date(message.timestamp * 1000).toLocaleString("zh-CN", { hour12: false })}</time>
                    )}
                    <code>{message.id.slice(0, 8)}</code>
                  </div>
                  <MessageContent
                    role={message.role}
                    text={message.text || "（本条包含工具调用或非文本内容）"}
                  />
                  <div className="message-actions">
                    <button
                      aria-label="复制消息"
                      onClick={() => void copy(message)}
                    >
                      {copied === message.id ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                      复制
                    </button>
                    {source.editTopic && <button
                      disabled={!connected || busy}
                      onClick={() => create(message.id)}
                    >
                      <GitBranch size={14} />
                      从此建立子话题
                    </button>}
                    {source.fork && forkableTurns.has(message.id) && (
                      <button disabled={!connected || busy} onClick={() => {
                        const turn = forkableTurns.get(message.id);
                        if (turn) void fork(turn.topic_id, turn.id);
                      }}>
                        <GitBranch size={14} />
                        从此复制会话
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-records">
                <OctoMark />
                <h3>这个话题还没有记录</h3>
              </div>
            )}
            {snapshot?.has_newer && snapshot.after !== null && (
              <div ref={newerSentinel} className="newer-page">
                <button
                  className="page-button"
                  disabled={loadingPage}
                  onClick={() =>
                    void load(
                      {
                        topic: snapshot.viewed_topic_id,
                        after: snapshot.after ?? undefined,
                      },
                      false,
                      "newer",
                    )
                  }
                >
                  {loadingPage ? "正在加载后续记录…" : "加载后续记录"}
                </button>
              </div>
            )}
          </div>
          <footer className="record-footer">
            <Terminal size={15} />
            <span>{source.kind === "example" ? "离线示例" : "在宿主中继续提问"}</span>
            <span className="shared-note">{source.kind === "sessions" ? "分支独立续聊" : "同一会话共享历史"}</span>
          </footer>
        </section>
      </div>
      <dialog
        ref={dialog}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setEditor({ kind: "closed" });
        }}
        onClose={() => {
          if (!busy) setEditor({ kind: "closed" });
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!snapshot || editor.kind === "closed") return;
            void command({
              action: "rename",
              session_id: editor.session,
              topic_id: editor.topic,
              title,
            });
          }}
        >
          <h2>重命名话题</h2>
          <p>只改变话题名称，保留消息与归属。</p>
          <label>
            话题名称
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="这个想法叫什么？"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditor({ kind: "closed" })}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !connected || !title.trim()}
            >
              {busy ? "正在保存…" : "保存"}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
