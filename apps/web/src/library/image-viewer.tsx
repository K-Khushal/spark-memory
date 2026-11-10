import { useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Trash2Icon,
} from "lucide-react";
import { placeholderUrl } from "@spark/capture";
import { Button, Dialog, DialogContent, DialogTitle } from "@spark/ui";
import { DURATION, EASING, SPRING } from "@spark/ui/tokens";
import { memoryName, UploadBadge } from "./memory-tile";
import type { WallMemory } from "./use-library";

/** A swipe moves on past a third of the way, or when flung. */
const SWIPE = { offset: 120, velocity: 500 };

/**
 * The image viewer: one image Memory large, the ones beside it a key
 * (← →) or a swipe away. Escape closes. Each image enters from the side it
 * came from and leaves the other way, on a spring, so a swipe can be caught
 * and reversed mid-flight. With reduced motion, images only fade.
 */
export function ImageViewer({
  memories,
  openId,
  onOpen,
  onClose,
  onDelete,
  onRetry,
}: {
  /** The image Memories in wall order. */
  memories: WallMemory[];
  openId: string | undefined;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDelete: (memory: WallMemory) => void;
  onRetry: (id: string) => void;
}) {
  const index = memories.findIndex((m) => m.id === openId);
  const memory = memories[index];
  const [direction, setDirection] = useState(0);

  const go = (step: -1 | 1) => {
    const next = memories[index + step];
    if (!next) return;
    setDirection(step);
    onOpen(next.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
  };

  const onDragEnd = (_: unknown, { offset, velocity }: PanInfo) => {
    if (offset.x < -SWIPE.offset || velocity.x < -SWIPE.velocity) go(1);
    else if (offset.x > SWIPE.offset || velocity.x > SWIPE.velocity) go(-1);
  };

  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory?.image && (
        <DialogContent
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          // A dark room in both themes: the image, not the theme, sets the tone.
          className="flex h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none bg-[#111214]/95 shadow-none"
          closeClassName="z-10 size-11 bg-transparent text-[#fff]/80 hover:bg-[#fff]/10 hover:text-[#fff]"
        >
          <DialogTitle className="sr-only">{memoryName(memory)}</DialogTitle>
          <div className="relative min-h-0 flex-1">
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
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={edgeElastic(index, memories.length)}
                dragSnapToOrigin
                onDragEnd={onDragEnd}
                className="absolute inset-0 grid touch-pan-y place-items-center px-4 pt-14 pb-2 md:px-16"
              >
                <Picture memory={memory} />
              </motion.div>
            </AnimatePresence>
            <Step side="left" disabled={index <= 0} onClick={() => go(-1)} />
            <Step
              side="right"
              disabled={index >= memories.length - 1}
              onClick={() => go(1)}
            />
          </div>
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
            {memory.upload ? (
              <UploadBadge
                upload={memory.upload}
                onRetry={() => onRetry(memory.id)}
              />
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-chip bg-[#111214]/80 px-2 text-xs font-medium text-[#fff]">
                <CheckIcon className="size-3.5" aria-hidden /> Preserved
              </span>
            )}
            <Button
              variant="quiet"
              size="sm"
              className="text-[#fff] hover:bg-[#fff]/10 hover:text-[#fff]"
              onClick={() => {
                const next = memories[index + 1] ?? memories[index - 1];
                onDelete(memory);
                if (next) onOpen(next.id);
                else onClose();
              }}
            >
              <Trash2Icon aria-hidden /> Delete
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

const slide = {
  enter: (direction: number) => ({ x: `${direction * 30}%`, opacity: 0 }),
  centre: {
    x: 0,
    opacity: 1,
    transition: { x: SPRING.settle, opacity: fade() },
  },
  leave: (direction: number) => ({
    x: `${direction * -30}%`,
    opacity: 0,
    transition: { x: SPRING.settle, opacity: fade() },
  }),
};

function fade() {
  return { duration: DURATION.small / 1000, ease: EASING.out };
}

/** Rubber-band harder past the first and last image: there is nothing there. */
function edgeElastic(index: number, count: number) {
  return {
    left: index >= count - 1 ? 0.15 : 0.6,
    right: index <= 0 ? 0.15 : 0.6,
  };
}

/** The image at the largest size that fits, the thumbnail standing in while the original loads. */
function Picture({ memory }: { memory: WallMemory }) {
  const image = memory.image!;
  const [loaded, setLoaded] = useState(false);
  const placeholder = placeholderUrl(image.thumbhash);
  const aspect = image.width / image.height;
  return (
    <div
      className="relative max-h-full max-w-full overflow-hidden rounded-tile bg-cover bg-center select-none"
      style={{
        aspectRatio: `${image.width} / ${image.height}`,
        width: `min(100%, ${image.width}px, calc((100dvh - 8.5rem) * ${aspect}))`,
        backgroundImage: placeholder ? `url(${placeholder})` : undefined,
      }}
    >
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
        className="absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ease-out"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </div>
  );
}

function Step({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  if (disabled) return null;
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous Image" : "Next Image"}
      className={`absolute top-1/2 ${side === "left" ? "left-2" : "right-2"} hidden size-11 -translate-y-1/2 place-items-center rounded-control text-[#fff]/80 transition-[color,background-color,transform] duration-[120ms] ease-out hover:bg-[#fff]/10 hover:text-[#fff] active:scale-[0.97] md:grid`}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
