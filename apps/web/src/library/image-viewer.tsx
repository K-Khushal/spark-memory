import { SearchByImage } from "./image-query";
import { CategoryEditor, type CategoryEdit } from "./categories";
import { restoreLibraryFocus } from "./focus";
import { useState, type KeyboardEvent } from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type PanInfo,
} from "motion/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { placeholderUrl } from "@spark/capture";
import { Button, Dialog, DialogContent, DialogTitle, cn } from "@spark/ui";
import { DURATION, EASING, SPRING } from "@spark/ui/tokens";
import { IndexBadge, type IndexingProps } from "./index-state";
import { MoreLikeThis } from "./why";
import { memoryName, UploadBadge } from "./memory-tile";
import {
  VIEWER_ARROW,
  VIEWER_CLOSE,
  ViewerBar,
  ViewerMore,
} from "./r1-c-viewer-bar";
import type { Memory, WallMemory } from "./use-library";

/** A swipe moves on past 120px, or when flung. */
const SWIPE = { offset: 120, velocity: 500 };
/** Narrower than this (long screenshots), an image fills the width and scrolls. */
const TALL = 0.4;

/**
 * The image viewer: one image Memory large, the ones beside it a key
 * (← →), a button or a swipe away. Escape closes. Each image enters from
 * the side it came from on a spring, so a swipe can be caught and reversed
 * mid-flight; with reduced motion, images only fade. Always dark (the
 * dark theme's tokens), so the image, not the theme, sets the tone.
 */
export function ImageViewer({
  memories,
  openId,
  onOpen,
  onClose,
  onDelete,
  onRetry,
  onBroken,
  onRetryIndexing,
  onAiOptOut,
  onCategories,
  onMoreLikeThis,
  onSearchByImage,
}: {
  /** The image Memories in wall order. */
  memories: WallMemory[];
  openId: string | undefined;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDelete: (memory: WallMemory) => void;
  onRetry: (id: string) => void;
  onBroken: (id: string) => void;
  onMoreLikeThis: (memory: WallMemory) => void;
  onSearchByImage?: (memory: Memory) => void;
} & IndexingProps & { onCategories?: CategoryEdit }) {
  const index = memories.findIndex((m) => m.id === openId);
  const memory = memories[index];
  const [direction, setDirection] = useState(0);

  const go = (step: -1 | 1) => {
    const next = memories[index + step];
    if (!next) return;
    if (
      document.activeElement instanceof HTMLButtonElement &&
      /^(Next|Previous) Image$/.test(
        document.activeElement.getAttribute("aria-label") ?? ""
      )
    )
      document.activeElement.closest<HTMLElement>('[role="dialog"]')?.focus();
    setDirection(step);
    onOpen(next.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[role="menu"], details')
    )
      return;
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
  };

  const onDragEnd = (_: unknown, { offset, velocity }: PanInfo) => {
    if (offset.x < -SWIPE.offset || velocity.x < -SWIPE.velocity) go(1);
    else if (offset.x > SWIPE.offset || velocity.x > SWIPE.velocity) go(-1);
  };

  const remove = (memory: WallMemory) => {
    const step = memories[index + 1] ? 1 : -1;
    const next = memories[index + step];
    onDelete(memory);
    if (!next) return onClose();
    setDirection(step);
    onOpen(next.id);
  };

  const tall =
    !!memory?.image && memory.image.width / memory.image.height < TALL;
  // A stranded upload has no file to show. The ThumbHash stands in; an
  // image would 404 and refresh the Library once a minute.
  const stranded = memory?.upload?.step === "stranded";

  return (
    <MotionConfig reducedMotion="user">
      <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
        {memory?.image && (
          <DialogContent
            // Focus goes back to the image last shown, not the one opened.
            onCloseAutoFocus={(event) => restoreLibraryFocus(event, memory.id)}
            data-theme="dark"
            aria-describedby={undefined}
            onKeyDown={onKeyDown}
            // Focus the viewer itself, never Delete: the key that opened it
            // must not press anything.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.focus();
            }}
            presentation="fullscreen"
            className="flex h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            closeClassName={VIEWER_CLOSE}
          >
            <DialogTitle className="sr-only">{memoryName(memory)}</DialogTitle>
            <ViewerBar
              memory={memory}
              start={
                memory.upload ? (
                  <UploadBadge
                    upload={memory.upload}
                    onRetry={() => onRetry(memory.id)}
                    onDelete={() => remove(memory)}
                    className="h-11"
                  />
                ) : (
                  <IndexBadge
                    memory={memory}
                    onRetry={() => onRetryIndexing(memory)}
                    // No Memory detail for images: the viewer says why.
                    withReason
                    className="max-w-full"
                  />
                )
              }
            >
              {!stranded && (
                <>
                  <MoreLikeThis
                    memory={memory}
                    onSelect={onMoreLikeThis}
                    compact
                  />
                  <SearchByImage
                    memory={memory}
                    onSelect={onSearchByImage}
                    compact
                  />
                  <CategoryEditor
                    compact
                    key={memory.id}
                    memory={memory}
                    onSave={onCategories}
                  />
                  <ViewerMore
                    memory={memory}
                    onAiOptOut={onAiOptOut}
                    onDelete={() => remove(memory)}
                  />
                </>
              )}
            </ViewerBar>
            {/* The stage is what is left under the bar: the image is sized to it. */}
            <div className="relative min-h-0 flex-1 [--gutter-y:6rem] [container-type:size] md:[--gutter-y:2.5rem]">
              <AnimatePresence
                initial={false}
                custom={direction}
                mode="popLayout"
              >
                <motion.div
                  key={memory.id}
                  custom={direction}
                  variants={slide}
                  initial="enter"
                  animate="centre"
                  exit="leave"
                  drag="x"
                  dragDirectionLock
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={edgeElastic(index, memories.length)}
                  dragSnapToOrigin
                  onDragEnd={onDragEnd}
                  className={cn(
                    "absolute inset-0 grid touch-pan-y justify-items-center px-4 pt-4 pb-20 md:px-16 md:pb-6",
                    tall ? "items-start overflow-y-auto" : "items-center"
                  )}
                >
                  <Picture
                    memory={memory}
                    tall={tall}
                    stranded={stranded}
                    onBroken={onBroken}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
            <Step side="left" disabled={index <= 0} onClick={() => go(-1)} />
            <Step
              side="right"
              disabled={index >= memories.length - 1}
              onClick={() => go(1)}
            />
          </DialogContent>
        )}
      </Dialog>
    </MotionConfig>
  );
}

