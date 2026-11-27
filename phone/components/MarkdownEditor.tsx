import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  type TextInputSelectionChangeEvent,
  KeyboardAvoidingView,
  useWindowDimensions,
  type TextInputInstance,
  type ScrollViewInstance,
} from 'react-native';
import { GestureDetector, useExclusiveGestures, useNativeGesture, type PanGesture, type PinchGesture } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSharedValue } from 'react-native-reanimated';
import { CommandPullIndicator, useCommandPull } from '@/components/CommandPull';
import { pluginEvents, setPluginSelection } from '@/lib/plugin-events';
import { useTheme } from '@/context/ThemeContext';

interface MarkdownEditorProps {
  notePath: string;
  content: string;
  onChange: (text: string) => void;
  fontSize: number;
  wordWrap: boolean;
  pinchGesture: PinchGesture;
  sideSwipe?: PanGesture;
  onPullDown?: () => void;
  lineSpacing?: number;
  spellCheck?: boolean;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
}

interface Selection {
  start: number;
  end: number;
}

interface ToolbarAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  action: (text: string, selection: Selection) => { text: string; selection: Selection };
}

function wrapSelection(
  text: string,
  sel: Selection,
  before: string,
  after: string
): { text: string; selection: Selection } {
  const { start, end } = sel;
  const selected = text.substring(start, end);

  if (start === end) {
    const placeholder = 'text';
    const newText = text.substring(0, start) + before + placeholder + after + text.substring(end);
    return {
      text: newText,
      selection: { start: start + before.length, end: start + before.length + placeholder.length },
    };
  }

  const textBefore = text.substring(Math.max(0, start - before.length), start);
  const textAfter = text.substring(end, end + after.length);
  if (textBefore === before && textAfter === after) {
    const newText = text.substring(0, start - before.length) + selected + text.substring(end + after.length);
    return { text: newText, selection: { start: start - before.length, end: end - before.length } };
  }

  const newText = text.substring(0, start) + before + selected + after + text.substring(end);
  return { text: newText, selection: { start: start + before.length, end: end + before.length } };
}

function insertAtLineStart(
  text: string,
  sel: Selection,
  prefix: string
): { text: string; selection: Selection } {
  const { start } = sel;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = text.indexOf('\n', start);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  const lineContent = text.substring(lineStart, lineEnd);

  if (lineContent.startsWith(prefix)) {
    const newText = text.substring(0, lineStart) + text.substring(lineStart + prefix.length);
    return {
      text: newText,
      selection: { start: Math.max(lineStart, start - prefix.length), end: Math.max(lineStart, start - prefix.length) },
    };
  }

  const newText = text.substring(0, lineStart) + prefix + text.substring(lineStart);
  return { text: newText, selection: { start: start + prefix.length, end: start + prefix.length } };
}

function insertText(
  text: string,
  sel: Selection,
  insert: string,
  cursorOffset?: number
): { text: string; selection: Selection } {
  const { start, end } = sel;
  const newText = text.substring(0, start) + insert + text.substring(end);
  const pos = start + (cursorOffset ?? insert.length);
  return { text: newText, selection: { start: pos, end: pos } };
}

const toolbarActions: ToolbarAction[] = [
  { icon: 'text', label: 'B', action: (t, s) => wrapSelection(t, s, '**', '**') },
  { icon: 'text-outline' as keyof typeof Ionicons.glyphMap, label: 'I', action: (t, s) => wrapSelection(t, s, '_', '_') },
  { icon: 'reorder-three', label: 'H', action: (t, s) => insertAtLineStart(t, s, '## ') },
  {
    icon: 'link',
    label: 'Link',
    action: (t, s) => {
      const selected = t.substring(s.start, s.end);
      if (s.start === s.end) return insertText(t, s, '[title](url)', 1);
      const newText = t.substring(0, s.start) + '[' + selected + '](url)' + t.substring(s.end);
      return { text: newText, selection: { start: s.end + 2, end: s.end + 5 } };
    },
  },
  { icon: 'list', label: 'List', action: (t, s) => insertAtLineStart(t, s, '- ') },
  { icon: 'checkbox-outline', label: 'Task', action: (t, s) => insertAtLineStart(t, s, '- [ ] ') },
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
    action: (t, s) => insertText(t, s, '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |\n', undefined),
  },
  { icon: 'color-wand-outline' as keyof typeof Ionicons.glyphMap, label: '==', action: (t, s) => wrapSelection(t, s, '==', '==') },
  { icon: 'calculator-outline' as keyof typeof Ionicons.glyphMap, label: '$', action: (t, s) => wrapSelection(t, s, '$', '$') },
];

// React Native's multiline input wraps at its layout width. Give it space for
// the longest line in horizontal-scroll mode, including tabs and fallback fonts.
function lineColumns(line: string): number {
  const tabs = line.match(/\t/g)?.length ?? 0;
  const wide = line.match(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]/g)?.length ?? 0;
  return line.length + tabs * 7 + wide;
}

