import type { ImageQueryProps } from "./image-query";
import type { CategoryEdit } from "./categories";
import { ImageViewer } from "./image-viewer";
import { MemoryDetail, type Edits } from "./memory-detail";
import { PasteBox } from "./paste-box";
import type { PdfMatch } from "./pdf-match";
import { PdfViewer } from "./pdf-viewer";
import { SearchCommand } from "./search-command";
import type { Memory, WallMemory } from "./use-library";
import type { Results } from "./use-search";

export type LibraryOverlaysProps = {
  onCategories?: CategoryEdit;
  searchOpen: boolean;
  imageQuery: ImageQueryProps;
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
  onFiles: (files: File[]) => void;
  images: WallMemory[];
  imageId: string | undefined;
  onImageId: (id: string) => void;
  onImageClose: () => void;
  pdf: WallMemory | undefined;
  pdfMatch: PdfMatch;
  onPdfClose: () => void;
  opened: Memory | undefined;
  videoSeconds?: number;
  edits: Edits;
  onDetailClose: () => void;
  onDelete: (memory: Memory) => void;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onRetryIndexing: (memory: WallMemory) => void;
  onRetryDeepFetch: (memory: WallMemory) => void;
  onAiOptOut: (memory: Memory, on: boolean) => void;
  onMoreLikeThis: (memory: Memory) => void;
  onSearchByImage: (memory: Memory) => void;
};

/**
 * ⌘K, Capture, the image viewer and Memory detail: one chunk so cmdk,
 * motion and the dialogs stay out of the first paint. LibraryPage preloads
 * it so ⌘K still opens on the next frame.
 */
export function LibraryOverlays({
  searchOpen,
  imageQuery,
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
  onFiles,
  images,
  imageId,
  onImageId,
  onImageClose,
  pdf,
  pdfMatch,
  onPdfClose,
  opened,
  videoSeconds,
  edits,
  onDetailClose,
  onDelete,
  onRetry,
  onBroken,
  onRetryIndexing,
  onRetryDeepFetch,
  onAiOptOut,
  onCategories,
  onMoreLikeThis,
  onSearchByImage,
}: LibraryOverlaysProps) {
  return (
    <>
      <SearchCommand
        open={searchOpen}
        imageQuery={imageQuery}
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
        onFiles={onFiles}
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
        onCategories={onCategories}
        onAiOptOut={onAiOptOut}
        onMoreLikeThis={onMoreLikeThis}
        onSearchByImage={onSearchByImage}
      />
      <PdfViewer
        memory={pdf}
        match={pdfMatch}
        onClose={onPdfClose}
        onDelete={onDelete}
        onRetry={onRetry}
        onRetryIndexing={onRetryIndexing}
        onCategories={onCategories}
        onAiOptOut={onAiOptOut}
        onMoreLikeThis={onMoreLikeThis}
      />
      <MemoryDetail
        memory={opened}
        seconds={videoSeconds}
        edits={edits}
        onClose={onDetailClose}
        onDelete={onDelete}
        onRetryIndexing={onRetryIndexing}
        onRetryDeepFetch={onRetryDeepFetch}
        onCategories={onCategories}
        onAiOptOut={onAiOptOut}
        onMoreLikeThis={onMoreLikeThis}
        onSearchByImage={onSearchByImage}
      />
    </>
  );
}
