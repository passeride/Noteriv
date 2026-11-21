package expo.modules.noterivgit

import android.view.KeyEvent
import java.util.Locale

object NoterivPluginKeys {
  @Volatile var bindings: Set<String> = emptySet()
  @Volatile var listener: ((String) -> Unit)? = null
  private val pressed = mutableSetOf<Int>()

  fun dispatch(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_UP) return pressed.remove(event.keyCode)
    if (event.action != KeyEvent.ACTION_DOWN) return false
    if (event.keyCode in pressed) return true
    val send = listener ?: return false
    if (bindings.isEmpty()) return false
    val key = when (event.keyCode) {
      KeyEvent.KEYCODE_SPACE -> "space"
      KeyEvent.KEYCODE_ESCAPE -> "escape"
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "enter"
      KeyEvent.KEYCODE_TAB -> "tab"
      KeyEvent.KEYCODE_DEL -> "backspace"
      KeyEvent.KEYCODE_FORWARD_DEL -> "delete"
      KeyEvent.KEYCODE_DPAD_LEFT -> "arrowleft"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "arrowright"
      KeyEvent.KEYCODE_DPAD_UP -> "arrowup"
      KeyEvent.KEYCODE_DPAD_DOWN -> "arrowdown"
      else -> {
        val character = event.getUnicodeChar(0)
        if (character == 0) return false
        String(Character.toChars(character)).lowercase(Locale.ROOT)
      }
    }
    val binding = buildList {
      if (event.isCtrlPressed) add("ctrl")
      if (event.isAltPressed) add("alt")
      if (event.isShiftPressed) add("shift")
      if (event.isMetaPressed) add("meta")
      add(key)
    }.joinToString("+")
    if (binding !in bindings) return false
    pressed.add(event.keyCode)
    send(binding)
    return true
  }
}
