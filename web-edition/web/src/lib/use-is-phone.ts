import { useEffect, useState } from "react";

/** Same width as the phone rules in app.css (`@media (max-width: 600px)`). */
export const PHONE_QUERY = "(max-width: 600px)";

/** True while the window is phone-width; follows rotation and resizing. False during server rendering. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    setPhone(query.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}
