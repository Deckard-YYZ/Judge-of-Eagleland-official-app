import { useEffect, useMemo, useRef, useState } from "react";
import type { TextBlock } from "../../content/schema";

/** Presentation clock only: pauses when unreadable and never dispatches a command. */
export function useInstructionTyping(
  blocks: readonly Readonly<TextBlock>[] | undefined,
  enabled: boolean,
  visible: boolean,
) {
  const segments = useMemo(() => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return (
      blocks?.map((block) => [...segmenter.segment(block.text)].map((part) => part.segment)) ?? []
    );
  }, [blocks]);
  const total = segments.reduce((sum, parts) => sum + parts.length, 0);
  const duration = Math.min(3000, (total / 15) * 1000);
  const elapsed = useRef(0);
  const [time, setTime] = useState(0);
  const [finished, setFinished] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!enabled || finished) return;
    if (reduced || elapsed.current >= duration) {
      setFinished(true);
      return;
    }
    if (!visible) return;
    const start = Date.now();
    const initial = elapsed.current;
    const timer = window.setInterval(
      () => {
        elapsed.current = Math.min(duration, initial + Date.now() - start);
        setTime(elapsed.current);
        if (elapsed.current >= duration) {
          setFinished(true);
          window.clearInterval(timer);
        }
      },
      Math.min(20, duration),
    );
    return () => {
      window.clearInterval(timer);
      elapsed.current = Math.min(duration, initial + Date.now() - start);
      setTime(elapsed.current);
      if (elapsed.current >= duration) setFinished(true);
    };
  }, [enabled, visible, reduced, duration, finished]);
  const complete = enabled && (reduced || finished || time >= duration);
  let remaining = complete ? total : Math.floor((total * time) / duration);
  const revealed =
    blocks?.map((block, index) => {
      const text = segments[index].slice(0, remaining).join("");
      remaining = Math.max(0, remaining - segments[index].length);
      return { ...block, text };
    }) ?? [];
  return { complete, revealed };
}
