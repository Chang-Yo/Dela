// Markdown 编辑器的语法高亮配色（GitHub Light/Dark，Primer prettylights）：色值定义在
// styles/globals.css 的 --syntax-*，跟随系统明暗主题，无需在此区分。
// 笔记编辑器（content/note）与助手 Composer（content/chat）共用同一份配色。
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--syntax-constant)', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--syntax-string)', textDecoration: 'underline' },
  { tag: [t.url, t.monospace], color: 'var(--syntax-string)' },
  {
    tag: [t.quote, t.processingInstruction, t.contentSeparator],
    color: 'var(--syntax-comment)',
  },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syntax-string)' },
  { tag: t.regexp, color: 'var(--syntax-tag)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.escape], color: 'var(--syntax-constant)' },
  {
    tag: [t.function(t.variableName), t.function(t.definition(t.variableName))],
    color: 'var(--syntax-function)',
  },
  {
    tag: [t.definition(t.variableName), t.typeName, t.className, t.namespace],
    color: 'var(--syntax-variable)',
  },
  {
    tag: [t.propertyName, t.special(t.propertyName), t.attributeName],
    color: 'var(--syntax-constant)',
  },
  { tag: t.tagName, color: 'var(--syntax-tag)' },
  { tag: [t.meta, t.annotation], color: 'var(--syntax-comment)' },
  { tag: t.comment, color: 'var(--syntax-comment)' },
]);
