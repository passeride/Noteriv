import { requireNativeModule } from 'expo-modules-core';
export default requireNativeModule<{ execute(request: string): Promise<string> }>('NoterivGit');
