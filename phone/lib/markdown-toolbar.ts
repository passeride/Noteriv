import { Ionicons } from '@expo/vector-icons';

export interface SelectionRange {
  start: number;
  end: number;
}

export interface ToolbarAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  action: (
    text: string,
    selection: SelectionRange
  ) => { text: string; selection: SelectionRange };
}

function wrapSelection(
  text: string,
  sel: SelectionRange,
  before: string,
  after: string
): { text: string; selection: SelectionRange } {
  const { start, end } = sel;
  const selected = text.substring(start, end);

  if (start === end) {
    const placeholder = 'text';
    const newText =
      text.substring(0, start) + before + placeholder + after + text.substring(end);
    return {
      text: newText,
      selection: {
        start: start + before.length,
        end: start + before.length + placeholder.length,
      },
    };
  }

  const textBefore = text.substring(Math.max(0, start - before.length), start);
  const textAfter = text.substring(end, end + after.length);
  if (textBefore === before && textAfter === after) {
    const newText =
      text.substring(0, start - before.length) +
      selected +
      text.substring(end + after.length);
    return {
      text: newText,
      selection: { start: start - before.length, end: end - before.length },
    };
  }

  const newText =
    text.substring(0, start) + before + selected + after + text.substring(end);
  return {
    text: newText,
    selection: { start: start + before.length, end: end + before.length },
  };
}

function insertAtLineStart(
  text: string,
  sel: SelectionRange,
  prefix: string
): { text: string; selection: SelectionRange } {
  const { start } = sel;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = text.indexOf('\n', start);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  const lineContent = text.substring(lineStart, lineEnd);

  if (lineContent.startsWith(prefix)) {
    const newText =
      text.substring(0, lineStart) + text.substring(lineStart + prefix.length);
    return {
      text: newText,
      selection: {
        start: Math.max(lineStart, start - prefix.length),
        end: Math.max(lineStart, start - prefix.length),
      },
    };
  }

  const newText = text.substring(0, lineStart) + prefix + text.substring(lineStart);
  return {
    text: newText,
    selection: { start: start + prefix.length, end: start + prefix.length },
  };
}

function insertText(
  text: string,
  sel: SelectionRange,
  insert: string,
  cursorOffset?: number
): { text: string; selection: SelectionRange } {
  const { start, end } = sel;
  const newText = text.substring(0, start) + insert + text.substring(end);
  const pos = start + (cursorOffset ?? insert.length);
  return { text: newText, selection: { start: pos, end: pos } };
}

export const toolbarActions: ToolbarAction[] = [
  { icon: 'text', label: 'B', action: (t, s) => wrapSelection(t, s, '**', '**') },
  {
    icon: 'text-outline' as keyof typeof Ionicons.glyphMap,
    label: 'I',
    action: (t, s) => wrapSelection(t, s, '_', '_'),
  },
  { icon: 'reorder-three', label: 'H', action: (t, s) => insertAtLineStart(t, s, '## ') },
  {
    icon: 'link',
    label: 'Link',
    action: (t, s) => {
      const selected = t.substring(s.start, s.end);
      if (s.start === s.end) return insertText(t, s, '[title](url)', 1);
      const newText =
        t.substring(0, s.start) + '[' + selected + '](url)' + t.substring(s.end);
      return { text: newText, selection: { start: s.end + 2, end: s.end + 5 } };
    },
  },
  { icon: 'list', label: 'List', action: (t, s) => insertAtLineStart(t, s, '- ') },
  {
    icon: 'checkbox-outline',
    label: 'Task',
    action: (t, s) => insertAtLineStart(t, s, '- [ ] '),
  },
  {
    icon: 'code-slash',
    label: 'Code',
    action: (t, s) => {
      const selected = t.substring(s.start, s.end);
      if (selected.includes('\n')) {
        return wrapSelection(t, s, '\n```\n', '\n```\n');
      }
      return wrapSelection(t, s, '`', '`');
    },
  },
  { icon: 'chatbox', label: 'Quote', action: (t, s) => insertAtLineStart(t, s, '> ') },
  { icon: 'remove-outline', label: 'HR', action: (t, s) => insertText(t, s, '\n---\n') },
  {
    icon: 'grid-outline',
    label: 'Table',
    action: (t, s) =>
      insertText(
        t,
        s,
        '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |\n',
        undefined
      ),
  },
  {
    icon: 'color-wand-outline' as keyof typeof Ionicons.glyphMap,
    label: '==',
    action: (t, s) => wrapSelection(t, s, '==', '=='),
  },
  {
    icon: 'calculator-outline' as keyof typeof Ionicons.glyphMap,
    label: '$',
    action: (t, s) => wrapSelection(t, s, '$', '$'),
  },
];
