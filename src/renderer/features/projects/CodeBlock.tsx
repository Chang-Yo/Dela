import hljs from 'highlight.js/lib/common';
import { useMemo } from 'react';

type CodeBlockProps = {
  code: string;
  language: string;
};

export function CodeBlock({ code, language }: CodeBlockProps) {
  const html = useMemo(() => {
    const source = code.trimEnd();
    return hljs.getLanguage(language)
      ? hljs.highlight(source, { language }).value
      : hljs.highlightAuto(source).value;
  }, [code, language]);

  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground/80">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
