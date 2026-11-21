import UIKit

public enum NoterivPluginKeys {
  static var bindings = Set<String>()
  static var listener: ((String) -> Void)?
  private static var pressed = Set<Int>()

  public static func dispatch(_ event: UIPressesEvent) -> Bool {
    guard event.allPresses.count == 1, let press = event.allPresses.first,
      let key = press.key else { return false }
    let code = key.keyCode.rawValue
    if press.phase == .ended || press.phase == .cancelled {
      return pressed.remove(code) != nil
    }
    guard press.phase == .began, let listener, !bindings.isEmpty else { return false }
    let special = [
      40: "enter", 41: "escape", 42: "backspace", 43: "tab", 44: "space",
      76: "delete", 79: "arrowright", 80: "arrowleft", 81: "arrowdown", 82: "arrowup",
    ]
    let name = special[code] ?? key.charactersIgnoringModifiers.lowercased()
    guard !name.isEmpty else { return false }
    var parts: [String] = []
    let modifiers = key.modifierFlags
    if modifiers.contains(.control) { parts.append("ctrl") }
    if modifiers.contains(.alternate) { parts.append("alt") }
    if modifiers.contains(.shift) { parts.append("shift") }
    if modifiers.contains(.command) { parts.append("meta") }
    parts.append(name)
    let binding = parts.joined(separator: "+")
    guard bindings.contains(binding) else { return false }
    if pressed.insert(code).inserted { listener(binding) }
    return true
  }
}
