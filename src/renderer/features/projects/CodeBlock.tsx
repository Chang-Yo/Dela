import hljs from 'highlight.js/lib/common';
import { useMemo } from 'react';
import styles from './CodeBlock.module.css';

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
    <pre className={styles.code}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
