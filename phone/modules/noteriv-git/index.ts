import { type EventSubscription, requireNativeModule } from 'expo-modules-core';
export default requireNativeModule<{
  execute(request: string): Promise<string>;
  setPluginShortcuts(bindings: string[]): void | Promise<void>;
  addListener(event: 'onPluginShortcut', listener: (event: { binding: string }) => void): EventSubscription;
}>('NoterivGit');
