/** Markdown renderer — react-markdown + remark-gfm + rehype-highlight,
 *  plus a remark plugin that turns `[N]` (where N is 1-99) into clickable
 *  citation markers that link to the Evidence rail.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { visit } from "unist-util-visit";
import "highlight.js/styles/github.css";

interface MarkdownProps {
  text: string;
  onCite?: (n: number) => void;
}

// ── remark plugin: convert [N] in text nodes to inline link nodes ────
// Untyped plugin — `unified` types aren't worth installing for this.
const CITE_RE = /\[(\d{1,2})\]/g;

function remarkCitations() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: any, parent: any) => {
      if (!parent || index == null) return;
      const value = node.value as string;
      if (!CITE_RE.test(value)) return;
      CITE_RE.lastIndex = 0;
      const out: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = CITE_RE.exec(value)) !== null) {
        if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
        out.push({
          type: "link",
          url: `#evidence-${m[1]}`,
          title: `引用 ${m[1]}`,
          data: { hProperties: { className: "cite-marker", "data-cite": m[1] } },
          children: [{ type: "text", value: m[1] }],
        });
        last = m.index + m[0].length;
      }
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

export function Markdown({ text, onCite }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCitations]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        a: ({ node, href, className, children, ...props }) => {
          const isCite = className?.includes("cite-marker");
          if (isCite && onCite) {
            const n = parseInt((node?.properties as any)?.dataCite || "0");
            return (
              <a
                href={href}
                className={className}
                onClick={(e) => { e.preventDefault(); onCite(n); }}
                {...props}
              >{children}</a>
            );
          }
          return (
            <a href={href} className={className} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
