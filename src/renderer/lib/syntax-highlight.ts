// 全局唯一的代码高亮方案（Ayu）：按 vscode-ayu 的作用域规则把 lezer 标签映射到 --syntax-* 角色，
// 色值在 styles/globals.css 随明暗主题翻转。聊天区 shiki 与预览 highlight.js 用同一组变量。
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const fade = (role: string, percent: number) =>
  `color-mix(in srgb, var(--syntax-${role}) ${percent}%, transparent)`;

/** 代码 token：源码文件、代码块与 Markdown 标记符号（Ayu 把 Markdown 标点归为注释色）。 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--syntax-comment)' },
  { tag: t.keyword, color: 'var(--syntax-keyword)' },
  { tag: [t.operator, t.operatorKeyword], color: 'var(--syntax-operator)' },
  { tag: t.separator, color: fade('fg', 70) },
  { tag: t.string, color: 'var(--syntax-string)' },
  { tag: [t.regexp, t.escape, t.character], color: 'var(--syntax-regexp)' },
  {
    tag: [t.number, t.bool, t.null, t.atom, t.unit, t.constant(t.variableName)],
    color: 'var(--syntax-constant)',
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.function(t.propertyName),
      t.macroName,
      t.attributeName,
    ],
    color: 'var(--syntax-function)',
  },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-entity)' },
  { tag: [t.tagName, t.standard(t.typeName)], color: 'var(--syntax-tag)' },
  { tag: t.angleBracket, color: fade('tag', 50) },
  { tag: t.self, color: 'var(--syntax-tag)', fontStyle: 'italic' },
  { tag: t.propertyName, color: 'var(--syntax-markup)' },
  { tag: [t.meta, t.annotation], color: 'var(--syntax-special)' },
  { tag: t.inserted, color: 'var(--syntax-added)' },
  { tag: t.changed, color: 'var(--syntax-modified)' },
  { tag: t.deleted, color: 'var(--syntax-removed)' },
  { tag: t.invalid, color: 'var(--syntax-error)' },
]);

/** Markdown 正文元素：只用于看原文的编辑器（聊天输入框、未开即时渲染的 Markdown）。 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--syntax-string)', fontWeight: 'bold' },
  { tag: t.strong, color: 'var(--syntax-markup)', fontWeight: 'bold' },
  { tag: t.emphasis, color: 'var(--syntax-markup)', fontStyle: 'italic' },
  { tag: t.strikethrough, color: 'var(--syntax-special)', textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--syntax-tag)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--syntax-tag)' },
  { tag: t.quote, color: 'var(--syntax-regexp)', fontStyle: 'italic' },
  { tag: t.monospace, color: 'var(--syntax-operator)' },
  { tag: t.contentSeparator, color: 'var(--syntax-comment)', fontWeight: 'bold' },
]);
