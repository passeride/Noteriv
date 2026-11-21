const { withMainActivity, withAppDelegate } = require('expo/config-plugins');

module.exports = function withMobilePluginShortcuts(config) {
  config = withMainActivity(config, mod => {
    const source = mod.modResults.contents;
    if (source.includes('override fun dispatchKeyEvent')) return mod;
    const end = source.lastIndexOf('}');
    if (end < 0 || mod.modResults.language !== 'kt') throw new Error('Expected a Kotlin MainActivity');
    mod.modResults.contents = source.slice(0, end) + `
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (expo.modules.noterivgit.NoterivPluginKeys.dispatch(event)) return true
    return super.dispatchKeyEvent(event)
  }
` + source.slice(end);
    return mod;
  });
  return withAppDelegate(config, mod => {
    const source = mod.modResults.contents;
    if (source.includes('class NoterivApplication')) return mod;
    const next = source.replace(/@main\s*\n(class AppDelegate:)/, '$1');
    if (next === source || mod.modResults.language !== 'swift') throw new Error('Expected a Swift Expo AppDelegate');
    mod.modResults.contents = `internal import UIKit
internal import NoterivGit

@main
enum NoterivEntryPoint {
  static func main() {
    UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv,
      NSStringFromClass(NoterivApplication.self), NSStringFromClass(AppDelegate.self))
  }
}

final class NoterivApplication: UIApplication {
  override func sendEvent(_ event: UIEvent) {
    if let presses = event as? UIPressesEvent, NoterivPluginKeys.dispatch(presses) { return }
    super.sendEvent(event)
  }
}

` + next;
    return mod;
  });
};
