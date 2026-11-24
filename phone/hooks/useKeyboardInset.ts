import { useEffect, useState } from 'react';
import { EmitterSubscription, Keyboard, KeyboardEvent, Platform } from 'react-native';

interface KeyboardInsetState {
  height: number;
  visible: boolean;
}

function getKeyboardHeight(event?: KeyboardEvent | null): number {
  return event?.endCoordinates?.height ?? 0;
}

export function useKeyboardInset(): KeyboardInsetState {
  const [state, setState] = useState<KeyboardInsetState>({
    height: 0,
    visible: false,
  });

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const subscriptions: EmitterSubscription[] = [
      Keyboard.addListener(showEvent, (event) => {
        setState({
          height: getKeyboardHeight(event),
          visible: true,
        });
      }),
      Keyboard.addListener(hideEvent, () => {
        setState({
          height: 0,
          visible: false,
        });
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  return state;
}
