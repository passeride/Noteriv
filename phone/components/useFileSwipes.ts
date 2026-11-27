import { Platform, useWindowDimensions } from 'react-native';
import { GestureStateManager, State, usePanGesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fileSwipeAction } from '@/lib/file-navigation';

export function useFileSwipes(enabled: boolean, files: () => void, commands: () => void, forward: () => void, edgesOnly = false) {
  const { width } = useWindowDimensions();
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  return usePanGesture({
    enabled: enabled && Platform.OS !== 'web',
    maxPointers: 1,
    manualActivation: true,
    onTouchesDown: event => {
      'worklet';
      const touch = event.allTouches[0];
      if (!touch || event.allTouches.length !== 1) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      startX.value = touch.absoluteX;
      startY.value = touch.absoluteY;
      const edge = Math.min(76, width * 0.24);
      if (edgesOnly && startX.value > edge && startX.value < width - edge) {
        GestureStateManager.fail(event.handlerTag);
      }
    },
    onTouchesMove: event => {
      'worklet';
      if (event.state === State.ACTIVE) return;
      const touch = event.allTouches[0];
      if (!touch) return;
      const dx = touch.absoluteX - startX.value;
      const dy = touch.absoluteY - startY.value;
      if (fileSwipeAction(startX.value, width, dx, dy, edgesOnly)) {
        GestureStateManager.activate(event.handlerTag);
      } else if ((Math.abs(dy) > 16 && Math.abs(dy) * 1.5 >= Math.abs(dx)) || Math.abs(dx) >= 64) {
        GestureStateManager.fail(event.handlerTag);
      }
    },
    onTouchesUp: event => {
      'worklet';
      // Release taps promptly so native buttons and inputs can recognize them.
      if (event.state !== State.ACTIVE) GestureStateManager.fail(event.handlerTag);
    },
    onDeactivate: event => {
      'worklet';
      if (event.canceled || event.numberOfPointers > 1) return;
      const action = fileSwipeAction(startX.value, width, event.absoluteX - startX.value, event.absoluteY - startY.value, edgesOnly);
      if (action === 'files') scheduleOnRN(files);
      if (action === 'commands') scheduleOnRN(commands);
      if (action === 'forward') scheduleOnRN(forward);
    },
  });
}
