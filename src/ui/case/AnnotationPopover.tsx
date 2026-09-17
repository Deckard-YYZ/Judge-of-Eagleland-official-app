import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ChoiceAnnotation } from "../../content/schema";
import { useI18n } from "../i18n";
import { TextBlock } from "./TextBlocks";

export interface AnnotationPopoverProps {
  id: string;
  annotation: Readonly<ChoiceAnnotation>;
  anchorElement: HTMLElement;
  onDismiss(): void;
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
  onDismiss,
}: AnnotationPopoverProps) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;

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
      const groupRect =
        anchorElement.closest(".decision-panel__choices")?.getBoundingClientRect() ?? anchorRect;
      const maxWidth = Math.max(
        0,
        Math.min(MAX_POPOVER_WIDTH, viewportWidth - 2 * VIEWPORT_PADDING),
      );
      const viewportMaxHeight = Math.max(0, viewportHeight - 2 * VIEWPORT_PADDING);
      const measuredWidth = Math.min(popoverRect.width, maxWidth);
      const naturalHeight = Math.min(popover.scrollHeight + 4, viewportMaxHeight);
      const roomAbove = Math.max(0, groupRect.top - viewportTop - VIEWPORT_PADDING - ANCHOR_GAP);
      const roomBelow = Math.max(
        0,
        viewportBottom - groupRect.bottom - VIEWPORT_PADDING - ANCHOR_GAP,
      );
      const roomRight = viewportRight - groupRect.right - VIEWPORT_PADDING - ANCHOR_GAP;
      const roomLeft = groupRect.left - viewportLeft - VIEWPORT_PADDING - ANCHOR_GAP;
      // Prefer outside the entire option group, so moving between rows never
      // travels through a floating note. A narrow viewport uses the larger gap.
      const side =
        roomAbove >= naturalHeight
          ? "above"
          : roomRight >= measuredWidth
            ? "right"
            : roomLeft >= measuredWidth
              ? "left"
              : roomBelow >= naturalHeight
                ? "below"
                : roomAbove >= roomBelow
                  ? "above"
                  : "below";
      const availableHeight =
        side === "above" ? roomAbove : side === "below" ? roomBelow : viewportMaxHeight;
      const maxHeight = Math.min(viewportMaxHeight, Math.max(64, availableHeight));
      const measuredHeight = Math.min(naturalHeight, maxHeight);
      const preferredTop =
        side === "above"
          ? groupRect.top - measuredHeight - ANCHOR_GAP
          : side === "below"
            ? groupRect.bottom + ANCHOR_GAP
            : anchorRect.top;
      const preferredLeft =
        side === "right"
          ? groupRect.right + ANCHOR_GAP
          : side === "left"
            ? groupRect.left - measuredWidth - ANCHOR_GAP
            : anchorRect.left;
      const maximumLeft = Math.max(
        viewportLeft + VIEWPORT_PADDING,
        viewportRight - VIEWPORT_PADDING - measuredWidth,
      );
      const maximumTop = Math.max(
        viewportTop + VIEWPORT_PADDING,
        viewportBottom - VIEWPORT_PADDING - measuredHeight,
      );
      const nextPosition = {
        left: Math.min(Math.max(preferredLeft, viewportLeft + VIEWPORT_PADDING), maximumLeft),
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
      onDismiss();
    };

    const resizeObserver = new ownerWindow.ResizeObserver(schedulePosition);
    resizeObserver.observe(anchorElement);
    const groupElement = anchorElement.closest(".decision-panel__choices");
    if (groupElement) resizeObserver.observe(groupElement);
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

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      className="annotation-popover"
      role="tooltip"
      aria-labelledby={titleId}
      style={style}
    >
      <header className="annotation-popover__header">
        <h3 id={titleId}>{annotation.title ?? t("annotation.fallbackTitle")}</h3>
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
