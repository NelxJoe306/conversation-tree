import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMath } from "../lib/normalize-math";

export function MessageContent({ text, role }: { text: string; role: string }) {
  if (role !== "assistant") return <div className="message-text">{text}</div>;
  return (
    <div className="message-text markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, throwOnError: false, maxExpand: 1000 }],
        ]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          img: ({ src, alt }) => (
            <a
              href={typeof src === "string" ? src : undefined}
              target="_blank"
              rel="noreferrer noopener"
            >
              {alt || "查看图片"}
            </a>
          ),
        }}
      >
        {normalizeMath(text)}
      </Markdown>
    </div>
  );
}
