import React, { useMemo } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { InlineNode, parseInline } from '@/lib/markdown';

type LinkPressMode = 'press' | 'longPress';

interface InlineMarkdownProps {
  text: string;
  fontSize: number;
  colors: any;
  onLinkPress?: (url: string) => void;
  onWikiLinkPress?: (name: string) => void;
  linkPressMode?: LinkPressMode;
  style?: any;
}

function RenderInline({
  nodes,
  fontSize,
  colors,
  onLinkPress,
  onWikiLinkPress,
  linkPressMode = 'press',
}: {
  nodes: InlineNode[];
  fontSize: number;
  colors: any;
  onLinkPress?: (url: string) => void;
  onWikiLinkPress?: (name: string) => void;
  linkPressMode?: LinkPressMode;
}) {
  const linkPressProps =
    linkPressMode === 'longPress'
      ? (handler: () => void) => ({ onLongPress: handler })
      : (handler: () => void) => ({ onPress: handler });

  return (
    <Text>
      {nodes.map((node, idx) => {
        switch (node.type) {
          case 'text':
            return (
              <Text key={idx} style={{ color: colors.textPrimary, fontSize }}>
                {node.text}
              </Text>
            );
          case 'bold':
            return (
              <Text
                key={idx}
                style={{ fontWeight: '700', color: colors.textPrimary, fontSize }}
              >
                <RenderInline
                  nodes={node.children}
                  fontSize={fontSize}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onWikiLinkPress={onWikiLinkPress}
                  linkPressMode={linkPressMode}
                />
              </Text>
            );
          case 'italic':
            return (
              <Text
                key={idx}
                style={{ fontStyle: 'italic', color: colors.textPrimary, fontSize }}
              >
                <RenderInline
                  nodes={node.children}
                  fontSize={fontSize}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onWikiLinkPress={onWikiLinkPress}
                  linkPressMode={linkPressMode}
                />
              </Text>
            );
          case 'strikethrough':
            return (
              <Text
                key={idx}
                style={{
                  textDecorationLine: 'line-through',
                  color: colors.textMuted,
                  fontSize,
                }}
              >
                <RenderInline
                  nodes={node.children}
                  fontSize={fontSize}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onWikiLinkPress={onWikiLinkPress}
                  linkPressMode={linkPressMode}
                />
              </Text>
            );
          case 'highlight':
            return (
              <Text
                key={idx}
                style={{
                  backgroundColor: colors.yellow + '40',
                  color: colors.textPrimary,
                  fontSize,
                }}
              >
                <RenderInline
                  nodes={node.children}
                  fontSize={fontSize}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onWikiLinkPress={onWikiLinkPress}
                  linkPressMode={linkPressMode}
                />
              </Text>
            );
          case 'superscript':
            return (
              <Text
                key={idx}
                style={{
                  fontSize: fontSize * 0.7,
                  color: colors.textPrimary,
                  lineHeight: fontSize,
                }}
              >
                {node.text}
              </Text>
            );
          case 'subscript':
            return (
              <Text
                key={idx}
                style={{
                  fontSize: fontSize * 0.7,
                  color: colors.textPrimary,
                  lineHeight: fontSize,
                }}
              >
                {node.text}
              </Text>
            );
          case 'code':
            return (
              <Text
                key={idx}
                style={{
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  backgroundColor: colors.bgTertiary,
                  color: colors.peach,
                  fontSize: fontSize - 1,
                  borderRadius: 3,
                  paddingHorizontal: 4,
                }}
              >
                {node.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={idx}
                style={{
                  color: colors.blue,
                  fontSize,
                  textDecorationLine: 'underline',
                }}
                {...linkPressProps(() => onLinkPress?.(node.url))}
              >
                {node.text}
              </Text>
            );
          case 'image':
            return (
              <View key={idx} style={{ marginVertical: 4 }}>
                <Image
                  source={{ uri: node.url }}
                  style={{
                    width: node.width || ('100%' as any),
                    height: node.height || 200,
                    borderRadius: 8,
                    resizeMode:
                      node.width && node.height ? 'stretch' : 'cover',
                  }}
                  accessibilityLabel={node.alt}
                />
                {node.alt ? (
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: fontSize - 2,
                      marginTop: 2,
                      textAlign: 'center',
                    }}
                  >
                    {node.alt}
                  </Text>
                ) : null}
              </View>
            );
          case 'wikilink':
            return (
              <Text
                key={idx}
                style={{ color: colors.blue, fontSize }}
                {...linkPressProps(() => onWikiLinkPress?.(node.name))}
              >
                {node.name}
              </Text>
            );
          case 'tag':
            return (
              <Text
                key={idx}
                style={{
                  color: colors.mauve,
                  fontSize,
                  fontWeight: '500',
                  backgroundColor: colors.mauve + '18',
                  borderRadius: 3,
                  paddingHorizontal: 3,
                }}
              >
                {node.tag}
              </Text>
            );
          case 'math':
            return (
              <Text
                key={idx}
                style={{
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  color: colors.peach,
                  fontSize: fontSize - 1,
                  backgroundColor: colors.bgTertiary,
                  paddingHorizontal: 3,
                }}
              >
                {node.code}
              </Text>
            );
          case 'embed':
            return (
              <Text key={idx} style={{ color: colors.blue, fontSize }}>
                {'↗ '}
                {node.name}
              </Text>
            );
          case 'footnote_ref':
            return (
              <Text
                key={idx}
                style={{
                  color: colors.accent,
                  fontSize: fontSize * 0.75,
                  lineHeight: fontSize,
                  fontWeight: '600',
                }}
              >
                [{node.id}]
              </Text>
            );
          default:
            return null;
        }
      })}
    </Text>
  );
}

export default function InlineMarkdown({
  text,
  fontSize,
  colors,
  onLinkPress,
  onWikiLinkPress,
  linkPressMode = 'press',
  style,
}: InlineMarkdownProps) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return (
    <Text style={style}>
      <RenderInline
        nodes={nodes}
        fontSize={fontSize}
        colors={colors}
        onLinkPress={onLinkPress}
        onWikiLinkPress={onWikiLinkPress}
        linkPressMode={linkPressMode}
      />
    </Text>
  );
}
