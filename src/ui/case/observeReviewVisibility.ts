/** One-shot visibility gate shared by pending review and committed decision nodes. */
export function observeReviewVisibility(element: HTMLElement, onVisible: () => void): () => void {
  let live = true;
  let reached = false;
  const reveal = () => {
    if (!live || reached) return;
    reached = true;
    onVisible();
  };
  if (typeof window.IntersectionObserver === "function") {
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0)) {
          observer.disconnect();
          reveal();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => {
      live = false;
      observer.disconnect();
    };
  }

  // Older WebViews must still wait for visibility, including clipping by the
  // scrollable workspace. Do not dispatch merely because an observer is absent.
  const check = () => {
    if (!live || reached || !element.isConnected) return;
    const bounds = element.getBoundingClientRect();
    let top = Math.max(0, bounds.top);
    let bottom = Math.min(window.innerHeight, bounds.bottom);
    let left = Math.max(0, bounds.left);
    let right = Math.min(window.innerWidth, bounds.right);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = window.getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, rect.left);
        right = Math.min(right, rect.right);
      }
    }
    if (bottom > top && right > left) reveal();
  };
  check();
  window.addEventListener("scroll", check, true);
  window.addEventListener("resize", check);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
  resize?.observe(element);
  return () => {
    live = false;
    window.removeEventListener("scroll", check, true);
    window.removeEventListener("resize", check);
    resize?.disconnect();
  };
}
