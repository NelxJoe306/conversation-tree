import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageContent } from "../components/message-content";

function render(text: string, role = "assistant") {
  return renderToStaticMarkup(createElement(MessageContent, { text, role }));
}

test("assistant renders headings, emphasis, tables and fenced code", () => {
  const html = render(
    "### 标题\n\n**加粗**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst value = 1;\n```",
  );
  for (const tag of [
    "<h3>",
    "<strong>",
    "<table>",
    '<code class="language-ts">',
  ])
    assert.ok(html.includes(tag), tag);
});
test("dollar and LaTeX delimiters render accessible inline and display math", () => {
  const html = render(
    String.raw`$x^2$ and \(y^2\)` + "\n\n" + String.raw`\[\frac{1}{2}\]`,
  );
  assert.equal((html.match(/class="katex"/g) ?? []).length, 3);
  assert.ok(html.includes("katex-display"));
  assert.ok(html.includes("<math"));
});
test("math syntax in code and literal user/tool messages stays literal", () => {
  const text = String.raw`\(x\)`;
  assert.ok(render("`" + text + "`").includes(text));
  assert.ok(render("```\n" + text + "\n```").includes(text));
  assert.ok(!render(text, "user").includes('class="katex"'));
  assert.ok(!render("**literal**", "toolResult").includes("<strong>"));
});
test("untrusted HTML, links, and invalid formulas cannot execute or break rendering", () => {
  const html = render(
    "<script>alert(1)</script>\n\n[click](javascript:alert)\n\n$\\notACommand{x}$",
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("notACommand"));
});

test("normalization preserves multiline code spans, unclosed fences and escaped delimiters", async () => {
  const { normalizeMath } = await import("../lib/normalize-math");
  for (const code of [
    "`line one\n" + String.raw`\(x\)` + "`",
    "~~~~\n" + String.raw`\[x\]` + "\n",
    String.raw`\\(literal\\)`,
  ]) {
    assert.equal(normalizeMath(code), code);
  }
  assert.ok(render("$$\n\\frac{1}{2}\n$$").includes("katex-display"));
});
