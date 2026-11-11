import { ImageViewer } from "./image-viewer";
import { MemoryDetail, type Edits } from "./memory-detail";
import { PasteBox } from "./paste-box";
import { SearchCommand } from "./search-command";
import type { Memory, WallMemory } from "./use-library";
import type { Results } from "./use-search";

/**
 * ⌘K, Capture, the image viewer and Memory detail: one chunk so cmdk,
 * motion and the dialogs stay out of the first paint. LibraryPage preloads
 * it so ⌘K still opens on the next frame.
 */
export function LibraryOverlays({
  searchOpen,
  draft,
  instant,
  onSearchOpenChange,
  onDraft,
  onShowOnWall,
  onOpenFromSearch,
  onCapture,
  onSettings,
  onSignOut,
  pasteOpen,
  onPasteOpenChange,
  onPasteCapture,
  onImages,
  images,
  imageId,
  onImageId,
  onImageClose,
  opened,
  edits,
  onDetailClose,
  onDelete,
  onRetry,
  onBroken,
  onRetryIndexing,
  onAiOptOut,
  onMoreLikeThis,
}: {
  searchOpen: boolean;
  draft: string;
  instant: Results | "failed" | undefined;
  onSearchOpenChange: (open: boolean) => void;
  onDraft: (value: string) => void;
  onShowOnWall: (query: string) => void;
  onOpenFromSearch: (memory: Memory) => void;
  onCapture: () => void;
  onSettings: () => void;
  onSignOut: () => void;
  pasteOpen: boolean;
  onPasteOpenChange: (open: boolean) => void;
  onPasteCapture: (text: string, captureNote: string) => boolean;
  onImages: (files: File[]) => void;
  images: WallMemory[];
  imageId: string | undefined;
  onImageId: (id: string) => void;
  onImageClose: () => void;
  opened: Memory | undefined;
  edits: Edits;
  onDetailClose: () => void;
  onDelete: (memory: Memory) => void;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onRetryIndexing: (memory: WallMemory) => void;
  onAiOptOut: (memory: Memory, on: boolean) => void;
  onMoreLikeThis: (memory: Memory) => void;
}) {
  return (
    <>
      <SearchCommand
        open={searchOpen}
        draft={draft}
        instant={instant}
        onOpenChange={onSearchOpenChange}
        onDraft={onDraft}
        onShowOnWall={onShowOnWall}
        onOpen={onOpenFromSearch}
        onCapture={onCapture}
        onSettings={onSettings}
        onSignOut={onSignOut}
      />
      <PasteBox
        open={pasteOpen}
        onOpenChange={onPasteOpenChange}
        onCapture={onPasteCapture}
        onImages={onImages}
      />
      <ImageViewer
        memories={images}
        openId={imageId}
        onOpen={onImageId}
        onClose={onImageClose}
        onDelete={onDelete}
        onRetry={onRetry}
        onBroken={onBroken}
        onRetryIndexing={onRetryIndexing}
        onAiOptOut={onAiOptOut}
        onMoreLikeThis={onMoreLikeThis}
      />
      <MemoryDetail
        memory={opened}
        edits={edits}
        onClose={onDetailClose}
        onDelete={onDelete}
        onRetryIndexing={onRetryIndexing}
        onAiOptOut={onAiOptOut}
        onMoreLikeThis={onMoreLikeThis}
      />
    </>
  );
}
