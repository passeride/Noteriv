export function pluginShortcut(keys: string, platform: string): string | undefined {
  const parts = keys.toLowerCase().split('+').map(part => part.trim());
  const key = parts.pop();
  if (!key) return;
  const names: Record<string, string> = {
    control: 'ctrl', cmd: 'meta', command: 'meta', option: 'alt', mod: platform === 'ios' ? 'meta' : 'ctrl',
  };
  const modifiers = parts.map(part => names[part] ?? part);
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  if (modifiers.some(part => !order.includes(part))) return;
  const aliases: Record<string, string> = {
    esc: 'escape', return: 'enter', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown',
    del: 'delete', backspace: 'backspace',
  };
  return [...order.filter(part => modifiers.includes(part)), aliases[key] ?? key].join('+');
}
