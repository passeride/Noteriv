import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { useTheme } from '@/context/ThemeContext';

export default function PdfPreview({ uri, onError }: { uri: string; onError: () => void }) {
  const { colors } = useTheme();
  const [page, setPage] = useState<[number, number]>();
  return (
    <View style={styles.container}>
      <Pdf source={{ uri, cache: false }} style={[styles.container, { backgroundColor: colors.bgTertiary }]}
        trustAllCerts={false} onError={onError} onPageChanged={(number, count) => setPage([number, count])} />
      {page && <Text pointerEvents="none" style={[styles.page, { color: colors.textPrimary, backgroundColor: colors.bgSecondary }]}>
        {page[0]} / {page[1]}
      </Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%' },
  page: { position: 'absolute', bottom: 12, right: 12, borderRadius: 14, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5 },
});
