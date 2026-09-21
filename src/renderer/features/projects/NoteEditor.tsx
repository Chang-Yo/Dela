import { useEffect, useRef } from 'react';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { Crepe } from '@milkdown/crepe';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { editorViewCtx } from '@milkdown/kit/core';
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $prose, replaceAll } from '@milkdown/kit/utils';
import { isRelativeAssetPath, noteAssetUrl } from '../../../shared/note-files';
import './note-editor.css';

// Crepe 公共结构样式（无配色）；配色由 note-editor.css 的变量映射到 Dela 设计 token。
import '@milkdown/crepe/theme/common/style.css';

type NoteEditorHandlers = {
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
};

type CrepeSession = {
  crepe: Crepe;
  root: HTMLDivElement;
  scrollTop: number;
  applying: boolean;
  composing: boolean;
  lastPublishedValue: string | null;
  syncTimer: ReturnType<typeof setTimeout> | null;
  ready: boolean;
  disposed: boolean;
};

/* 编辑器实例按 editorStateKey 缓存：切换标签时把 DOM 移入暂存节点保持撤销历史与光标，
   彻底关闭时由 forgetNoteEditorState 销毁。每个编辑器组使用不同 key。 */
const sessions = new Map<string, CrepeSession>();
const handlersByKey = new Map<string, NoteEditorHandlers>();
let staging: HTMLDivElement | null = null;

function stagingRoot(): HTMLDivElement {
  if (!staging) {
    staging = document.createElement('div');
    staging.hidden = true;
    document.body.append(staging);
  }
  return staging;
}

export function forgetNoteEditorState(editorStateKey: string) {
  const session = sessions.get(editorStateKey);
  if (!session) return;
  sessions.delete(editorStateKey);
  handlersByKey.delete(editorStateKey);
  if (session.syncTimer) clearTimeout(session.syncTimer);
  session.disposed = true;
  if (session.ready) {
    void session.crepe.destroy().catch(() => undefined);
    session.root.remove();
  }
  // create() 尚未完成时由创建流程负责销毁。
}

/** URL 含已编码字符时先解码再交给资源协议，避免双重编码。 */
function assetRefForProtocol(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/* Milkdown 未内置链接输入规则（只覆盖加粗/斜体/行内代码/引用/列表等）：
   补一条 `[文本](地址)` 规则，键入 `)` 时把原文替换为带 link 标记的文本。 */
const linkInputRule = new InputRule(
  /\[([^\]\n]+)\]\(([^()\s]+)(?:\s+"([^"]*)")?\)$/,
  (state, match, start, end) => {
    const text = match[1];
    const href = match[2];
    const linkType = state.schema.marks.link;
    if (!text || !href || !linkType) return null;
    return state.tr.replaceWith(
      start,
      end,
      state.schema.text(text, [linkType.create({ href, title: match[3] ?? null })]),
    );
  },
);

/** 把链接输入规则挂到编辑器；导出供单元测试复用同一份行为。 */
export function attachLinkInputRule(editor: Crepe['editor']) {
  editor.use($prose(() => inputRules({ rules: [linkInputRule] })));
}

/* image-block 默认把 alt 当作宽高比数字、把 caption 写入 title，标准 Markdown 的
   alt 文本会被静默丢弃。这里在 schema 层改为 alt↔caption 往返，title 单独保留。 */
export function fixImageBlockSchema(editor: Crepe['editor']) {
  editor.config((ctx) => {
    ctx.update(imageBlockSchema.ctx.key, (prev) => (inner) => {
      const schema = prev(inner);
      return {
        ...schema,
        attrs: {
          ...schema.attrs,
          title: { default: '', validate: 'string' },
        },
        parseDOM: [
          {
            tag: 'img[data-type="image-block"]',
            getAttrs: (dom) => {
              if (!(dom instanceof HTMLElement)) return {};
              return {
                src: dom.getAttribute('src') || '',
                caption: dom.getAttribute('caption') || '',
                title: dom.getAttribute('title') || '',
                ratio: Number(dom.getAttribute('ratio') ?? 1),
              };
            },
          },
        ],
        toDOM: (node: { attrs: Record<string, unknown> }) => [
          'img',
          { 'data-type': 'image-block', ...node.attrs },
        ],
        parseMarkdown: {
          ...schema.parseMarkdown,
          runner: (state, node, type) => {
            const ratio = Number(node.alt);
            state.addNode(type, {
              src: node.url,
              caption: Number.isNaN(ratio) ? node.alt || node.title || '' : '',
              title: node.title || '',
              ratio: Number.isNaN(ratio) || ratio === 0 ? 1 : ratio,
            });
          },
        },
        toMarkdown: {
          ...schema.toMarkdown,
          runner: (state, node) => {
            state.openNode('paragraph');
            state.addNode('image', undefined, undefined, {
              url: node.attrs.src,
              alt: node.attrs.caption,
              title: node.attrs.title || undefined,
            });
            state.closeNode();
          },
        },
      };
    });
  });
}

