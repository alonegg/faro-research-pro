/** Markdown renderer — react-markdown + remark-gfm + rehype-highlight.
 *
 *  Why these libs: GFM gives us tables / strikethrough / task lists / autolinks
 *  (which the agent uses heavily for financial reports). rehype-highlight uses
 *  highlight.js for fenced code blocks — much richer than the v0.1 home-grown
 *  parser, which couldn't even render ```python blocks.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        // External links open in new tab (citations, doc refs)
        a: ({ node: _n, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
