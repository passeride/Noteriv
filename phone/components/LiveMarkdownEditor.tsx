import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  type TextInputContentSizeChangeEvent,
  type NativeSyntheticEvent,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, useExclusiveGestures, useNativeGesture, type PanGesture, type PinchGesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { CommandPullIndicator, useCommandPull } from '@/components/CommandPull';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import InlineMarkdown from '@/components/InlineMarkdown';
import GitHistoryBlock from '@/components/GitHistoryBlock';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import {
  findLineFromOffset,
  getLineInfo,
  LiveMarkdownSegment,
  replaceLineRange,
  segmentLiveMarkdown,
} from '@/lib/markdown';
import {
  SelectionRange,
  ToolbarAction,
  toolbarActions,
} from '@/lib/markdown-toolbar';

interface LiveMarkdownEditorProps {
  content: string;
  vaultPath?: string;
  notePath?: string;
  anchor?: { heading?: string; line?: number };
  onChange: (text: string) => void;
  fontSize: number;
  pinchGesture?: PinchGesture;
  sideSwipe?: PanGesture;
  onPullDown?: () => void;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  onLinkPress?: (url: string) => void;
  onWikiLinkPress?: (name: string) => void;
  onToggleTask?: (line: number) => void;
}

type AbsoluteSelection = SelectionRange;
type SegmentLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};
const DEBUG_LIVE_EDITOR = false;

function debugLog(message: string, details?: Record<string, unknown>) {
  if (!DEBUG_LIVE_EDITOR) return;
  if (details) {
    console.log(`[LiveEditor] ${message}`, details);
    return;
  }
  console.log(`[LiveEditor] ${message}`);
}

function clampSelection(selection: SelectionRange, length: number): SelectionRange {
  return {
    start: Math.max(0, Math.min(selection.start, length)),
    end: Math.max(0, Math.min(selection.end, length)),
  };
}

function selectionsEqual(a: SelectionRange | null, b: SelectionRange | null): boolean {
  if (!a || !b) return a === b;
  return a.start === b.start && a.end === b.end;
}

