import type { ImageLoadEventData } from 'expo-image';
import type { LayoutChangeEvent } from 'react-native';
import { GestureStateManager, usePanGesture, usePinchGesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

const FIT = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 5;

export function useImageZoom(enabled: boolean) {
  const viewport = useSharedValue({ width: 0, height: 0 });
  const image = useSharedValue({ width: 0, height: 0 });
  const zoom = useSharedValue(FIT);
  const pinchStart = useSharedValue({ ...FIT, focalX: 0, focalY: 0 });
  const panStart = useSharedValue({ x: 0, y: 0 });
  const pinching = useSharedValue(false);

  function move(scale: number, x: number, y: number) {
    'worklet';
    const { width, height } = viewport.value;
    const source = image.value;
    const fit = Math.min(width / source.width, height / source.height);
    const maxX = Math.max(0, (source.width * fit * scale - width) / 2);
    const maxY = Math.max(0, (source.height * fit * scale - height) / 2);
    zoom.value = {
      scale,
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  const pinch = usePinchGesture({
    enabled,
    onActivate: ({ focalX, focalY }) => {
      'worklet';
      pinching.value = true;
      pinchStart.value = { ...zoom.value, focalX, focalY };
    },
    onUpdate: event => {
      'worklet';
      if (event.numberOfPointers < 2 || !image.value.width || !image.value.height) return;
      const start = pinchStart.value;
      const scale = Math.max(1, Math.min(MAX_SCALE, start.scale * event.scale));
      const ratio = scale / start.scale;
      const centerX = viewport.value.width / 2;
      const centerY = viewport.value.height / 2;
      move(scale,
        event.focalX - centerX - (start.focalX - centerX - start.x) * ratio,
        event.focalY - centerY - (start.focalY - centerY - start.y) * ratio);
    },
    onFinalize: () => {
      'worklet';
      pinching.value = false;
    },
  });

  const pan = usePanGesture({
    enabled,
    maxPointers: 1,
    minDistance: 4,
    onTouchesDown: event => {
      'worklet';
      if (zoom.value.scale <= 1 || pinching.value || event.allTouches.length !== 1) {
        GestureStateManager.fail(event.handlerTag);
      }
    },
    onActivate: event => {
      'worklet';
      panStart.value = { x: zoom.value.x - event.translationX, y: zoom.value.y - event.translationY };
    },
    onUpdate: event => {
      'worklet';
      if (pinching.value || event.numberOfPointers !== 1) return;
      move(zoom.value.scale, panStart.value.x + event.translationX, panStart.value.y + event.translationY);
    },
  });

  const style = useAnimatedStyle(() => {
    const { x, y, scale } = zoom.value;
    return { transform: [{ translateX: x }, { translateY: y }, { scale }] };
  });

  return {
    pinch,
    pan,
    style,
    onLayout: ({ nativeEvent: { layout: { width, height } } }: LayoutChangeEvent) => {
      viewport.set({ width, height });
      zoom.set(FIT);
    },
    onLoad: ({ source: { width, height } }: ImageLoadEventData) => {
      image.set({ width, height });
    },
  };
}
