import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ChoiceAnnotation } from "../../content/schema";
import { useI18n } from "../i18n";
import { TextBlock } from "./TextBlocks";

export interface AnnotationPopoverProps {
  id: string;
  annotation: Readonly<ChoiceAnnotation>;
  anchorElement: HTMLElement;
  pinned: boolean;
  onDismiss(): void;
  onMouseEnter?(): void;
  onMouseLeave?(): void;
}

interface PopoverPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

const VIEWPORT_PADDING = 12;
const ANCHOR_GAP = 10;
const MAX_POPOVER_WIDTH = 352;

const samePosition = (current: PopoverPosition | null, next: PopoverPosition): boolean =>
  current !== null &&
  current.left === next.left &&
  current.top === next.top &&
  current.maxWidth === next.maxWidth &&
  current.maxHeight === next.maxHeight;

/** A viewport-positioned annotation surface anchored to the control that opened it. */
export function AnnotationPopover({
  id,
  annotation,
  anchorElement,
  pinned,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: AnnotationPopoverProps) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;

  useLayoutEffect(() => {
    if (pinned) {
      closeButtonRef.current?.focus({ preventScroll: true });
    }
  }, [pinned]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const ownerDocument = anchorElement.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;

    if (!popover || !ownerWindow) {
      return;
    }

    let animationFrame: number | null = null;

    const updatePosition = (): void => {
      animationFrame = null;

      if (!anchorElement.isConnected) {
        onDismiss();
        return;
      }

      const anchorRect = anchorElement.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const visualViewport = ownerWindow.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportWidth = visualViewport?.width ?? ownerWindow.innerWidth;
      const viewportHeight = visualViewport?.height ?? ownerWindow.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const maxWidth = Math.max(0, Math.min(MAX_POPOVER_WIDTH, viewportWidth - 24));
      const maxHeight = Math.max(0, viewportHeight - 24);
      const measuredWidth = Math.min(popoverRect.width, maxWidth);
      const measuredHeight = Math.min(popoverRect.height, maxHeight);
      const roomBelow = viewportBottom - anchorRect.bottom;
      const roomAbove = anchorRect.top - viewportTop;
      const preferredTop =
        roomBelow >= measuredHeight + ANCHOR_GAP || roomBelow >= roomAbove
          ? anchorRect.bottom + ANCHOR_GAP
          : anchorRect.top - measuredHeight - ANCHOR_GAP;
      const maximumLeft = Math.max(
        viewportLeft + VIEWPORT_PADDING,
        viewportRight - VIEWPORT_PADDING - measuredWidth,
      );
      const maximumTop = Math.max(
        viewportTop + VIEWPORT_PADDING,
        viewportBottom - VIEWPORT_PADDING - measuredHeight,
      );
      const nextPosition = {
        left: Math.min(Math.max(anchorRect.left, viewportLeft + VIEWPORT_PADDING), maximumLeft),
        top: Math.min(Math.max(preferredTop, viewportTop + VIEWPORT_PADDING), maximumTop),
        maxWidth,
        maxHeight,
      };

      setPosition((current) => (samePosition(current, nextPosition) ? current : nextPosition));
    };

    const schedulePosition = (): void => {
      if (animationFrame === null) {
        animationFrame = ownerWindow.requestAnimationFrame(updatePosition);
      }
    };

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;

      if (target instanceof Node && (popover.contains(target) || anchorElement.contains(target))) {
        return;
      }

      onDismiss();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      anchorElement.focus({ preventScroll: true });
      onDismiss();
    };

    const resizeObserver = new ownerWindow.ResizeObserver(schedulePosition);
    resizeObserver.observe(anchorElement);
    resizeObserver.observe(popover);
    resizeObserver.observe(ownerDocument.documentElement);

    const mutationObserver = new ownerWindow.MutationObserver((records) => {
      if (!anchorElement.isConnected) {
        onDismiss();
        return;
      }

      const externalLayoutChanged = records.some(
        (record) => record.target !== popover && !popover.contains(record.target),
      );

      if (externalLayoutChanged) {
        schedulePosition();
      }
    });
    mutationObserver.observe(ownerDocument.body, {
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
      characterData: true,
      childList: true,
      subtree: true,
    });

    schedulePosition();
    ownerWindow.addEventListener("resize", schedulePosition);
    ownerWindow.addEventListener("scroll", schedulePosition, true);
    ownerWindow.visualViewport?.addEventListener("resize", schedulePosition);
    ownerWindow.visualViewport?.addEventListener("scroll", schedulePosition);
    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    ownerDocument.addEventListener("keydown", handleKeyDown, true);

    return () => {
      // Floating UI owns global observers while mounted; removing every one here
      // prevents stale anchors and replaced choice nodes from retaining listeners.
      if (animationFrame !== null) {
        ownerWindow.cancelAnimationFrame(animationFrame);
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      ownerWindow.removeEventListener("resize", schedulePosition);
      ownerWindow.removeEventListener("scroll", schedulePosition, true);
      ownerWindow.visualViewport?.removeEventListener("resize", schedulePosition);
      ownerWindow.visualViewport?.removeEventListener("scroll", schedulePosition);
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
      ownerDocument.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [anchorElement, onDismiss]);

  const style: CSSProperties = position
    ? {
        left: position.left,
        top: position.top,
        maxWidth: position.maxWidth,
        maxHeight: position.maxHeight,
        visibility: "visible",
      }
    : { visibility: "hidden" };

  const restoreAnchorFocus = (): void => {
    if (anchorElement.isConnected) {
      anchorElement.focus({ preventScroll: true });
    }
    onDismiss();
  };

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      className={`annotation-popover${pinned ? " annotation-popover--pinned" : ""}`}
      role={pinned ? "dialog" : "tooltip"}
      aria-modal={pinned ? false : undefined}
      aria-labelledby={titleId}
      aria-describedby={pinned ? bodyId : undefined}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <header className="annotation-popover__header">
        <h3 id={titleId}>{annotation.title ?? t("annotation.fallbackTitle")}</h3>
        {pinned ? (
          <button
            ref={closeButtonRef}
            className="annotation-popover__close"
            type="button"
            aria-label={t("annotation.close")}
            onClick={restoreAnchorFocus}
          >
            ×
          </button>
        ) : null}
      </header>
      <div id={bodyId} className="annotation-popover__body">
        {annotation.body.map((block, index) => (
          <TextBlock key={`${block.type}-${index}`} block={block} />
        ))}
      </div>
    </div>,
    anchorElement.ownerDocument.body,
  );
}
