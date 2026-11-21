const { withMainActivity } = require('expo/config-plugins');

const CALL = 'installImeInsets()';

// Android 11+ reports IME occlusion as a window inset. With edge-to-edge the
// Activity content may still fill the window even with adjustResize enabled.
const IMPLEMENTATION = `  private fun installImeInsets() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return

    val content = findViewById<android.view.View>(android.R.id.content)
    val initialBottomPadding = content.paddingBottom
    val location = IntArray(2)
    var imeBottom = 0

    fun updatePadding() {
      if (!content.isLaidOut) return
      content.getLocationInWindow(location)
      val contentBottom = location[1] + content.height
      val windowHeight = windowManager.currentWindowMetrics.bounds.height()
      // If adjustResize already shrunk the content, only apply the remaining
      // overlap. Safe-area views still own system-bar insets below the keyboard.
      val overlap = if (imeBottom > 0) {
        (contentBottom - (windowHeight - imeBottom)).coerceAtLeast(0)
      } else 0
      val bottom = initialBottomPadding + overlap
      if (bottom != content.paddingBottom) {
        content.setPadding(content.paddingLeft, content.paddingTop, content.paddingRight, bottom)
      }
    }

    content.setOnApplyWindowInsetsListener { view, insets ->
      imeBottom = (view.rootWindowInsets ?: insets).getInsets(android.view.WindowInsets.Type.ime()).bottom
      updatePadding()
      // Keep dispatch intact for React Native and react-native-safe-area-context.
      view.onApplyWindowInsets(insets)
    }
    content.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updatePadding() }
    content.requestApplyInsets()
  }

`;

module.exports = function withAndroidImeInsets(config) {
  return withMainActivity(config, activity => {
    const source = activity.modResults.contents;
    if (source.includes(`private fun ${CALL}`)) return activity;
    const onCreate = /^( +)super\.onCreate\(null\);?$/m;
    const end = source.lastIndexOf('}');
    if (activity.modResults.language !== 'kt' || !onCreate.test(source) || end === -1) {
      throw new Error('Could not install IME insets in the generated Android MainActivity.');
    }
    const updated = source.slice(0, end) + IMPLEMENTATION + source.slice(end);
    activity.modResults.contents = updated.replace(onCreate, (line, indent) => `${line}\n${indent}${CALL}`);
    return activity;
  });
};
