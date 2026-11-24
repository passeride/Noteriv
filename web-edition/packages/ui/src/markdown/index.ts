// Initialize built-in renderers on import
import { registerBuiltinRenderers } from "./renderers";
registerBuiltinRenderers();

// Re-export everything consumers need
export { liveMarkdownPlugin, renderAllLines } from "./plugin";
export { mathExtension } from "./math";
export { markdownRenderTheme, mdHighlightStyle, editorTheme } from "./theme";
export { RenderedMarkdownWidget } from "./widget";
export {
  setLocalImageLoader,
  setPostProcessorRunner,
  type LocalImageLoader,
  type PostProcessorRunner,
} from "./vault-hooks";
export { setEditorViewForImages, setImageLightboxHandler } from "./renderers/images";
export {
  registerBlockRenderer,
  registerInlineRenderer,
  unregisterRenderer,
} from "./registry";
export type {
  BlockRenderer,
  BlockContext,
  InlineRenderer,
  InlineReplacement,
} from "./types";