/* 代码块复制按钮的点击反馈：Crepe 组件本身无已复制状态，这里在会话根上委托监听，
   把按钮图标临时换成对勾后还原；复制动作仍由组件自己的 onClick 完成，不做拦截。 */
const copyCheckIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="none"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const COPY_FEEDBACK_MS = 1500;

/* 代码块内置 CodeMirror 的语法配色：引用全局 --syntax-* token（GitHub Light/Dark，
   随应用明暗切换），覆盖 basicSetup 自带的浅色 fallback 高亮。 */
const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [t.comment, t.meta, t.annotation, t.processingInstruction],
    color: 'var(--syntax-comment)',
  },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character],
    color: 'var(--syntax-string)',
  },
  {
    tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color, t.constant(t.name)],
    color: 'var(--syntax-constant)',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    color: 'var(--syntax-function)',
  },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--syntax-tag)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syntax-constant)' },
  { tag: [t.variableName, t.labelName, t.operator, t.name], color: '#e6edf3' },
]);

function createSession(
  key: string,
  documentKey: string,
  value: string,
  readOnly: boolean,
): CrepeSession {
  const root = document.createElement('div');
  root.className = 'note-editor-crepe';
  const crepe = new Crepe({
    root,
    defaultValue: value,
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: '开始记录…', mode: 'doc' },
      [Crepe.Feature.Toolbar]: {
        boldLabel: '加粗',
        italicLabel: '斜体',
        strikethroughLabel: '删除线',
        codeLabel: '行内代码',
        linkLabel: '链接',
        latexLabel: '公式',
      },
      [Crepe.Feature.LinkTooltip]: {
        inputPlaceholder: '链接地址',
        editButton: '编辑',
        removeButton: '移除',
        confirmButton: '确定',
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: '文本',
          text: { label: '正文' },
          h1: { label: '一级标题' },
          h2: { label: '二级标题' },
          h3: { label: '三级标题' },
          h4: { label: '四级标题' },
          h5: { label: '五级标题' },
          h6: { label: '六级标题' },
          quote: { label: '引用' },
          divider: { label: '分隔线' },
        },
        listGroup: {
          label: '列表',
          bulletList: { label: '无序列表' },
          orderedList: { label: '有序列表' },
          taskList: { label: '待办列表' },
        },
        advancedGroup: {
          label: '高级',
          image: { label: '图片' },
          codeBlock: { label: '代码块' },
          table: { label: '表格' },
          math: { label: '公式' },
        },
      },
      [Crepe.Feature.ImageBlock]: {
        blockUploadButton: '插入图片',
        blockUploadPlaceholderText: '或粘贴图片链接',
        blockCaptionPlaceholderText: '图片说明',
        inlineUploadButton: '插入图片',
        inlineUploadPlaceholderText: '或粘贴图片链接',
        onUpload: async (file) => {
          if (!window.dela) throw new Error('仅桌面应用支持插入本地图片');
          const bytes = new Uint8Array(await file.arrayBuffer());
          return window.dela.workspace.saveNoteImage(documentKey, file.name, bytes);
        },
        proxyDomURL: (url) =>
          isRelativeAssetPath(url) ? noteAssetUrl(documentKey, assetRefForProtocol(url)) : url,
      },
      [Crepe.Feature.CodeMirror]: {
        extensions: [syntaxHighlighting(codeHighlightStyle)],
        searchPlaceholder: '搜索语言',
        noResultText: '无匹配语言',
        copyText: '复制',
        previewLabel: '预览',
        previewLoading: '正在加载预览…',
      },
      [Crepe.Feature.Latex]: { inlineEditConfirm: '确定' },
    },
  });
  fixImageBlockSchema(crepe.editor);
  attachLinkInputRule(crepe.editor);
  const session: CrepeSession = {
    crepe,
    root,
    scrollTop: 0,
    applying: false,
    composing: false,
    lastPublishedValue: null,
    syncTimer: null,
    ready: false,
    disposed: false,
  };
  const update = (markdown: string) => {
    if (session.applying || session.disposed) return;
    session.lastPublishedValue = markdown;
    handlersByKey.get(key)?.onChange(markdown);
  };
  crepe.on((api) => {
    // Milkdown 的通知有 200ms 去抖，回调时以当前文档为准。
    api.markdownUpdated(() => update(crepe.getMarkdown()));
  });
  void crepe
    .create()
    .then(() => {
      if (session.disposed) {
        void crepe.destroy().catch(() => undefined);
        return;
      }
      session.ready = true;
      crepe.setReadonly(readOnly);
      const editor = root.querySelector('.milkdown');
      editor?.addEventListener('compositionstart', () => {
        session.composing = true;
        if (session.syncTimer) clearTimeout(session.syncTimer);
        session.syncTimer = null;
      });
      editor?.addEventListener('compositionend', () => {
        session.composing = false;
        // 先发布选词结果，不能把组词期间回传的拼音重新写回编辑器。
        window.setTimeout(() => {
          if (session.disposed || session.composing) return;
          update(crepe.getMarkdown());
        }, 0);
      });
      editor?.addEventListener('click', (event) => {
        const button =
          event.target instanceof Element ? event.target.closest('.copy-button') : null;
        if (!(button instanceof HTMLElement) || button.dataset.copied === 'true') return;
        const icon = button.querySelector('.milkdown-icon');
        if (!icon) return;
        const original = icon.innerHTML;
        icon.innerHTML = copyCheckIcon;
        button.dataset.copied = 'true';
        window.setTimeout(() => {
          if (icon.isConnected) icon.innerHTML = original;
          delete button.dataset.copied;
        }, COPY_FEEDBACK_MS);
      });
    })
    .catch(() => {
      sessions.delete(key);
      session.root.remove();
    });
  return session;
}

