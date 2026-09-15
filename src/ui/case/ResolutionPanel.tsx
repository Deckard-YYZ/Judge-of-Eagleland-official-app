import { useId, type Ref } from "react";
import type { GameSessionViewSnapshot } from "../../application/gameSessionView";
import type { ContentAttributeView } from "../../application/gameContentView";
import type { TextBlock } from "../../content/schema";
import { useI18n } from "../i18n";
import { TextBlockList } from "./TextBlocks";

type ViewCaseProgress = NonNullable<GameSessionViewSnapshot["state"]>["cases"][string];
export type ResolutionSnapshotView = Extract<ViewCaseProgress, { status: "resolved" }>["snapshot"];

export interface ResolutionPanelProps {
  resolution: Readonly<ResolutionSnapshotView>;
  finalChoiceText: string;
  verdict: readonly Readonly<TextBlock>[];
  result: readonly Readonly<TextBlock>[];
  attributes: Readonly<Record<string, Readonly<ContentAttributeView>>>;
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * Read-only historical result. Every displayed value comes from the persisted
 * ResolutionSnapshot; this component never replays resolution definitions.
 */
export function ResolutionPanel({
  resolution,
  finalChoiceText,
  verdict,
  result,
  attributes,
  headingRef,
}: ResolutionPanelProps) {
  const { formatDate, formatNumber, t } = useI18n();
  const headingId = useId();
  const verdictId = useId();
  const resultId = useId();
  const changesId = useId();
  const resolvedDate = formatDate(new Date(resolution.resolvedAt), {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const signedDelta = (delta: number): string =>
    formatNumber(delta, { signDisplay: delta === 0 ? "auto" : "always" });

  return (
    <section className="resolution-panel" aria-labelledby={headingId}>
      <p className="kicker">{t("resolution.kicker")}</p>
      <h2 ref={headingRef} id={headingId} className="resolution-panel__title" tabIndex={-1}>
        {t("resolution.title")}
      </h2>
      <p className="resolution-panel__choice">
        <span>{t("resolution.finalChoice")}</span>
        {finalChoiceText}
      </p>

      <section className="resolution-panel__section" aria-labelledby={verdictId}>
        <h3 id={verdictId}>{t("resolution.verdict")}</h3>
        <TextBlockList blocks={verdict} />
      </section>

      <section className="resolution-panel__section" aria-labelledby={resultId}>
        <h3 id={resultId}>{t("resolution.result")}</h3>
        <TextBlockList blocks={result} />
      </section>

      <section className="resolution-panel__section" aria-labelledby={changesId}>
        <h3 id={changesId}>{t("resolution.changes")}</h3>
        {resolution.attributeChanges.length > 0 ? (
          <dl className="resolution-changes">
            {resolution.attributeChanges.map((change) => (
              <div key={change.attributeId} className="resolution-change">
                <dt>{attributes[change.attributeId]?.label ?? change.attributeId}</dt>
                <dd>
                  <span className="resolution-change__values">
                    {formatNumber(change.before)} → {formatNumber(change.after)}
                  </span>
                  <span
                    className={`resolution-change__delta resolution-change__delta--${
                      change.actualDelta > 0
                        ? "positive"
                        : change.actualDelta < 0
                          ? "negative"
                          : "neutral"
                    }`}
                    aria-label={t("resolution.deltaAria", {
                      delta: signedDelta(change.actualDelta),
                    })}
                  >
                    {signedDelta(change.actualDelta)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="resolution-panel__empty-change">{t("resolution.noChanges")}</p>
        )}
      </section>

      <p className="resolution-panel__meta">
        {t("resolution.meta", { order: formatNumber(resolution.resolvedOrder) })}
        <time dateTime={resolution.resolvedAt}>{resolvedDate}</time>
      </p>
    </section>
  );
}
