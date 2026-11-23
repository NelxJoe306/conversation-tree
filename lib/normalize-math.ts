export function normalizeMath(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (index === 0 || source[index - 1] === "\n") {
      const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(
        source.slice(index),
      );
      if (fence) {
        const closing = new RegExp(
          `^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*(?:\\n|$)`,
          "gm",
        );
        closing.lastIndex = index + fence[0].length;
        const match = closing.exec(source);
        const end = match ? match.index + match[0].length : source.length;
        output += source.slice(index, end);
        index = end;
        continue;
      }
      if (/^( {4}|\t)/.test(source.slice(index))) {
        const newline = source.indexOf("\n", index);
        const end = newline < 0 ? source.length : newline + 1;
        output += source.slice(index, end);
        index = end;
        continue;
      }
    }
    if (source[index] === "`") {
      const run = /^`+/.exec(source.slice(index));
      if (run) {
        let end = source.indexOf(run[0], index + run[0].length);
        while (
          end >= 0 &&
          (source[end - 1] === "`" || source[end + run[0].length] === "`")
        ) {
          end = source.indexOf(run[0], end + run[0].length);
        }
        if (end >= 0) {
          output += source.slice(index, end + run[0].length);
          index = end + run[0].length;
          continue;
        }
      }
    }
    if (source.startsWith("\\\\", index)) {
      output += "\\\\";
      index += 2;
      continue;
    }
    const display = source.startsWith("\\[", index);
    if (display || source.startsWith("\\(", index)) {
      const end = source.indexOf(display ? "\\]" : "\\)", index + 2);
      if (end >= 0) {
        const math = source.slice(index + 2, end);
        output += display ? `\n$$\n${math}\n$$\n` : `$${math}$`;
        index = end + 2;
        continue;
      }
    }
    output += source[index];
    index++;
  }
  return output;
}