const fade = { duration: DURATION.small / 1000, ease: EASING.out };
const slide = {
  enter: (direction: number) => ({ x: `${direction * 30}%`, opacity: 0 }),
  centre: { x: 0, opacity: 1, transition: { x: SPRING.settle, opacity: fade } },
  leave: (direction: number) => ({
    x: `${direction * -30}%`,
    opacity: 0,
    transition: { x: SPRING.settle, opacity: fade },
  }),
};

/**
 * The image follows the finger 1:1 when there is an image to go to, and
 * rubber-bands hard past the first and last: there is nothing there.
 */
function edgeElastic(index: number, count: number) {
  return {
    left: index >= count - 1 ? 0.15 : 1,
    right: index <= 0 ? 0.15 : 1,
  };
}

/** The image at the largest size that fits, its thumbnail standing in while the original loads. */
function Picture({
  memory,
  tall,
  stranded,
  onBroken,
}: {
  memory: WallMemory;
  tall: boolean;
  /** No stored file: the ThumbHash only, so nothing 404s and refetches. */
  stranded: boolean;
  onBroken: (id: string) => void;
}) {
  const image = memory.image!;
  const [loaded, setLoaded] = useState(false);
  const placeholder = placeholderUrl(image.thumbhash);
  const aspect = image.width / image.height;
  return (
    <div
      className={cn(
        "relative max-w-full shrink-0 overflow-hidden rounded-tile bg-cover bg-center select-none",
        !tall && "max-h-full"
      )}
      style={{
        aspectRatio: `${image.width} / ${image.height}`,
        width: tall
          ? `min(100%, ${image.width}px, 45rem)`
          : `min(100%, ${image.width}px, calc((100cqh - var(--gutter-y)) * ${aspect}))`,
        backgroundImage: placeholder ? `url(${placeholder})` : undefined,
      }}
    >
      {!stranded && (
        <>
          <img
            src={image.thumbnailUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
          />
          <img
            src={image.url}
            alt={memoryName(memory)}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => onBroken(memory.id)}
            className="absolute inset-0 h-full w-full object-contain transition-opacity duration-(--duration-small) ease-out"
            style={{ opacity: loaded ? 1 : 0 }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Previous or Next, hidden at the boundary and on touch where swipes page.
 */
function Step({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  if (disabled) return null;
  return (
    <Button
      variant="quiet"
      size="icon"
      onClick={disabled ? undefined : onClick}
      aria-label={side === "left" ? "Previous Image" : "Next Image"}
      className={cn(VIEWER_ARROW, side === "left" ? "left-4" : "right-4")}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}
