const listeners = {
  config: new Set<(value: string) => void>(),
  saved: new Set<(value: string) => void>(),
};

export const pluginEvents = {
  emit(type: keyof typeof listeners, value: string) {
    for (const listener of listeners[type]) listener(value);
  },
  addListener(type: keyof typeof listeners, listener: (value: string) => void) {
    listeners[type].add(listener);
    return { remove: () => { listeners[type].delete(listener); } };
  },
};
