// 全局唯一的代码高亮方案（GitHub Light / Dark）：按 GitHub 主题的作用域规则把 lezer 标签映射到
// --syntax-* 角色，色值在 ui/tokens.css 随明暗翻转。聊天区 shiki 直接用同名的 GitHub 主题。
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const fade = (role: string, percent: number) =>
  `color-mix(in srgb, var(--syntax-${role}) ${percent}%, transparent)`;

/** 代码 token：源码文件、代码块与 Markdown 标记符号。 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syntax-comment)' },
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
  { tag: t.tagName, color: 'var(--syntax-tag)' },
  { tag: [t.standard(t.typeName), t.self], color: 'var(--syntax-constant)' },
  { tag: t.angleBracket, color: fade('tag', 50) },
  { tag: t.propertyName, color: 'var(--syntax-markup)' },
  { tag: [t.meta, t.annotation], color: 'var(--syntax-special)' },
  { tag: t.inserted, color: 'var(--syntax-added)' },
  { tag: t.changed, color: 'var(--syntax-modified)' },
  { tag: t.deleted, color: 'var(--syntax-removed)' },
  { tag: t.invalid, color: 'var(--syntax-error)' },
]);

/** Markdown 正文元素：只用于看原文的编辑器（聊天输入框、未开即时渲染的 Markdown）。 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--syntax-constant)', fontWeight: 'bold' },
  { tag: t.strong, color: 'var(--syntax-fg)', fontWeight: 'bold' },
  { tag: t.emphasis, color: 'var(--syntax-fg)', fontStyle: 'italic' },
  { tag: t.strikethrough, color: 'var(--syntax-fg)', textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--syntax-string)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--syntax-string)' },
  { tag: t.quote, color: 'var(--syntax-tag)' },
  { tag: t.monospace, color: 'var(--syntax-constant)' },
  { tag: t.contentSeparator, color: 'var(--syntax-constant)', fontWeight: 'bold' },
]);
