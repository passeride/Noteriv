import React, { useState, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import OutlinePanel from '@/components/OutlinePanel';
import { useTheme } from '@/context/ThemeContext';
import { readProperties } from '@/lib/properties';

interface Props {
  content: string;
  onClose: () => void;
  onJump: (line: number) => void;
  onOpenLinks: () => void;
  onEditProperties: () => void;
  onOpenHistory: () => void;
}

export default function NoteDetails({ content, onClose, onJump, onOpenLinks, onEditProperties, onOpenHistory }: Props) {
  const { colors, metrics } = useTheme();
  const [tab, setTab] = useState<'Outline' | 'Links' | 'Properties'>('Outline');
  const properties = useMemo(() => tab === 'Properties' ? readProperties(content) : [], [content, tab]);
  const linkAction = (label: string, run: () => void) => (
    <Pressable accessibilityRole="button" onPress={() => { onClose(); requestAnimationFrame(run); }} style={styles.action}>
      <Text style={{ color: colors.accent, fontWeight: '600' }}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.accent} />
    </Pressable>
  );

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.stage}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close note details" onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.bgPrimary, borderColor: colors.border,
          borderTopLeftRadius: metrics.panelRadius, borderTopRightRadius: metrics.panelRadius }]} accessibilityViewIsModal>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Note details</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close note details" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={[styles.tabs, { borderColor: colors.border }]} accessibilityRole="tablist">
            {(['Outline', 'Links', 'Properties'] as const).map(item => (
              <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: item === tab }}
                onPress={() => setTab(item)} style={[styles.tab, { borderRadius: metrics.controlRadius },
                  item === tab && { backgroundColor: colors.accent + '18' }]}>
                <Text style={{ color: item === tab ? colors.accent : colors.textSecondary, fontWeight: '600' }}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.body}>
            {tab === 'Outline' && <OutlinePanel content={content} onHeadingPress={line => { onClose(); onJump(line + 1); }} />}
            {tab === 'Links' && linkAction('Browse backlinks', onOpenLinks)}
            {tab === 'Properties' && <ScrollView>
              {properties.map(({ key, value }) => (
                <View key={key} style={[styles.property, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.textMuted }}>{key}</Text>
                  <Text numberOfLines={2} style={{ color: colors.textPrimary }}>
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </Text>
                </View>
              ))}
              {linkAction('Edit properties', onEditProperties)}
            </ScrollView>}
          </View>
          {linkAction('File history', onOpenHistory)}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,20,0.38)' },
  sheet: { maxHeight: '84%', height: '66%', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  handle: { width: 36, height: 4, borderRadius: 2, marginTop: 9, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  tab: { minHeight: 44, paddingHorizontal: 11, justifyContent: 'center', marginBottom: 5 },
  body: { flex: 1, minHeight: 0 },
  action: { minHeight: 48, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  property: { marginHorizontal: 18, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
});
