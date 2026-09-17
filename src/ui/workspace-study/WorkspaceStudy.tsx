import { useState } from "react";
import { InterfaceSettings } from "../InterfaceSettings";
import { TextBlockList } from "../case/TextBlocks";
import { useI18n, type MessageKey } from "../i18n";
import type { UiThemeMode } from "../theme";
import "./workspace-study.css";

type Direction = "judicial" | "terminal";
interface WorkspaceStudyProps {
  initialDirection: Direction;
  themeMode: UiThemeMode;
  onThemeChange(mode: UiThemeMode): void;
}

const choiceKeys = [
  "study.choiceReview",
  "study.choiceConfirm",
  "study.choiceDismiss",
] as const satisfies readonly MessageKey[];

/** Isolated UI specimen: local presentation state only, never a game command or save. */
export function WorkspaceStudy({
  initialDirection,
  themeMode,
  onThemeChange,
}: WorkspaceStudyProps) {
  const { t } = useI18n();
  const [direction, setDirection] = useState(initialDirection);
  const [started, setStarted] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showCase, setShowCase] = useState(true);
  const changeDirection = (value: Direction) => {
    setDirection(value);
    const url = new URL(window.location.href);
    url.searchParams.set("uiPreview", value);
    window.history.replaceState(null, "", url);
  };
  const reset = () => {
    setStarted(false);
    setChoice(null);
    setConfirmed(false);
  };
  return (
    <div className={`workspace-study workspace-study--${direction}`}>
      <header className="study-toolbar">
        <a className="study-brand" href={window.location.pathname}>
          <span className="study-brand__seal" aria-hidden="true">
            {t("brand.seal")}
          </span>
          <span>
            <strong>{t("brand.name")}</strong>
            <small>{t("brand.office")}</small>
          </span>
        </a>
        <div className="study-toolbar__right">
          <span className="study-session">{t("study.operator")}</span>
          <InterfaceSettings themeMode={themeMode} onThemeChange={onThemeChange} />
        </div>
      </header>
      <div className="study-comparison">
        <span className="study-sample-label">{t("study.sample")}</span>
        <div role="group" aria-label={t("study.directions")} className="study-direction-switch">
          <button
            type="button"
            aria-pressed={direction === "judicial"}
            onClick={() => changeDirection("judicial")}
          >
            {t("study.judicial")}
          </button>
          <button
            type="button"
            aria-pressed={direction === "terminal"}
            onClick={() => changeDirection("terminal")}
          >
            {t("study.terminal")}
          </button>
        </div>
        <span className="study-comparison__notice">{t("study.previewNotice")}</span>
        <a href={window.location.pathname}>{t("study.return")}</a>
      </div>
      <div className="study-layout">
        <aside className="study-sidebar" aria-label={t("sidebar.navigationLabel")}>
          <div className="study-sidebar__identity">
            <span>{t("study.station")}</span>
            <strong>07</strong>
          </div>
          <section className="study-metrics">
            <h2>
              {t("sidebar.attributes")}
              <span>02</span>
            </h2>
            <dl>
              {(["study.restraint", "study.authority"] as const).map((key) => (
                <div key={key}>
                  <dt>{t(key)}</dt>
                  <dd>
                    50
                    <span className="study-meter" aria-hidden="true">
                      <i />
                    </span>
                    <small>{t("sidebar.attributeRange", { min: 0, max: 100 })}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="study-queue">
            <h2>
              {t("sidebar.pending")}
              <span>01</span>
            </h2>
            <button
              type="button"
              aria-current={showCase ? "page" : undefined}
              onClick={() => setShowCase(true)}
            >
              <span className="study-queue__number">001</span>
              <strong>{t("study.caseTitle")}</strong>
              <small>{t(started ? "sidebar.status.active" : "sidebar.status.pending")}</small>
            </button>
          </section>
          <section className="study-archive">
            <h2>
              {t("sidebar.resolved")}
              <span>00</span>
            </h2>
            <p>{t("sidebar.noResolved")}</p>
          </section>
          <button
            className="study-empty-toggle"
            type="button"
            onClick={() => setShowCase(!showCase)}
          >
            {t(showCase ? "study.showEmpty" : "study.showCase")}
          </button>
          <p className="study-sidebar__footer">{t("study.registry")}</p>
        </aside>
        <main className="study-main" id="study-workspace">
          {showCase ? (
            <article className="study-document" aria-labelledby="study-case-title">
              <header className="study-document__header">
                <div className="study-document__meta">
                  <span>{t("study.recordNumber")}</span>
                  <span>
                    {t(
                      confirmed
                        ? "study.recorded"
                        : started
                          ? "case.status.active"
                          : "case.status.pending",
                    )}
                  </span>
                </div>
                <p className="study-document__eyebrow">{t("case.recordKicker")}</p>
                <h1 id="study-case-title">{t("study.caseTitle")}</h1>
                <p className="study-document__subtitle">{t("study.subject")}</p>
              </header>
              <div className="study-record">
                <section className="study-person" aria-labelledby="study-person-title">
                  <h2 id="study-person-title">
                    <span aria-hidden="true">01</span>
                    {t("case.people")}
                  </h2>
                  <div>
                    <strong>{t("study.personName")}</strong>
                    <p>{t("study.personDetail")}</p>
                  </div>
                </section>
                <section className="study-summary" aria-labelledby="study-summary-title">
                  <h2 id="study-summary-title">
                    <span aria-hidden="true">02</span>
                    {t("case.summary")}
                  </h2>
                  <TextBlockList blocks={[{ type: "paragraph", text: t("study.summary") }]} />
                </section>
                <section className="study-body" aria-labelledby="study-body-title">
                  <h2 id="study-body-title">
                    <span aria-hidden="true">03</span>
                    {t("case.body")}
                  </h2>
                  <TextBlockList
                    blocks={[
                      { type: "paragraph", text: t("study.bodyOne") },
                      { type: "paragraph", text: t("study.bodyTwo") },
                    ]}
                  />
                </section>
                <section className="study-action" aria-labelledby="study-action-title">
                  <div className="study-action__index" aria-hidden="true">
                    04
                  </div>
                  <div className="study-action__content">
                    <p className="study-action__kicker">{t("case.startKicker")}</p>
                    <h2 id="study-action-title">
                      {t(
                        confirmed
                          ? "study.recorded"
                          : started
                            ? "study.decisionTitle"
                            : "case.startTitle",
                      )}
                    </h2>
                    {!started ? (
                      <>
                        <p>{t("case.startDetail")}</p>
                        <button
                          className="study-primary"
                          type="button"
                          onClick={() => setStarted(true)}
                        >
                          {t("case.start")}
                          <span aria-hidden="true">→</span>
                        </button>
                      </>
                    ) : confirmed ? (
                      <>
                        <p role="status">{t("study.confirmedNotice")}</p>
                        <button className="study-primary" type="button" onClick={reset}>
                          {t("study.reset")}
                        </button>
                      </>
                    ) : (
                      <>
                        <p>{t("study.decisionDetail")}</p>
                        <div
                          className="study-choices"
                          role="group"
                          aria-label={t("study.decisionTitle")}
                        >
                          {choiceKeys.map((key, index) => (
                            <div className="study-choice-wrap" key={key}>
                              <button
                                type="button"
                                aria-pressed={choice === index}
                                aria-describedby={`study-hint-${index}`}
                                onClick={() => setChoice(index)}
                              >
                                <span aria-hidden="true">0{index + 1}</span>
                                {t(key)}
                                <span aria-hidden="true">{choice === index ? "●" : "○"}</span>
                              </button>
                              <span
                                role="tooltip"
                                id={`study-hint-${index}`}
                                className="study-choice-hint"
                              >
                                {t(
                                  (
                                    [
                                      "study.hintReview",
                                      "study.hintConfirm",
                                      "study.hintDismiss",
                                    ] as const
                                  )[index]!,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                        <button
                          className="study-primary"
                          type="button"
                          disabled={choice === null}
                          onClick={() => setConfirmed(true)}
                        >
                          {t("study.confirm")}
                        </button>
                      </>
                    )}
                  </div>
                </section>
              </div>
              <footer className="study-document__footer">
                <span>{t("study.registry")}</span>
                <span>{t("study.pageNumber")}</span>
              </footer>
            </article>
          ) : (
            <section className="study-empty">
              <span aria-hidden="true">{t("brand.seal")}</span>
              <h1>{t("case.guideTitle")}</h1>
              <p>{t("case.guideDetail")}</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
