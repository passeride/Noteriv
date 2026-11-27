import { useEffect } from 'react';

export default function PdfPreview({ onError }: { uri: string; onError: () => void }) {
  useEffect(onError, [onError]);
  return null;
}
