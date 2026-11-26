import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GestureStateManager, usePanGesture, type PinchGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/context/ThemeContext';

const THRESHOLD = 52;

function signalThreshold() {
  void Haptics.selectionAsync().catch(() => undefined);
}

function distance(x: number, y: number) {
  'worklet';
  return y > Math.abs(x) * 1.5 ? y : 0;
}

export function useCommandPull(onPullDown: (() => void) | undefined, scrollY: SharedValue<number>, pinchGesture?: PinchGesture) {
  const pullDistance = useSharedValue(0);
  const signaled = useSharedValue(false);
  const gesture = usePanGesture({
    enabled: !!onPullDown,
    maxPointers: 1,
    activeOffsetY: 12,
    failOffsetY: -8,
    failOffsetX: [-20, 20],
    simultaneousWith: pinchGesture,
    onTouchesDown: event => {
      'worklet';
      // A drag that scrolls back to the top should finish as a scroll.
      if (scrollY.value > 2) GestureStateManager.fail(event.handlerTag);
    },
    onUpdate: event => {
      'worklet';
      pullDistance.value = distance(event.translationX, event.translationY);
      if (pullDistance.value >= THRESHOLD && !signaled.value) {
        signaled.value = true;
        scheduleOnRN(signalThreshold);
      }
    },
    onDeactivate: event => {
      'worklet';
      if (onPullDown && !event.canceled && distance(event.translationX, event.translationY) >= THRESHOLD) {
        scheduleOnRN(onPullDown);
      }
    },
    onFinalize: () => {
      'worklet';
      signaled.value = false;
      pullDistance.value = withTiming(0, { duration: 120 });
    },
  });
  return { gesture, pullDistance };
}

export function CommandPullIndicator({ pullDistance, top = 8 }: { pullDistance: SharedValue<number>; top?: number }) {
  const { colors } = useTheme();
  const animatedStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, pullDistance.value / THRESHOLD);
    return { opacity: progress, transform: [{ translateY: 16 * progress - 10 }, { scale: 0.85 + 0.15 * progress }] };
  });

  return (
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.indicator, { top, backgroundColor: colors.bgSecondary, borderColor: colors.accent }, animatedStyle]}>
      <Ionicons name="terminal-outline" size={20} color={colors.accent} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    alignSelf: 'center',
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
