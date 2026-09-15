import { useId, type Ref } from "react";
import type { GameSessionViewSnapshot } from "../../application/gameSessionView";
import { TextBlockList } from "./TextBlocks";

type ViewCaseProgress = NonNullable<GameSessionViewSnapshot["state"]>["cases"][string];
export type ResolutionSnapshotView = Extract<ViewCaseProgress, { status: "resolved" }>["snapshot"];

export interface ResolutionPanelProps {
  resolution: Readonly<ResolutionSnapshotView>;
  headingRef?: Ref<HTMLHeadingElement>;
}

const signedDelta = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

/**
 * Read-only historical result. Every displayed value comes from the persisted
 * ResolutionSnapshot; this component never replays resolution definitions.
 */
export function ResolutionPanel({ resolution, headingRef }: ResolutionPanelProps) {
  const headingId = useId();
  const verdictId = useId();
  const resultId = useId();
  const changesId = useId();

  return (
    <section className="resolution-panel" aria-labelledby={headingId}>
      <p className="kicker">Resolution recorded</p>
      <h2 ref={headingRef} id={headingId} className="resolution-panel__title" tabIndex={-1}>
        裁定已经归档
      </h2>
      <p className="resolution-panel__choice">
        <span>最终选择</span>
        {resolution.finalChoiceText}
      </p>

      <section className="resolution-panel__section" aria-labelledby={verdictId}>
        <h3 id={verdictId}>判决</h3>
        <TextBlockList blocks={resolution.verdict} />
      </section>

      <section className="resolution-panel__section" aria-labelledby={resultId}>
        <h3 id={resultId}>结果</h3>
        <TextBlockList blocks={resolution.result} />
      </section>

      <section className="resolution-panel__section" aria-labelledby={changesId}>
        <h3 id={changesId}>实际属性变化</h3>
        {resolution.attributeChanges.length > 0 ? (
          <dl className="resolution-changes">
            {resolution.attributeChanges.map((change) => (
              <div key={change.attributeId} className="resolution-change">
                <dt>{change.label}</dt>
                <dd>
                  <span className="resolution-change__values">
                    {change.before} → {change.after}
                  </span>
                  <span
                    className={`resolution-change__delta resolution-change__delta--${
                      change.actualDelta > 0
                        ? "positive"
                        : change.actualDelta < 0
                          ? "negative"
                          : "neutral"
                    }`}
                    aria-label={`实际变化 ${signedDelta(change.actualDelta)}`}
                  >
                    {signedDelta(change.actualDelta)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="resolution-panel__empty-change">本次裁定没有产生属性变化。</p>
        )}
      </section>

      <p className="resolution-panel__meta">
        归档序号 {resolution.resolvedOrder} ·{" "}
        <time dateTime={resolution.resolvedAt}>{resolution.resolvedAt}</time>
      </p>
    </section>
  );
}
