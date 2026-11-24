/**
 * Minimal ambient shim so files ported verbatim from desktop/src (which guard
 * every access with `window.electronAPI?.foo`) type-check without pulling in
 * desktop's full `ElectronAPI` interface. Always undefined in the web app —
 * every such guard takes its "not available" branch at runtime.
 */
export {};

declare global {
  interface Window {
    electronAPI?: {
      readBinaryFile?: (path: string) => Promise<string | null>;
    };
  }
}