export default function MarkdownEditor({ notePath, content, onChange, fontSize, wordWrap, pinchGesture, sideSwipe, onPullDown, lineSpacing = 1.6, spellCheck = true, focusMode, onToggleFocusMode }: MarkdownEditorProps) {
  const { colors, metrics } = useTheme();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const inputRef = useRef<TextInputInstance>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const horizontalOffset = useRef(0);
  const [editorSize, setEditorSize] = useState<{ width: number; height: number }>();
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const longestLine = useMemo(() => {
    if (wordWrap) return 0;
    return content.split('\n').reduce((width, line) => Math.max(width, lineColumns(line)), 0);
  }, [content, wordWrap]);
  const viewportWidth = editorSize?.width ?? windowWidth;
  const inputWidth = Math.max(viewportWidth, Math.ceil(fontSize * fontScale * 0.67 * longestLine
    + 2 * metrics.contentPadding + 16));
  const scrollY = useSharedValue(0);
  const { gesture, pullDistance } = useCommandPull(onPullDown, scrollY, pinchGesture);
  const nativeScroll = useNativeGesture({ enabled: !wordWrap, simultaneousWith: pinchGesture, requireToFail: sideSwipe });
  const nativeInput = useNativeGesture({ simultaneousWith: [pinchGesture, nativeScroll], requireToFail: sideSwipe });
  const inputGesture = useExclusiveGestures(gesture, nativeInput);

  useEffect(() => {
    scrollY.set(0);
  }, [notePath, scrollY]);

  useEffect(() => {
    horizontalOffset.current = 0;
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [notePath, wordWrap]);

  const handleSelectionChange = useCallback(
    (e: TextInputSelectionChangeEvent) => {
      const range = e.nativeEvent.selection;
      setPluginSelection(notePath, range);
      setSelection(range);
      if (wordWrap || range.start !== range.end || inputWidth <= viewportWidth) return;

      const lineStart = range.end === 0 ? 0 : content.lastIndexOf('\n', range.end - 1) + 1;
      const columns = lineColumns(content.slice(lineStart, range.end));
      const caretX = metrics.contentPadding + columns * fontSize * fontScale * 0.6;
      const offset = horizontalOffset.current;
      const inset = metrics.contentPadding;
      if (caretX < offset + inset || caretX > offset + viewportWidth - inset) {
        const x = Math.min(inputWidth - viewportWidth, Math.max(0, caretX < offset + inset
          ? caretX - inset : caretX - viewportWidth + inset));
        scrollRef.current?.scrollTo({ x, animated: false });
      }
    },
    [content, fontScale, fontSize, inputWidth, metrics.contentPadding, notePath, viewportWidth, wordWrap]
  );

  useEffect(() => {
    const listener = pluginEvents.addListener('selection', ({ path, range }) => {
      if (path !== notePath) return;
      setSelection(range);
      requestAnimationFrame(() => inputRef.current?.setNativeProps({ selection: range }));
    });
    return () => listener.remove();
  }, [notePath]);

  const handleToolbarPress = useCallback(
    (action: ToolbarAction['action']) => {
      const result = action(content, selection);
      onChange(result.text);
      setTimeout(() => {
        inputRef.current?.setNativeProps({ selection: result.selection });
        setPluginSelection(notePath, result.selection);
        setSelection(result.selection);
      }, 10);
    },
    [content, notePath, selection, onChange]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <GestureDetector gesture={nativeScroll}>
        <ScrollView
          ref={scrollRef}
          horizontal
          style={styles.container}
          contentContainerStyle={styles.editorScrollContent}
          onLayout={({ nativeEvent: { layout } }) => setEditorSize((size) =>
            size?.width === layout.width && size.height === layout.height ? size : layout
          )}
          onScroll={(event) => { horizontalOffset.current = event.nativeEvent.contentOffset.x; }}
          scrollEventThrottle={16}
          scrollEnabled={!wordWrap && inputWidth > viewportWidth}
          showsHorizontalScrollIndicator={!wordWrap}
          pinchGestureEnabled={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="always"
        >
          <GestureDetector gesture={inputGesture}>
            <TextInput
              ref={inputRef}
              style={[
                styles.textInput,
                { width: inputWidth, height: editorSize?.height },
                {
                  fontSize,
                  lineHeight: fontSize * lineSpacing,
                  paddingHorizontal: metrics.contentPadding,
                  color: colors.textPrimary,
                  backgroundColor: colors.bgPrimary,
                },
              ]}
              value={content}
              onChangeText={onChange}
              onSelectionChange={handleSelectionChange}
              onScroll={onPullDown ? event => { scrollY.set(event.nativeEvent.contentOffset.y); } : undefined}
              multiline
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect={spellCheck}
              spellCheck={spellCheck}
              scrollEnabled
              selectionColor={colors.accent + '80'}
              placeholderTextColor={colors.textMuted}
              placeholder="Start writing..."
            />
          </GestureDetector>
        </ScrollView>
      </GestureDetector>
      {onPullDown && <CommandPullIndicator pullDistance={pullDistance} />}

      {!focusMode && (
        <View style={[styles.toolbar, { backgroundColor: colors.bgSecondary, borderTopColor: colors.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarContent}
            keyboardShouldPersistTaps="always"
          >
            {toolbarActions.map((action) => (
              <TouchableOpacity
                key={action.label}
                style={[styles.toolbarButton, { borderRadius: metrics.controlRadius }]}
                accessibilityRole="button" accessibilityLabel={action.label}
                onPress={() => handleToolbarPress(action.action)}
                activeOpacity={0.6}
              >
                <Ionicons name={action.icon} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
            {onToggleFocusMode && (
              <TouchableOpacity
                style={[styles.toolbarButton, { borderRadius: metrics.controlRadius }]}
                accessibilityRole="button" accessibilityLabel="Enter focus mode"
                onPress={onToggleFocusMode}
                activeOpacity={0.6}
              >
                <Ionicons name="contract-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}
      {focusMode && onToggleFocusMode && (
        <TouchableOpacity
          style={[styles.focusExitBtn, { backgroundColor: colors.bgSecondary + 'cc', borderColor: colors.border }]}
          onPress={onToggleFocusMode}
        >
          <Ionicons name="expand-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  editorScrollContent: {
    flexGrow: 1,
  },
  textInput: {
    flexShrink: 0,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    textAlignVertical: 'top',
  },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarContent: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  toolbarButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  focusExitBtn: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
