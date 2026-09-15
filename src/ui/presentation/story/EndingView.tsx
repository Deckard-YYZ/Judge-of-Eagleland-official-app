import type { EndingId } from "../../../content/schema";
import { useI18n } from "../../i18n";
import "./story.css";

export interface EndingViewProps {
  endingId: EndingId;
  title: string;
  onReturnToArchive(): void;
}

/** Final read-only view. Reaching this component never dispatches another case command. */
export function EndingView({ endingId, title, onReturnToArchive }: EndingViewProps) {
  const { t } = useI18n();

  return (
    <section className="ending-view" aria-labelledby="ending-view-title" data-ending-id={endingId}>
      <p className="ending-view__kicker">{t("ending.kicker")}</p>
      <div className="ending-view__seal" aria-hidden="true">
        {t("ending.seal")}
      </div>
      <h1 id="ending-view-title">{title}</h1>
      <p>{t("ending.description")}</p>
      <button
        className="story-button story-button--primary ending-view__return"
        type="button"
        onClick={onReturnToArchive}
      >
        {t("ending.return")}
      </button>
      <span className="ending-view__folio">{t("ending.folio", { endingId })}</span>
    </section>
  );
}
