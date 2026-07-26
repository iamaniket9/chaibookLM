import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import styles from './MarkdownMessage.module.css';

const CITATION_PATTERN = /\[(\d+)\]/g;

/** Join neighbouring text nodes so a `[1]` split across nodes still matches. */
function mergeAdjacentText(parent) {
  for (let i = parent.children.length - 1; i > 0; i--) {
    const current = parent.children[i];
    const previous = parent.children[i - 1];
    if (current.type === 'text' && previous.type === 'text') {
      previous.value += current.value;
      parent.children.splice(i, 1);
    }
  }
}

/**
 * Remark plugin that lifts `[1]`-style markers out of text so they can render
 * as interactive badges instead of literal brackets.
 *
 * The replacement node declares `hName: 'sup'`, which keeps the output a real
 * HTML element that react-markdown maps through its `components` option — and
 * a superscript is the right semantics for a citation reference anyway.
 */
function remarkCitations() {
  return (tree) => {
    visit(tree, (node) => {
      if (Array.isArray(node.children)) mergeAdjacentText(node);
    });

    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index == null || !node.value.includes('[')) return;

      const pieces = [];
      let cursor = 0;
      for (const match of node.value.matchAll(CITATION_PATTERN)) {
        if (match.index > cursor) {
          pieces.push({ type: 'text', value: node.value.slice(cursor, match.index) });
        }
        pieces.push({
          type: 'citation',
          data: { hName: 'sup', hProperties: { 'data-citation-id': match[1] } },
          children: [{ type: 'text', value: match[1] }],
        });
        cursor = match.index + match[0].length;
      }

      if (!pieces.length) return;
      if (cursor < node.value.length) {
        pieces.push({ type: 'text', value: node.value.slice(cursor) });
      }

      parent.children.splice(index, 1, ...pieces);
      return index + pieces.length; // don't re-visit the nodes we just inserted
    });
  };
}

const REMARK_PLUGINS = [remarkGfm, remarkCitations];

/** Read the citation id back off the rendered element, however it was passed. */
function citationIdOf(props) {
  return props['data-citation-id'] ?? props.node?.properties?.dataCitationId ?? null;
}

/**
 * Render an assistant message as Markdown, turning `[n]` markers into badges
 * that open the matching source.
 *
 * Raw HTML is not enabled (no rehype-raw), so any HTML the model emits is
 * escaped rather than executed.
 */
export default function MarkdownMessage({ content, citations, onCitationClick }) {
  const components = useMemo(() => ({
    sup: ({ children, node, ...props }) => {
      const id = citationIdOf({ ...props, node });
      if (id == null) return <sup {...props}>{children}</sup>;

      const citation = citations?.[id];
      const label = `Open source ${id}`;

      // Without metadata (e.g. the model invented a number beyond the
      // retrieved set) the badge stays visible but inert.
      if (!citation) {
        return <span className={`${styles.citationBadge} ${styles.inert}`} title="Source unavailable">{id}</span>;
      }

      return (
        <button
          type="button"
          className={styles.citationBadge}
          onClick={() => onCitationClick?.(citation)}
          aria-label={label}
          title={label}
        >
          {id}
        </button>
      );
    },
    // Open model-supplied links safely and in a new tab.
    a: ({ children, ...props }) => (
      <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
    ),
  }), [citations, onCitationClick]);

  return (
    <div className={styles.markdownBody}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
