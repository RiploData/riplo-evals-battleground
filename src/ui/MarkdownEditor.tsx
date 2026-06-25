'use client';

import { useEffect, useReducer } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Bold, Italic, Heading2, List, ListOrdered } from 'lucide-react';
import { t, mono } from '@/ui/tokens';

interface MarkdownEditorProps {
  /** Initial markdown content. */
  value: string;
  /** Called with the current markdown on every edit. */
  onChange: (markdown: string) => void;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 28,
        borderRadius: 7,
        border: `1px solid ${active ? t.rewrite : t.line}`,
        background: active ? t.rewriteSoft : t.card,
        color: active ? t.rewrite : t.inkSoft,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Friendly markdown editor (TipTap + tiptap-markdown). Reads/writes markdown so
 * it round-trips with how response bodies are stored and rendered.
 */
export default function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, transformPastedText: true })],
    content: value,
    immediatelyRender: false, // avoid Next SSR hydration mismatch
    onUpdate: ({ editor }) => {
      const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
      onChange(storage.markdown.getMarkdown());
    },
  });

  // Re-render the toolbar on selection/content changes so active states update.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => force();
    editor.on('transaction', handler);
    return () => {
      editor.off('transaction', handler);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  const e = editor as Editor;

  return (
    <div
      className="tt-wrap scroll"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.card,
        border: `1px solid ${t.line}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        className="tt-toolbar"
        style={{
          display: 'flex',
          gap: 6,
          padding: '7px 8px',
          borderBottom: `1px solid ${t.lineSoft}`,
          flex: '0 0 auto',
        }}
      >
        <ToolbarButton active={e.isActive('bold')} title="Bold" onClick={() => e.chain().focus().toggleBold().run()}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton active={e.isActive('italic')} title="Italic" onClick={() => e.chain().focus().toggleItalic().run()}>
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={e.isActive('heading', { level: 2 })}
          title="Heading"
          onClick={() => e.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton active={e.isActive('bulletList')} title="Bullet list" onClick={() => e.chain().focus().toggleBulletList().run()}>
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton active={e.isActive('orderedList')} title="Numbered list" onClick={() => e.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={14} />
        </ToolbarButton>
        <span style={{ marginLeft: 'auto', alignSelf: 'center', fontFamily: mono, fontSize: 10, color: t.inkFaint }}>
          markdown
        </span>
      </div>
      <EditorContent editor={editor} className="tt-content scroll" />
    </div>
  );
}
