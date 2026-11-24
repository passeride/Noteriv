import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { FileView, ViewFactory, ViewState } from "@noteriv/plugin-api";

/**
 * A file view (`ui.registerFileView`) rendered with React: `render` gets the tab's current content and the setter
 * that writes back to the tab. Content changed elsewhere re-renders with the new value.
 */
export function reactFileView(
  id: string,
  match: FileView["match"],
  render: (props: { path: string; content: string; onChange: (content: string) => void }) => ReactNode
): FileView {
  return {
    id,
    match,
    mount(container, ctx) {
      const root = createRoot(container);
      let content = ctx.content;
      const onChange = (next: string) => {
        content = next;
        ctx.setContent(next);
      };
      const draw = () => root.render(render({ path: ctx.path, content, onChange }));
      draw();
      return {
        update(next) {
          content = next;
          draw();
        },
        // Unmount may be asked for while React is dispatching one of the view's own events: wait a tick.
        destroy: () => void setTimeout(() => root.unmount(), 0),
      };
    },
  };
}

/**
 * A plugin view rendered with React. Core plugins run inside the app and share its single React copy (react is a
 * peer dependency), so a view written as a component costs no extra bundle. The root is unmounted when the host
 * closes the view.
 */
export function reactView(render: (state: ViewState) => ReactNode): ViewFactory {
  return () => ({
    mount(container, state) {
      const root = createRoot(container);
      root.render(render(state));
      // Closing usually starts inside one of the view's own event handlers, while React is still dispatching it;
      // unmounting synchronously there is not allowed, so it waits for the next task.
      return () => void setTimeout(() => root.unmount(), 0);
    },
  });
}
