import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';

export default function SyncToast({ message }: { message?: string }) {
  const { colors, metrics } = useTheme();

  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.position}>
      <Text accessibilityLiveRegion="polite" numberOfLines={4} style={[styles.message, {
        backgroundColor: colors.bgTertiary, borderColor: colors.border,
        borderRadius: metrics.panelRadius, color: colors.textPrimary,
      }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 16, bottom: 72, alignItems: 'center', zIndex: 110 },
  message: { maxWidth: 520, paddingHorizontal: 16, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
});
