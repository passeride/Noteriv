import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';

type MediaProps = { uri: string; onError: () => void };

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(safe / 60) + ':' + String(safe % 60).padStart(2, '0');
}

export function AudioPreview({ uri, onError }: MediaProps) {
  const { colors } = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);
  const duration = Math.max(0, status.duration || 0);
  const time = Math.min(duration, Math.max(0, status.currentTime || 0));
  const seek = (seconds: number) => {
    if (duration > 0) void player.seekTo(Math.min(duration, Math.max(0, seconds))).catch(onError);
  };
  useEffect(() => {
    if (status.error) onError();
  }, [onError, status.error]);

  async function toggle() {
    try {
      if (status.playing) {
        player.pause();
      } else {
        if (status.didJustFinish || (duration > 0 && time >= duration)) await player.seekTo(0);
        player.play();
      }
    } catch { onError(); }
  }

  return (
    <View style={styles.audio}>
      <Ionicons name="musical-notes-outline" size={54} color={colors.accent} />
      {!status.isLoaded && <ActivityIndicator accessibilityLabel="Opening audio" color={colors.accent} />}
      <Pressable accessibilityRole="adjustable" accessibilityLabel="Playback position"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityState={{ disabled: duration === 0 }}
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(time), text: formatTime(time) }}
        onAccessibilityAction={event => seek(time + (event.nativeEvent.actionName === 'increment' ? 15 : -15))}
        onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
        onPress={event => { if (trackWidth > 0) seek(duration * event.nativeEvent.locationX / trackWidth); }}
        style={styles.track}>
        <View pointerEvents="none" style={[styles.rail, { backgroundColor: colors.border }]}>
          <View style={{ width: `${duration > 0 ? time / duration * 100 : 0}%`, height: '100%', backgroundColor: colors.accent }} />
        </View>
      </Pressable>
      <View style={styles.times}>
        <Text style={{ color: colors.textSecondary }}>{formatTime(time)}</Text>
        <Text style={{ color: colors.textSecondary }}>{formatTime(duration)}</Text>
      </View>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back 15 seconds" disabled={!status.isLoaded}
          style={styles.control} onPress={() => seek(time - 15)}>
          <Text style={{ color: colors.textPrimary }}>−15s</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'} disabled={!status.isLoaded}
          style={[styles.play, { backgroundColor: colors.accent }]} onPress={() => void toggle()}>
          <Ionicons name={status.playing ? 'pause' : 'play'} size={26} color={colors.bgPrimary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Forward 15 seconds" disabled={!status.isLoaded}
          style={styles.control} onPress={() => seek(time + 15)}>
          <Text style={{ color: colors.textPrimary }}>+15s</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function VideoPreview({ uri, onError }: MediaProps) {
  const player = useVideoPlayer(uri);
  const load = useEvent(player, 'sourceLoad');
  const status = useEvent(player, 'statusChange', { status: player.status });
  const [audioOnly, setAudioOnly] = useState(false);
  useEffect(() => {
    if (status.status === 'error') onError();
    if (load && load.availableVideoTracks.length === 0 && load.availableAudioTracks.length > 0) {
      player.pause();
      setAudioOnly(true);
    }
  }, [load, onError, player, status.status]);
  return audioOnly
    ? <AudioPreview uri={uri} onError={onError} />
    : <VideoView player={player} style={styles.video} nativeControls contentFit="contain"
        fullscreenOptions={{ enable: true }} useExoShutter />;
}

const styles = StyleSheet.create({
  audio: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 460, alignSelf: 'center', padding: 28, gap: 12 },
  track: { width: '100%', minHeight: 44, justifyContent: 'center' },
  rail: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  times: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: -16 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  control: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  play: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  video: { flex: 1, width: '100%', backgroundColor: '#000' },
});
