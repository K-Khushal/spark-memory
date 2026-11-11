import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { LibraryOverlaysProps } from "./overlays";

export const loadOverlays = () =>
  import("./overlays").then((m) => ({ default: m.LibraryOverlays }));

/**
 * A rejected overlays chunk (stale hash, offline) must not take the Library
 * down. Render nothing; LibraryPage remounts this on the next ⌘K or Capture.
 */
class OverlaysErrorBoundary extends Component<
  { children: ReactNode; onCatch: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onCatch();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function LibraryOverlaysHost({
  onCatch,
  ...props
}: LibraryOverlaysProps & { onCatch: () => void }) {
  const [Overlays] = useState(() => lazy(loadOverlays));

  useEffect(() => {
    void loadOverlays().catch(() => {});
  }, []);

  return (
    <OverlaysErrorBoundary onCatch={onCatch}>
      <Suspense fallback={null}>
        <Overlays {...props} />
      </Suspense>
    </OverlaysErrorBoundary>
  );
}