/** 整篇替换外部内容：保留滚动位置，光标按偏移收敛到新文档；不计入编辑回调。 */
function applyExternalValue(key: string, value: string) {
  const session = sessions.get(key);
  if (!session || !session.ready) return;
  if (value === session.lastPublishedValue) return;
  if (session.composing || session.crepe.editor.action((ctx) => ctx.get(editorViewCtx).composing)) {
    return;
  }
  if (session.crepe.getMarkdown() === value) return;
  session.lastPublishedValue = null;
  const host = session.root.parentElement;
  const scrollTop = host instanceof HTMLElement ? host.scrollTop : session.scrollTop;
  session.applying = true;
  try {
    const { head, anchor } = session.crepe.editor.action(
      (ctx) => ctx.get(editorViewCtx).state,
    ).selection;
    session.crepe.editor.action(replaceAll(value));
    session.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const size = view.state.doc.content.size;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, Math.min(head, size), Math.min(anchor, size)),
        ),
      );
    });
  } finally {
    session.applying = false;
  }
  if (host instanceof HTMLElement) host.scrollTop = scrollTop;
  session.scrollTop = scrollTop;
}

export function NoteEditor({
  value,
  documentKey,
  editorStateKey,
  readOnly = false,
  autoFocus = false,
  onChange,
  onSave,
  onScroll,
}: {
  value: string;
  /** 条目 ID：图片上传与相对资源解析都以它为准。 */
  documentKey: string;
  /** 会话缓存键；同键切换标签保留撤销历史与光标。 */
  editorStateKey?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll?: (top: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const fallbackKey = useRef(`note-editor-${documentKey}`).current;
  const key = editorStateKey ?? fallbackKey;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let session = sessions.get(key);
    if (!session) {
      session = createSession(key, documentKey, value, readOnly);
      sessions.set(key, session);
    }
    handlersByKey.set(key, { onChange, onSave, onScroll: (top) => onScroll?.(top) });
    node.append(session.root);
    node.scrollTop = session.scrollTop;
    if (session.ready) {
      applyExternalValue(key, value);
      if (autoFocus)
        session.crepe.editor.action((ctx) => {
          ctx.get(editorViewCtx).focus();
        });
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handlersByKey.get(key)?.onSave();
      }
    };
    const handleScroll = () => {
      session!.scrollTop = node.scrollTop;
      handlersByKey.get(key)?.onScroll(node.scrollTop);
    };
    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('scroll', handleScroll);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('scroll', handleScroll);
      if (sessions.get(key) === session && session.ready) {
        session.scrollTop = node.scrollTop;
        // 挂到隐藏暂存节点保持实例与撤销历史存活；彻底关闭时由 forgetNoteEditorState 销毁。
        stagingRoot().append(session.root);
      }
    };
    // value/readOnly/autoFocus/handlers 的后续变化由下方 effect 单向同步；此处只装配一次。
  }, []);

  useEffect(() => {
    const bound = handlersByKey.get(key);
    if (bound) handlersByKey.set(key, { ...bound, onChange, onSave });
  }, [onChange, onSave, key]);

  useEffect(() => {
    const session = sessions.get(key);
    if (session?.ready) session.crepe.setReadonly(readOnly);
  }, [readOnly, key]);

  useEffect(() => {
    const session = sessions.get(key);
    if (!session) return;
    // onChange 的回传只是确认本地输入，不能当作整篇替换指令。
    if (value === session.lastPublishedValue) return;
    if (session.composing) {
      return;
    }
    if (!session.ready) return;
    if (session.crepe.getMarkdown() === value) return;
    // 分栏对侧的连续编辑经尾随去抖收敛，避免每个键入都整篇重建对侧文档。
    if (session.syncTimer) clearTimeout(session.syncTimer);
    session.syncTimer = setTimeout(() => {
      session.syncTimer = null;
      if (sessions.get(key) !== session) return;
      if (session.composing) {
        return;
      }
      applyExternalValue(key, valueRef.current);
    }, 200);
    return () => {
      if (session.syncTimer) {
        clearTimeout(session.syncTimer);
        session.syncTimer = null;
      }
    };
  }, [value, key]);
  return (
    <div
      ref={host}
      className="note-editor-host"
      role="region"
      aria-label="笔记编辑器"
      data-readonly={readOnly ? 'true' : 'false'}
    />
  );
}