function segmentLayoutsEqual(a: SegmentLayout | null, b: SegmentLayout | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function getSegmentAtOffset(
  content: string,
  segments: LiveMarkdownSegment[],
  offset: number
): LiveMarkdownSegment | null {
  const line = findLineFromOffset(content, offset);
  return (
    segments.find((segment) => line >= segment.startLine && line <= segment.endLine) ??
    null
  );
}

function headingInfo(rawText: string): { level: number; text: string } {
  const match = rawText.match(/^(#{1,6})\s+(.*)$/);
  return {
    level: match ? match[1].length : 1,
    text: match ? match[2] : rawText,
  };
}

function listInfo(rawText: string): { bullet: string; text: string } {
  const unordered = rawText.match(/^(\s*[-*+])\s+(.*)$/);
  if (unordered) return { bullet: '\u2022', text: unordered[2] };
  const ordered = rawText.match(/^\s*(\d+[.)])\s+(.*)$/);
  if (ordered) return { bullet: ordered[1], text: ordered[2] };
  return { bullet: '\u2022', text: rawText };
}

function taskInfo(rawText: string): { checked: boolean; text: string } {
  const match = rawText.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
  return {
    checked: match ? match[1] !== ' ' : false,
    text: match ? match[2] : rawText,
  };
}

function rawBlockTitle(kind?: LiveMarkdownSegment['rawBlockKind']): string {
  switch (kind) {
    case 'frontmatter':
      return 'frontmatter';
    case 'code_block':
      return 'code block';
    case 'math_block':
      return 'math block';
    case 'table':
      return 'table';
    case 'callout':
      return 'callout';
    case 'embed':
      return 'embed';
    case 'footnote_def':
      return 'footnote';
    default:
      return 'raw block';
  }
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function diffTextChange(oldText: string, newText: string): {
  prefixLength: number;
  removedText: string;
  insertedText: string;
} {
  let prefixLength = 0;
  while (
    prefixLength < oldText.length &&
    prefixLength < newText.length &&
    oldText[prefixLength] === newText[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldText.length - prefixLength &&
    suffixLength < newText.length - prefixLength &&
    oldText[oldText.length - 1 - suffixLength] ===
      newText[newText.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  return {
    prefixLength,
    removedText: oldText.slice(prefixLength, oldText.length - suffixLength),
    insertedText: newText.slice(prefixLength, newText.length - suffixLength),
  };
}

function inferSelectionAfterTextChange(
  oldText: string,
  newText: string
): SelectionRange {
  const { prefixLength, insertedText } = diffTextChange(oldText, newText);
  const cursor = prefixLength + insertedText.length;
  return { start: cursor, end: cursor };
}

function buildEnterBehavior(
  segment: LiveMarkdownSegment,
  text: string,
  selection: SelectionRange
): { text: string; selection: SelectionRange } | null {
  const inserted = text.slice(0, selection.start) + '\n' + text.slice(selection.end);
  const prefixCursor = selection.start + 1;

  if (segment.kind === 'raw_block') {
    return {
      text: inserted,
      selection: { start: prefixCursor, end: prefixCursor },
    };
  }

  const before = text.slice(0, selection.start);
  const after = text.slice(selection.end);

  switch (segment.simpleKind) {
    case 'heading': {
      const match = text.match(/^(\s*#{1,6}\s+)(.*)$/);
      if (!match) break;
      if (match[2].trim().length === 0) {
        return { text: '', selection: { start: 0, end: 0 } };
      }
      if (selection.start < match[1].length) {
        return {
          text: inserted,
          selection: { start: prefixCursor, end: prefixCursor },
        };
      }
      const nextText = `${before}\n${after}`;
      const nextPos = before.length + 1;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'task': {
      const match = text.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
      if (!match) break;
      if (match[4].trim().length === 0) {
        return { text: '', selection: { start: 0, end: 0 } };
      }
      const nextPrefix = `${match[1]}${match[2]} [ ] `;
      const nextText = `${before}\n${nextPrefix}${after}`;
      const nextPos = before.length + 1 + nextPrefix.length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'ul': {
      const match = text.match(/^(\s*)([-*+])\s+(.*)$/);
      if (!match) break;
      if (match[3].trim().length === 0) {
        return { text: '', selection: { start: 0, end: 0 } };
      }
      const nextPrefix = `${match[1]}${match[2]} `;
      const nextText = `${before}\n${nextPrefix}${after}`;
      const nextPos = before.length + 1 + nextPrefix.length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'ol': {
      const match = text.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
      if (!match) break;
      if (match[4].trim().length === 0) {
        return { text: '', selection: { start: 0, end: 0 } };
      }
      const nextNumber = Number(match[2]) + 1;
      const nextPrefix = `${match[1]}${nextNumber}${match[3]} `;
      const nextText = `${before}\n${nextPrefix}${after}`;
      const nextPos = before.length + 1 + nextPrefix.length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'blockquote': {
      const match = text.match(/^(\s*(?:>\s?)+)(.*)$/);
      if (!match) break;
      if (match[2].trim().length === 0) {
        return { text: '', selection: { start: 0, end: 0 } };
      }
      const nextPrefix = match[1].endsWith(' ') ? match[1] : `${match[1]} `;
      const nextText = `${before}\n${nextPrefix}${after}`;
      const nextPos = before.length + 1 + nextPrefix.length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    default:
      return {
        text: inserted,
        selection: { start: prefixCursor, end: prefixCursor },
      };
  }

  return null;
}

function buildBackspaceBehavior(
  segment: LiveMarkdownSegment,
  text: string,
  selection: SelectionRange
): { text: string; selection: SelectionRange } | null {
  if (segment.kind !== 'simple_line' || selection.start !== 0 || selection.end !== 0) {
    return null;
  }

  switch (segment.simpleKind) {
    case 'heading': {
      const match = text.match(/^(\s*)#{1,6}\s+(.*)$/);
      if (!match) return null;
      const nextText = `${match[1]}${match[2]}`;
      const nextPos = match[1].length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'task': {
      const match = text.match(/^(\s*)[-*+]\s+\[[ xX]\]\s+(.*)$/);
      if (!match) return null;
      const nextText = `${match[1]}${match[2]}`;
      const nextPos = match[1].length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'ul': {
      const match = text.match(/^(\s*)[-*+]\s+(.*)$/);
      if (!match) return null;
      const nextText = `${match[1]}${match[2]}`;
      const nextPos = match[1].length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'ol': {
      const match = text.match(/^(\s*)\d+[.)]\s+(.*)$/);
      if (!match) return null;
      const nextText = `${match[1]}${match[2]}`;
      const nextPos = match[1].length;
      return { text: nextText, selection: { start: nextPos, end: nextPos } };
    }
    case 'blockquote': {
      const match = text.match(/^(\s*(?:>\s?)+)(.*)$/);
      if (!match) return null;
      const leading = match[2].match(/^\s*/)?.[0] ?? '';
      return {
        text: match[2],
        selection: { start: leading.length, end: leading.length },
      };
    }
    default:
      return null;
  }
}

export default function LiveMarkdownEditor({
  content,
  vaultPath,
  notePath,
  anchor,
  onChange,
  fontSize,
  pinchGesture,
  sideSwipe,
  onPullDown,
  focusMode,
  onToggleFocusMode,
  onLinkPress,
  onWikiLinkPress,
  onToggleTask,
}: LiveMarkdownEditorProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const scrollY = useSharedValue(0);
  const { gesture, pullDistance } = useCommandPull(onPullDown, scrollY, pinchGesture);
  const nativeScroll = useNativeGesture({ simultaneousWith: pinchGesture, requireToFail: sideSwipe });
  const listGesture = useExclusiveGestures(gesture, nativeScroll);
  const inputPull = useCommandPull(onPullDown, scrollY, pinchGesture);
  const nativeInput = useNativeGesture({ simultaneousWith: pinchGesture, requireToFail: sideSwipe });
  const inputGesture = useExclusiveGestures(inputPull.gesture, nativeInput);
  const segments = useMemo(() => segmentLiveMarkdown(content), [content]);
  const [activeSelection, setActiveSelection] = useState<AbsoluteSelection | null>(
    null
  );
  const [editingText, setEditingText] = useState('');
  const [localSelection, setLocalSelection] = useState<SelectionRange>({
    start: 0,
    end: 0,
  });
  const [scrollOffset, setScrollOffset] = useState(0);
  const [inputContentHeight, setInputContentHeight] = useState(0);
  const [toolbarHeight, setToolbarHeight] = useState(52);
  const [containerHeight, setContainerHeight] = useState(0);
  const [activeSegmentLayout, setActiveSegmentLayout] = useState<SegmentLayout | null>(
    null
  );
  const [activeBaseHeight, setActiveBaseHeight] = useState(0);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const listRef = useRef<FlatList<LiveMarkdownSegment>>(null);
  const anchorRetry = useRef<{
    anchor: NonNullable<typeof anchor>;
    attempts: number;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const anchorIndex = useMemo(() => {
    if (anchor?.line !== undefined) {
      const line = Math.min(anchor.line - 1, segments.at(-1)?.endLine ?? 0);
      return segments.findIndex(segment => segment.startLine <= line && line <= segment.endLine);
    }
    if (!anchor?.heading) return -1;
    const normalize = (text: string) => text.trim().normalize('NFC').toLowerCase();
    const heading = normalize(anchor.heading);
    return segments.findIndex(segment =>
      segment.simpleKind === 'heading' && normalize(headingInfo(segment.rawText).text) === heading
    );
  }, [anchor, segments]);

  useEffect(() => () => {
    clearTimeout(anchorRetry.current?.timer);
    anchorRetry.current = null;
  }, [anchor]);

  useEffect(() => {
    if (!anchor || anchorIndex < 0 || anchorRetry.current?.anchor === anchor) return;
    anchorRetry.current = {
      anchor,
      attempts: 0,
      timer: setTimeout(() => listRef.current?.scrollToIndex({ index: anchorIndex, animated: false }), 0),
    };
  }, [anchor, anchorIndex]);

  const handleAnchorScrollFailure = ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    const retry = anchorRetry.current;
    if (!retry || retry.attempts >= 4) return;
    retry.attempts++;
    listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
    retry.timer = setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 100);
  };

  const pendingSelectionRef = useRef<AbsoluteSelection | null>(null);
  const pendingContentRef = useRef<string | null>(null);
  const pendingStructuralEditRef = useRef<{
    startLine: number;
    endLine: number;
    replacementText: string;
    selection: SelectionRange;
    kind: 'enter';
  } | null>(null);
  const activeSegmentRef = useRef<LiveMarkdownSegment | null>(null);
  const suppressNextNativeTextChangeRef = useRef(false);
  const shouldFocusInputRef = useRef(false);
  const baseContainerHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const scrollLogCounterRef = useRef(0);
  const segmentRefs = useRef(new Map<string, React.ComponentRef<typeof View> | null>());
  const segmentLayoutsRef = useRef(
    new Map<string, SegmentLayout>()
  );
  const pendingScrollSegmentRef = useRef<string | null>(null);
  const lastAutoScrollTargetRef = useRef<number | null>(null);
  const editingTextRef = useRef('');
  const localSelectionRef = useRef<SelectionRange>({ start: 0, end: 0 });

  const keyboardInset = Math.max(0, keyboard.height - insets.bottom);
  const resizedByKeyboard =
    baseContainerHeightRef.current > 0
      ? Math.max(0, baseContainerHeightRef.current - containerHeight)
      : 0;
  const keyboardOverlayInset = Math.max(0, keyboardInset - resizedByKeyboard);
  const toolbarBottom = focusMode ? 16 + keyboardOverlayInset : keyboardOverlayInset;
  const listBottomPadding = focusMode
    ? keyboardOverlayInset + insets.bottom + 32
    : toolbarHeight + keyboardOverlayInset + insets.bottom + 24;

  const activeSegment = useMemo(() => {
    if (!activeSelection) return null;
    return getSegmentAtOffset(content, segments, activeSelection.start);
  }, [activeSelection, content, segments]);

  const activeMinHeight = activeSegment?.kind === 'raw_block' ? 120 : 44;
  const activeEditorHeight = Math.max(
    activeMinHeight,
    activeBaseHeight,
    inputContentHeight > 0 ? inputContentHeight + 16 : 0
  );
  const activeOverlayFrame = useMemo(
    () =>
      activeSegmentLayout
        ? {
            left: activeSegmentLayout.x,
            top: activeSegmentLayout.y - scrollOffset,
            width: activeSegmentLayout.width,
            height: activeEditorHeight,
          }
        : null,
    [activeEditorHeight, activeSegmentLayout, scrollOffset]
  );

  useEffect(() => {
    editingTextRef.current = editingText;
  }, [editingText]);

  useEffect(() => {
    localSelectionRef.current = localSelection;
  }, [localSelection]);

  useEffect(() => {
    debugLog('activeSegment effect', {
      activeSelection,
      activeSegmentId: activeSegment?.id ?? null,
      activeSegmentKind: activeSegment?.kind ?? null,
      activeSegmentStartLine: activeSegment?.startLine ?? null,
      activeSegmentEndLine: activeSegment?.endLine ?? null,
    });

    if (pendingContentRef.current !== null && content !== pendingContentRef.current) {
      debugLog('waiting for content sync', {
        pendingContentLength: pendingContentRef.current.length,
        currentContentLength: content.length,
      });
      return;
    }

    if (pendingContentRef.current === content) {
      debugLog('content sync complete');
      pendingContentRef.current = null;
    }

    if (!activeSegment) {
      activeSegmentRef.current = null;
      setActiveSegmentLayout((current) => (current === null ? current : null));
      if (activeBaseHeight !== 0) {
        setActiveBaseHeight(0);
      }
      if (editingText !== '') {
        setEditingText('');
      }
      if (inputContentHeight !== 0) {
        setInputContentHeight(0);
      }
      if (!selectionsEqual(localSelection, { start: 0, end: 0 })) {
        setLocalSelection({ start: 0, end: 0 });
      }
      return;
    }

    const measuredLayout = segmentLayoutsRef.current.get(activeSegment.id) ?? null;
    if (measuredLayout && !segmentLayoutsEqual(activeSegmentLayout, measuredLayout)) {
      setActiveSegmentLayout(measuredLayout);
    }

    const baseSelection =
      pendingSelectionRef.current ?? activeSelection ?? { start: activeSegment.endOffset, end: activeSegment.endOffset };
    const nextLocal = clampSelection(
      {
        start: baseSelection.start - activeSegment.startOffset,
        end: baseSelection.end - activeSegment.startOffset,
      },
      activeSegment.rawText.length
    );

    const segmentChanged = activeSegmentRef.current?.id !== activeSegment.id;
    const textChanged = activeSegment.rawText !== editingText;
    const selectionChanged = !selectionsEqual(localSelection, nextLocal);
    if (segmentChanged) {
      const nextBaseHeight = Math.max(activeMinHeight, measuredLayout?.height ?? 0);
      setActiveBaseHeight((current) =>
        current === nextBaseHeight ? current : nextBaseHeight
      );
    }

    if (segmentChanged && !measuredLayout) {
      pendingScrollSegmentRef.current = activeSegment.id;
      debugLog('overlay awaiting fresh layout', {
        segmentId: activeSegment.id,
      });
    }

    if (segmentChanged || textChanged || editingText !== activeSegment.rawText) {
      setEditingText(activeSegment.rawText);
    }

    if (segmentChanged || selectionChanged) {
      setLocalSelection((current) => (selectionsEqual(current, nextLocal) ? current : nextLocal));
      setTimeout(() => {
        if (shouldFocusInputRef.current || activeSegmentRef.current === null) {
          debugLog('overlay focus requested', {
            segmentId: activeSegment.id,
            selection: nextLocal,
          });
          inputRef.current?.focus();
          shouldFocusInputRef.current = false;
        }
        inputRef.current?.setNativeProps({ selection: nextLocal });
      }, 30);
    }

    activeSegmentRef.current = activeSegment;
    pendingSelectionRef.current = null;
  }, [
    activeSegment,
    activeSegmentLayout,
    activeSelection,
    activeBaseHeight,
    activeMinHeight,
    content,
    editingText,
    inputContentHeight,
    localSelection,
  ]);

  const ensureActiveSegmentVisible = useCallback(
    (reason: string) => {
      if (!activeSegment || !activeOverlayFrame || containerHeight <= 0) return;
      if (!activeSegmentLayout) {
        debugLog('auto-scroll waiting for layout', {
          reason,
          segmentId: activeSegment.id,
          containerHeight,
          keyboardInset,
          keyboardOverlayInset,
          resizedByKeyboard,
        });
        pendingScrollSegmentRef.current = activeSegment.id;
        return;
      }

      const topPadding = 12;
      const bottomPadding = 12;
      const visibleTop = topPadding;
      const visibleBottom =
        containerHeight - keyboardOverlayInset - (focusMode ? 0 : toolbarHeight) - bottomPadding;
      const overlayTop = activeOverlayFrame.top;
      const overlayBottom = overlayTop + activeOverlayFrame.height;
      const lineHeight = fontSize * 1.6;
      const explicitLineIndex = editingText.slice(0, localSelection.end).split('\n').length - 1;
      const estimatedCaretBottom = Math.min(
        activeOverlayFrame.height - 8,
        Math.max(lineHeight + 8, 8 + (explicitLineIndex + 1) * lineHeight)
      );
      const targetBottom =
        activeSegment.kind === 'raw_block'
          ? overlayTop + estimatedCaretBottom
          : overlayBottom;

      pendingScrollSegmentRef.current = null;

      if (targetBottom > visibleBottom) {
        const targetOffset = Math.max(
          0,
          scrollOffsetRef.current + (targetBottom - visibleBottom)
        );
        if (
          lastAutoScrollTargetRef.current !== null &&
          Math.abs(lastAutoScrollTargetRef.current - targetOffset) < 12
        ) {
          debugLog('auto-scroll skipped repeated bottom target', {
            reason,
            segmentId: activeSegment.id,
            targetOffset,
            currentOffset: scrollOffsetRef.current,
          });
          return;
        }

        lastAutoScrollTargetRef.current = targetOffset;
        debugLog('auto-scroll to bottom edge', {
          reason,
          segmentId: activeSegment.id,
          targetOffset,
          currentOffset: scrollOffsetRef.current,
          overlayTop,
          overlayBottom,
          targetBottom,
          visibleTop,
          visibleBottom,
          containerHeight,
          keyboardInset,
          keyboardOverlayInset,
          resizedByKeyboard,
          toolbarHeight,
        });
        listRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
        return;
      }

      if (overlayTop < visibleTop) {
        const targetOffset = Math.max(
          0,
          scrollOffsetRef.current - (visibleTop - overlayTop)
        );
        if (
          lastAutoScrollTargetRef.current !== null &&
          Math.abs(lastAutoScrollTargetRef.current - targetOffset) < 12
        ) {
          debugLog('auto-scroll skipped repeated top target', {
            reason,
            segmentId: activeSegment.id,
            targetOffset,
            currentOffset: scrollOffsetRef.current,
          });
          return;
        }

        lastAutoScrollTargetRef.current = targetOffset;
        debugLog('auto-scroll to top edge', {
          reason,
          segmentId: activeSegment.id,
          targetOffset,
          currentOffset: scrollOffsetRef.current,
          overlayTop,
          overlayBottom,
          visibleTop,
          visibleBottom,
          containerHeight,
          keyboardInset,
          keyboardOverlayInset,
          resizedByKeyboard,
          toolbarHeight,
        });
        listRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
        return;
      }

      lastAutoScrollTargetRef.current = null;
      debugLog('auto-scroll not needed', {
        reason,
        segmentId: activeSegment.id,
        currentOffset: scrollOffsetRef.current,
        overlayTop,
        overlayBottom,
        targetBottom,
        visibleTop,
        visibleBottom,
        containerHeight,
        keyboardInset,
        keyboardOverlayInset,
        resizedByKeyboard,
        toolbarHeight,
      });
    },
    [
      activeOverlayFrame,
      activeSegment,
      activeSegmentLayout,
      containerHeight,
      editingText,
      fontSize,
      focusMode,
      keyboardInset,
      keyboardOverlayInset,
      localSelection.end,
      resizedByKeyboard,
      toolbarHeight,
    ]
  );

  useEffect(() => {
    ensureActiveSegmentVisible('effect');
  }, [
    activeOverlayFrame,
    activeEditorHeight,
    activeSegment,
    activeSegment?.id,
    containerHeight,
    ensureActiveSegmentVisible,
    keyboardOverlayInset,
    localSelection.end,
    toolbarHeight,
  ]);

  useEffect(() => {
    if (!activeSegment || !activeOverlayFrame) return;
    debugLog('overlay placement', {
      segmentId: activeSegment.id,
      left: activeOverlayFrame.left,
      top: activeOverlayFrame.top,
      width: activeOverlayFrame.width,
      height: activeOverlayFrame.height,
      scrollOffset,
    });
  }, [
    activeOverlayFrame?.height,
    activeOverlayFrame?.left,
    activeOverlayFrame?.top,
    activeOverlayFrame?.width,
    activeOverlayFrame,
    activeSegment,
    activeSegment?.id,
    scrollOffset,
  ]);

  const handleToolbarLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setToolbarHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const measureSegmentLayout = useCallback(
    (segmentId: string, reason: string) => {
      const segmentView = segmentRefs.current.get(segmentId);
      const containerView = containerRef.current;

      if (!segmentView || !containerView) {
        debugLog('segment measurement skipped', {
          segmentId,
          reason,
          hasSegmentView: Boolean(segmentView),
          hasContainerView: Boolean(containerView),
        });
        return;
      }

      segmentView.measureLayout(
        containerView,
        (x, y, width, height) => {
          const layout = {
            x,
            y,
            width,
            height,
          };
          segmentLayoutsRef.current.set(segmentId, layout);
          if (activeSegment?.id === segmentId) {
            setActiveSegmentLayout((current) =>
              segmentLayoutsEqual(current, layout) ? current : layout
            );
          }
          debugLog('measured segment layout', {
            segmentId,
            reason,
            x,
            y,
            width,
            height,
          });
        },
        () => {
          debugLog('segment measurement failed', {
            segmentId,
            reason,
          });
        }
      );
    },
    [activeSegment?.id]
  );

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (!keyboard.visible || keyboardInset === 0) {
      baseContainerHeightRef.current = Math.max(baseContainerHeightRef.current, nextHeight);
    }
    debugLog('container layout', {
      nextHeight,
      baseContainerHeight: baseContainerHeightRef.current,
      keyboardVisible: keyboard.visible,
      keyboardInset,
    });
    setContainerHeight((current) => (current === nextHeight ? current : nextHeight));
  }, [keyboard.visible, keyboardInset]);

  const handleSegmentLayout = useCallback(
    (segmentId: string, event: LayoutChangeEvent) => {
      debugLog('segment wrapper layout', {
        segmentId,
        x: event.nativeEvent.layout.x,
        y: event.nativeEvent.layout.y,
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      });
      setTimeout(() => {
        measureSegmentLayout(segmentId, 'layout');
      }, 0);

      if (pendingScrollSegmentRef.current === segmentId && activeSegment?.id === segmentId) {
        ensureActiveSegmentVisible('pending-layout');
      }
    },
    [activeSegment, ensureActiveSegmentVisible, measureSegmentLayout]
  );

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextOffset = event.nativeEvent.contentOffset.y;
    scrollOffsetRef.current = nextOffset;
    scrollY.set(nextOffset);
    setScrollOffset((current) => (Math.abs(current - nextOffset) < 0.5 ? current : nextOffset));
    if (activeSegmentRef.current) {
      measureSegmentLayout(activeSegmentRef.current.id, 'scroll');
    }
    scrollLogCounterRef.current += 1;
    if (scrollLogCounterRef.current % 12 === 0) {
      debugLog('list scroll', {
        offsetY: nextOffset,
        viewportHeight: event.nativeEvent.layoutMeasurement.height,
        contentHeight: event.nativeEvent.contentSize.height,
      });
    }
  }, [measureSegmentLayout, scrollY]);

  const activateSegment = useCallback(
    (segment: LiveMarkdownSegment) => {
      const offset = segment.endOffset;
      const measuredLayout = segmentLayoutsRef.current.get(segment.id) ?? null;
      const nextMinHeight = segment.kind === 'raw_block' ? 120 : 44;
      shouldFocusInputRef.current = true;
      debugLog('activate segment', {
        segmentId: segment.id,
        startLine: segment.startLine,
        endLine: segment.endLine,
      });
      if (measuredLayout) {
        setActiveSegmentLayout((current) =>
          segmentLayoutsEqual(current, measuredLayout) ? current : measuredLayout
        );
        setActiveBaseHeight((current) => {
          const nextBaseHeight = Math.max(nextMinHeight, measuredLayout.height);
          return current === nextBaseHeight ? current : nextBaseHeight;
        });
      }
      setActiveSelection({ start: offset, end: offset });
      pendingSelectionRef.current = { start: offset, end: offset };
    },
    []
  );

  const moveSelectionToAbsoluteOffset = useCallback(
    (absoluteOffset: number, reason: string) => {
      const clampedOffset = Math.max(0, Math.min(absoluteOffset, content.length));
      const targetSegment = getSegmentAtOffset(content, segments, clampedOffset);
      if (!targetSegment) {
        debugLog('skipped absolute selection move', {
          reason,
          absoluteOffset,
        });
        return;
      }

      const absoluteSelection = { start: clampedOffset, end: clampedOffset };
      const measuredLayout = segmentLayoutsRef.current.get(targetSegment.id) ?? null;
      const nextMinHeight = targetSegment.kind === 'raw_block' ? 120 : 44;

      pendingSelectionRef.current = absoluteSelection;
      setActiveSelection(absoluteSelection);
      if (measuredLayout) {
        setActiveSegmentLayout((current) =>
          segmentLayoutsEqual(current, measuredLayout) ? current : measuredLayout
        );
        setActiveBaseHeight((current) => {
          const nextBaseHeight = Math.max(nextMinHeight, measuredLayout.height);
          return current === nextBaseHeight ? current : nextBaseHeight;
        });
      }

      setLocalSelection((current) => {
        const nextLocalSelection = clampSelection(
          {
            start: absoluteSelection.start - targetSegment.startOffset,
            end: absoluteSelection.end - targetSegment.startOffset,
          },
          targetSegment.rawText.length
        );
        localSelectionRef.current = nextLocalSelection;
        return selectionsEqual(current, nextLocalSelection)
          ? current
          : nextLocalSelection;
      });

      debugLog('moved absolute selection', {
        reason,
        segmentId: targetSegment.id,
        absoluteSelection,
      });

      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setNativeProps({
          selection: clampSelection(
            {
              start: absoluteSelection.start - targetSegment.startOffset,
              end: absoluteSelection.end - targetSegment.startOffset,
            },
            targetSegment.rawText.length
          ),
        });
      }, 30);
    },
    [content, segments]
  );

  const applySliceChange = useCallback(
    (
      segment: LiveMarkdownSegment,
      newText: string,
      nextSelection?: SelectionRange,
      suppressNativeTextChange = false
    ) => {
      const previousText = editingTextRef.current;
      const previousSelection = localSelectionRef.current;
      debugLog('applySliceChange', {
        segmentId: segment.id,
        startLine: segment.startLine,
        endLine: segment.endLine,
        oldText: previousText,
        newText,
        nextSelection,
        suppressNativeTextChange,
      });
      const nextContent = replaceLineRange(
        content,
        segment.startLine,
        segment.endLine,
        newText
      );
      editingTextRef.current = newText;
      setEditingText(newText);

      const targetSelection =
        nextSelection ??
        clampSelection(
          {
            start: previousSelection.end + (newText.length - previousText.length),
            end: previousSelection.end + (newText.length - previousText.length),
          },
          newText.length
        );

      localSelectionRef.current = targetSelection;
      setLocalSelection(targetSelection);
      pendingSelectionRef.current = {
        start: segment.startOffset + targetSelection.start,
        end: segment.startOffset + targetSelection.end,
      };
      if (suppressNativeTextChange) {
        activeSegmentRef.current = null;
      }
      pendingContentRef.current = nextContent;
      setActiveSelection(pendingSelectionRef.current);
      if (suppressNativeTextChange) {
        suppressNextNativeTextChangeRef.current = true;
      }
      if (nextSelection) {
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.setNativeProps({ selection: targetSelection });
        }, 30);
      }
      onChange(nextContent);
    },
    [content, onChange]
  );

  const applyContentChange = useCallback(
    (
      nextContent: string,
      nextAbsoluteSelection: AbsoluteSelection,
      suppressNativeTextChange = false
    ) => {
      debugLog('applyContentChange', {
        nextAbsoluteSelection,
        suppressNativeTextChange,
      });
      pendingSelectionRef.current = nextAbsoluteSelection;
      if (suppressNativeTextChange) {
        activeSegmentRef.current = null;
      }
      pendingContentRef.current = nextContent;
      setActiveSelection(nextAbsoluteSelection);
      if (suppressNativeTextChange) {
        suppressNextNativeTextChangeRef.current = true;
      }
      onChange(nextContent);
    },
    [onChange]
  );

  useEffect(() => {
    const pendingEdit = pendingStructuralEditRef.current;
    if (!pendingEdit || pendingContentRef.current !== null) {
      return;
    }

    const lineStart = getLineInfo(content, pendingEdit.startLine).start;
    const nextContent = replaceLineRange(
      content,
      pendingEdit.startLine,
      pendingEdit.endLine,
      pendingEdit.replacementText
    );
    const nextAbsoluteSelection = {
      start: lineStart + pendingEdit.selection.start,
      end: lineStart + pendingEdit.selection.end,
    };

    pendingStructuralEditRef.current = null;

    debugLog('applying deferred structural edit', {
      kind: pendingEdit.kind,
      startLine: pendingEdit.startLine,
      endLine: pendingEdit.endLine,
      replacementText: pendingEdit.replacementText,
      nextAbsoluteSelection,
      changedContent: nextContent !== content,
    });

    if (nextContent === content) {
      pendingSelectionRef.current = nextAbsoluteSelection;
      setActiveSelection(nextAbsoluteSelection);
      return;
    }

    applyContentChange(nextContent, nextAbsoluteSelection);
  }, [applyContentChange, content]);

  const handleTextChange = useCallback(
    (nextText: string) => {
      const segment = activeSegmentRef.current ?? activeSegment;
      if (!segment) return;
      const currentText = editingTextRef.current;
      debugLog('onChangeText', {
        segmentId: segment.id,
        oldText: currentText,
        nextText,
        suppressNextNativeTextChange: suppressNextNativeTextChangeRef.current,
      });
      if (suppressNextNativeTextChangeRef.current) {
        suppressNextNativeTextChangeRef.current = false;
        debugLog('suppressed native onChangeText');
        return;
      }

      if (nextText === currentText) {
        debugLog('ignored duplicate onChangeText', {
          segmentId: segment.id,
          nextText,
        });
        return;
      }

      const inferredSelection = inferSelectionAfterTextChange(currentText, nextText);
      const change = diffTextChange(currentText, nextText);

      const isSingleEnter =
        countNewlines(nextText) === countNewlines(currentText) + 1 &&
        change.insertedText === '\n' &&
        change.removedText.length === 0;

      if (isSingleEnter) {
        debugLog('fallback enter detected via onChangeText');
        const transformed = buildEnterBehavior(segment, currentText, {
          start: change.prefixLength,
          end: change.prefixLength,
        });
        if (transformed) {
          const needsDeferredNormalization =
            transformed.text !== nextText ||
            transformed.selection.start !== inferredSelection.start ||
            transformed.selection.end !== inferredSelection.end;

          if (needsDeferredNormalization && segment.kind === 'simple_line') {
            pendingStructuralEditRef.current = {
              startLine: segment.startLine,
              endLine: segment.startLine + countNewlines(nextText),
              replacementText: transformed.text,
              selection: transformed.selection,
              kind: 'enter',
            };
            debugLog('queued deferred enter normalization', {
              startLine: segment.startLine,
              endLine: segment.startLine + countNewlines(nextText),
              replacementText: transformed.text,
              replacementSelection: transformed.selection,
            });
            applySliceChange(segment, nextText, inferredSelection);
            return;
          }

          applySliceChange(segment, transformed.text, transformed.selection);
          return;
        }
      }

      applySliceChange(segment, nextText, inferredSelection);
    },
    [activeSegment, applySliceChange]
  );

  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string } }) => {
      const segment = activeSegmentRef.current ?? activeSegment;
      if (!segment) return;
      const currentSelection = localSelectionRef.current;
      const currentText = editingTextRef.current;
      debugLog('onKeyPress', {
        key: event.nativeEvent.key,
        segmentId: segment.id,
        localSelection: currentSelection,
        text: currentText,
      });
      if (event.nativeEvent.key === 'Enter') {
        debugLog('native Enter observed');
        return;
      }

      if (
        event.nativeEvent.key === 'ArrowUp' ||
        event.nativeEvent.key === 'ArrowDown'
      ) {
        const currentAbsoluteOffset = segment.startOffset + currentSelection.end;
        const currentLine = findLineFromOffset(content, currentAbsoluteOffset);
        const targetLine =
          event.nativeEvent.key === 'ArrowUp' ? currentLine - 1 : currentLine + 1;
        const totalLines = content.split('\n').length;

        if (targetLine < 0 || targetLine >= totalLines) {
          debugLog('ignored vertical navigation at boundary', {
            key: event.nativeEvent.key,
            currentLine,
          });
          return;
        }

        const currentLineInfo = getLineInfo(content, currentLine);
        const targetLineInfo = getLineInfo(content, targetLine);
        const column = Math.max(0, currentAbsoluteOffset - currentLineInfo.start);
        const targetAbsoluteOffset = Math.min(
          targetLineInfo.start + column,
          targetLineInfo.end
        );

        debugLog('handled vertical navigation', {
          key: event.nativeEvent.key,
          currentLine,
          targetLine,
          column,
          targetAbsoluteOffset,
        });
        moveSelectionToAbsoluteOffset(
          targetAbsoluteOffset,
          event.nativeEvent.key
        );
        return;
      }

      if (event.nativeEvent.key !== 'Backspace') return;

      if (
        segment.simpleKind === 'blank' &&
        currentSelection.start === 0 &&
        currentSelection.end === 0 &&
        segment.startLine > 0
      ) {
        const previousLine = getLineInfo(content, segment.startLine - 1);
        const nextContent = replaceLineRange(
          content,
          segment.startLine - 1,
          segment.startLine,
          previousLine.text
        );
        debugLog('handled Backspace on blank line', {
          currentLine: segment.startLine,
          previousLine: segment.startLine - 1,
          previousLineText: previousLine.text,
        });
        applyContentChange(nextContent, {
          start: previousLine.end,
          end: previousLine.end,
        }, true);
        return;
      }

      const transformed = buildBackspaceBehavior(
        segment,
        currentText,
        currentSelection
      );
      if (transformed) {
        debugLog('handled structural Backspace', {
          transformedText: transformed.text,
          transformedSelection: transformed.selection,
        });
        applySliceChange(segment, transformed.text, transformed.selection, true);
      }
    },
    [activeSegment, applyContentChange, applySliceChange, content, moveSelectionToAbsoluteOffset]
  );

  const handleSelectionChange = useCallback(
    (selection: SelectionRange) => {
      const segment = activeSegmentRef.current ?? activeSegment;
      if (!segment) return;
      if (pendingContentRef.current !== null || pendingSelectionRef.current !== null) {
        debugLog('ignored onSelectionChange during sync', {
          segmentId: segment.id,
          incomingSelection: selection,
          pendingContentLength: pendingContentRef.current?.length ?? null,
          pendingSelection: pendingSelectionRef.current,
        });
        return;
      }

      const clamped = clampSelection(selection, editingText.length);
      localSelectionRef.current = clamped;
      debugLog('accepted onSelectionChange', {
        segmentId: segment.id,
        selection: clamped,
      });
      setLocalSelection(clamped);
      setActiveSelection({
        start: segment.startOffset + clamped.start,
        end: segment.startOffset + clamped.end,
      });
    },
    [activeSegment, editingText.length]
  );

  const handleContentSizeChange = useCallback(
    (
      event: TextInputContentSizeChangeEvent
    ) => {
      const nextHeight = Math.ceil(event.nativeEvent.contentSize.height);
      debugLog('overlay content size', {
        height: nextHeight,
      });
      setInputContentHeight((current) =>
        Math.abs(current - nextHeight) < 1 ? current : nextHeight
      );
    },
    []
  );

  const handleToolbarPress = useCallback(
    (action: ToolbarAction['action']) => {
      if (!activeSegment) return;
      const result = action(editingText, localSelection);
      applySliceChange(activeSegment, result.text, result.selection);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setNativeProps({ selection: result.selection });
      }, 20);
    },
    [activeSegment, applySliceChange, editingText, localSelection]
  );

  const renderActivePlaceholder = useCallback(
    (segment: LiveMarkdownSegment) => {
      return (
        <View
          pointerEvents="none"
          style={[
            styles.activePlaceholder,
            {
              minHeight: activeEditorHeight,
            },
          ]}
        />
      );
    },
    [activeEditorHeight]
  );

  const renderInactiveSegment = useCallback(
    (segment: LiveMarkdownSegment) => {
      const lineHeight = fontSize * 1.6;
      if (segment.kind === 'raw_block') {
        const history = segment.rawBlockKind === 'code_block'
          ? /^\s*```githistory[^\S\n]*\n([\s\S]*?)^\s*```\s*$/m.exec(segment.rawText)
          : null;
        if (history && vaultPath) {
          return <GitHistoryBlock key={history[1]} source={history[1]} vaultPath={vaultPath} notePath={notePath} />;
        }
        return (
          <Pressable
            onPress={() => activateSegment(segment)}
            style={[
              styles.rawBlockShell,
              {
                backgroundColor: colors.bgSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.rawBlockLabel, { color: colors.textMuted }]}>
              {rawBlockTitle(segment.rawBlockKind)}
            </Text>
            <Text
              style={[
                styles.rawBlockText,
                {
                  color: colors.textPrimary,
                  fontSize: fontSize - 1,
                },
              ]}
            >
              {segment.rawText}
            </Text>
          </Pressable>
        );
      }

      switch (segment.simpleKind) {
        case 'blank':
          return <View style={{ minHeight: lineHeight * 0.8 }} />;
        case 'heading': {
          const info = headingInfo(segment.rawText);
          const sizes = [
            fontSize * 2,
            fontSize * 1.65,
            fontSize * 1.35,
            fontSize * 1.15,
            fontSize,
            fontSize * 0.9,
          ];
          const size = sizes[info.level - 1] || fontSize;
          return (
            <InlineMarkdown
              text={info.text}
              fontSize={size}
              colors={colors}
              onLinkPress={onLinkPress}
              onWikiLinkPress={onWikiLinkPress}
              linkPressMode="longPress"
              style={{
                color: colors.textPrimary,
                fontWeight: '700',
                lineHeight: size * 1.3,
              }}
            />
          );
        }
        case 'blockquote':
          return (
            <View style={styles.blockquote}>
              <View
                style={[
                  styles.blockquoteBorder,
                  { backgroundColor: colors.textMuted },
                ]}
              />
              <InlineMarkdown
                text={segment.rawText.replace(/^>\s?/, '')}
                fontSize={fontSize}
                colors={colors}
                onLinkPress={onLinkPress}
                onWikiLinkPress={onWikiLinkPress}
                linkPressMode="longPress"
                style={{
                  color: colors.textSecondary,
                  lineHeight,
                  fontStyle: 'italic',
                  flex: 1,
                }}
              />
            </View>
          );
        case 'task': {
          const info = taskInfo(segment.rawText);
          return (
            <View style={styles.listItem}>
              <TouchableOpacity
                onPress={() => onToggleTask?.(segment.startLine)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: info.checked }}
                accessibilityLabel={info.text}
                style={styles.checkboxTap}
              >
                <Text
                  style={[
                    styles.listBullet,
                    { color: info.checked ? colors.green : colors.textMuted },
                  ]}
                >
                  {info.checked ? '\u2611' : '\u2610'}
                </Text>
              </TouchableOpacity>
              <View style={styles.listItemContent}>
                <InlineMarkdown
                  text={info.text}
                  fontSize={fontSize}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onWikiLinkPress={onWikiLinkPress}
                  linkPressMode="longPress"
                  style={{
                    color: info.checked ? colors.textMuted : colors.textPrimary,
                    lineHeight,
                    textDecorationLine: info.checked ? 'line-through' : 'none',
                  }}
                />
              </View>
            </View>
          );
        }
        case 'ul':
        case 'ol': {
          const info = listInfo(segment.rawText);
          return (
            <View style={styles.listItem}>
              <Text style={[styles.listBullet, { color: colors.textMuted }]}>
                {info.bullet}
              </Text>
              <View style={styles.listItemContent}>
                <InlineMarkdown
                  text={info.text}
                  fontSize={fontSize}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onWikiLinkPress={onWikiLinkPress}
                  linkPressMode="longPress"
                  style={{ color: colors.textPrimary, lineHeight }}
                />
              </View>
            </View>
          );
        }
        case 'hr':
          return (
            <View
              style={[styles.hr, { backgroundColor: colors.border }]}
            />
          );
        case 'paragraph':
        default:
          return (
            <InlineMarkdown
              text={segment.rawText}
              fontSize={fontSize}
              colors={colors}
              onLinkPress={onLinkPress}
              onWikiLinkPress={onWikiLinkPress}
              linkPressMode="longPress"
              style={{ color: colors.textPrimary, lineHeight }}
            />
          );
      }
    },
    [
      activateSegment,
      colors,
      fontSize,
      notePath,
      onLinkPress,
      onToggleTask,
      onWikiLinkPress,
      vaultPath,
    ]
  );

  const renderItem = useCallback(
    ({ item }: { item: LiveMarkdownSegment }) => {
      const isActive = item.id === activeSegment?.id;
      return (
        <View
          ref={(node) => {
            segmentRefs.current.set(item.id, node);
          }}
          onLayout={(event) => handleSegmentLayout(item.id, event)}
        >
          <Pressable
            onPress={() => {
              if (!isActive) activateSegment(item);
            }}
            style={[
              styles.segment,
              isActive
                ? styles.activeSegment
                : undefined,
            ]}
          >
            {isActive ? renderActivePlaceholder(item) : renderInactiveSegment(item)}
          </Pressable>
        </View>
      );
    },
    [
      activateSegment,
      activeSegment?.id,
      handleSegmentLayout,
      renderActivePlaceholder,
      renderInactiveSegment,
    ]
  );

  return (
    <View
      ref={containerRef}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      onLayout={handleContainerLayout}
    >
      <GestureDetector gesture={listGesture}>
        <FlatList
          ref={listRef}
          data={segments}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: listBottomPadding },
          ]}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator
          onScroll={handleListScroll}
          onScrollToIndexFailed={handleAnchorScrollFailure}
          scrollEventThrottle={16}
        />
      </GestureDetector>

      {activeSegment && activeOverlayFrame ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.overlayShell,
            {
              left: activeOverlayFrame.left,
              top: activeOverlayFrame.top,
              width: activeOverlayFrame.width,
            },
          ]}
        >
          <GestureDetector gesture={inputGesture}>
            <TextInput
              ref={inputRef}
              style={[
                styles.textInput,
                styles.overlayInput,
                {
                  minHeight: activeEditorHeight,
                  fontSize,
                  lineHeight: fontSize * 1.6,
                  color: colors.textPrimary,
                  backgroundColor:
                    activeSegment.kind === 'raw_block'
                      ? colors.bgSecondary
                      : colors.bgPrimary,
                  borderColor: colors.border,
                },
                activeSegment.kind === 'raw_block'
                  ? styles.rawBlockInput
                  : styles.simpleLineInput,
              ]}
              value={editingText}
              onChangeText={handleTextChange}
              onSelectionChange={(event) =>
                handleSelectionChange(event.nativeEvent.selection)
              }
              onContentSizeChange={handleContentSizeChange}
              onKeyPress={handleKeyPress}
              multiline
              textAlignVertical="top"
              submitBehavior="newline"
              blurOnSubmit={false}
              showSoftInputOnFocus
              disableFullscreenUI
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              scrollEnabled={false}
              selectionColor={colors.accent + '80'}
              placeholderTextColor={colors.textMuted}
              placeholder={
                activeSegment.simpleKind === 'blank' ? ' ' : undefined
              }
            />
          </GestureDetector>
        </View>
      ) : null}

      {onPullDown && <>
        <CommandPullIndicator pullDistance={pullDistance} />
        <CommandPullIndicator pullDistance={inputPull.pullDistance} />
      </>}

      {!focusMode && (
        <View
          onLayout={handleToolbarLayout}
          style={[
            styles.toolbar,
            {
              backgroundColor: colors.bgSecondary,
              borderTopColor: colors.border,
              bottom: toolbarBottom,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarContent}
            keyboardShouldPersistTaps="always"
          >
            {toolbarActions.map((action) => (
              <TouchableOpacity
                key={action.label}
                style={[
                  styles.toolbarButton,
                  { backgroundColor: colors.bgTertiary },
                ]}
                onPress={() => handleToolbarPress(action.action)}
                activeOpacity={0.6}
              >
                <Ionicons
                  name={action.icon}
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            ))}
            {onToggleFocusMode && (
              <TouchableOpacity
                style={[
                  styles.toolbarButton,
                  { backgroundColor: colors.bgTertiary },
                ]}
                onPress={onToggleFocusMode}
                activeOpacity={0.6}
              >
                <Ionicons
                  name="contract-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {focusMode && onToggleFocusMode && (
        <TouchableOpacity
          style={[
            styles.focusExitBtn,
            {
              backgroundColor: colors.bgSecondary + 'cc',
              borderColor: colors.border,
              bottom: toolbarBottom,
            },
          ]}
          onPress={onToggleFocusMode}
        >
          <Ionicons name="expand-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  segment: {
    marginBottom: 4,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  activeSegment: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  overlayShell: {
    position: 'absolute',
    zIndex: 20,
  },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  overlayInput: {
    width: '100%',
  },
  activePlaceholder: {
    width: '100%',
  },
  simpleLineInput: {
    minHeight: 44,
  },
  rawBlockInput: {
    minHeight: 120,
  },
  rawBlockShell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rawBlockLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rawBlockText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 20,
  },
  blockquote: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 4,
  },
  blockquoteBorder: {
    width: 3,
    borderRadius: 2,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  listBullet: {
    width: 24,
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  listItemContent: {
    flex: 1,
    paddingTop: 2,
  },
  checkboxTap: {
    paddingRight: 2,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
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
    width: 40,
    height: 36,
    borderRadius: 8,
  },
  focusExitBtn: {
    position: 'absolute',
    right: 12,
    bottom: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
