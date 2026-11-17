import { useEffect, useState } from "react";
import { rootFontScale } from "./root-font-scale";

/** Below this width the wall is two lanes of small tiles (Tailwind `sm`). */
const PHONE = "(max-width: 639.98px)";

/** True below 640px. */
export function usePhoneWall(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/**
 * The wall's lanes. Desktop: 220px at least, 12px gaps. A phone: two lanes
 * (144px at least, 8px gaps; 390px gives two of 179px, 320px two of 144px),
 * and one lane once the browser's text is past 150%, since the tile's text
 * grows with it.
 */
export function wallColumns(phone: boolean) {
  const k = rootFontScale();
  return phone
    ? { minWidth: 144 * (k > 1.5 ? k : 1), gap: 8, max: 2 }
    : { minWidth: 220, gap: 12, max: 6 };
}
