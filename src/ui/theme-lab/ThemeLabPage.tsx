import { useMemo, useState, type CSSProperties } from "react";
import { ThemeWorkspacePreview } from "./ThemeWorkspacePreview";
import {
  themeCandidates,
  type ThemeCandidate,
  type ThemeMode,
  type ThemeTokenName,
} from "./themeCandidates";
import "./theme-lab.css";

type ThemeLabStyle = CSSProperties & Record<`--tl-${string}`, string>;

function createThemeStyle(candidate: ThemeCandidate, mode: ThemeMode): ThemeLabStyle {
  const tokenEntries = Object.entries(candidate.modes[mode]).map(([name, value]) => [
    `--tl-${name as ThemeTokenName}`,
    value,
  ]);

  return {
    ...Object.fromEntries(tokenEntries),
    "--tl-font-display": candidate.typography.display,
    "--tl-font-body": candidate.typography.body,
    "--tl-font-mono": candidate.typography.mono,
    "--tl-radius": candidate.shape.radius,
    "--tl-shadow": candidate.shape.shadow,
    "--tl-line-width": candidate.shape.lineWidth,
  };
}

interface CandidateCardProps {
  candidate: ThemeCandidate;
  active: boolean;
  mode: ThemeMode;
  onSelect(): void;
}

function CandidateCard({ candidate, active, mode, onSelect }: CandidateCardProps) {
  return (
    <button
      className="theme-lab__candidate-card"
      type="button"
      style={createThemeStyle(candidate, mode)}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="theme-lab__candidate-card-heading">
        <span>{candidate.sequence}</span>
        <small>{candidate.englishName}</small>
      </span>
      <strong>{candidate.name}</strong>
      <span className="theme-lab__mini-workspace" aria-hidden="true">
        <i className="theme-lab__mini-bar" />
        <i className="theme-lab__mini-side" />
        <i className="theme-lab__mini-title" />
        <i className="theme-lab__mini-copy" />
        <i className="theme-lab__mini-choice" />
        <i className="theme-lab__mini-status" />
      </span>
      <span className="theme-lab__candidate-keywords">{candidate.keywords.join(" · ")}</span>
    </button>
  );
}

export function ThemeLabPage() {
  const [candidateId, setCandidateId] = useState(themeCandidates[0].id);
  const [mode, setMode] = useState<ThemeMode>("light");
  const candidate = useMemo(
    () => themeCandidates.find((item) => item.id === candidateId) ?? themeCandidates[0],
    [candidateId],
  );

  return (
    <div
      className="theme-lab"
      data-mode={mode}
      data-candidate={candidate.id}
      style={createThemeStyle(candidate, mode)}
    >
      <header className="theme-lab__lab-bar">
        <a className="theme-lab__lab-title" href="#theme-lab-overview">
          <span>JOE / VISUAL STUDY</span>
          <strong>权威极简主题实验室</strong>
        </a>

        <div className="theme-lab__lab-actions">
          <div className="theme-lab__mode-switch" role="group" aria-label="颜色模式">
            <button type="button" aria-pressed={mode === "light"} onClick={() => setMode("light")}>
              Light
            </button>
            <button type="button" aria-pressed={mode === "dark"} onClick={() => setMode("dark")}>
              Dark
            </button>
          </div>
          <a className="theme-lab__return" href={window.location.pathname}>
            返回正式界面
          </a>
        </div>
      </header>

      <main className="theme-lab__page">
        <section className="theme-lab__intro" id="theme-lab-overview">
          <div>
            <p>DESIGN DIRECTION / AUTHORITY STUDY</p>
            <h1>
              两种秩序，
              <br />
              两种服从。
            </h1>
          </div>
          <p>
            所有候选使用同一份案件材料与操作骨架。比较规则如何命令，或空间如何迫使人停驻；再切换明暗模式检查长期阅读。
          </p>
        </section>

        <section className="theme-lab__overview" aria-labelledby="theme-lab-overview-title">
          <div className="theme-lab__overview-heading">
            <h2 id="theme-lab-overview-title">候选总览</h2>
            <span>选择一套以核验完整工作区</span>
          </div>
          <div className="theme-lab__candidate-grid">
            {themeCandidates.map((item) => (
              <CandidateCard
                key={item.id}
                candidate={item}
                active={item.id === candidate.id}
                mode={mode}
                onSelect={() => setCandidateId(item.id)}
              />
            ))}
          </div>
        </section>

        <section className="theme-lab__selection" aria-labelledby="theme-lab-specimen-title">
          <div className="theme-lab__selection-heading">
            <div className="theme-lab__selection-index">{candidate.sequence} / 02</div>
            <div>
              <p>{candidate.englishName}</p>
              <h2 id="theme-lab-specimen-title">{candidate.name}</h2>
            </div>
            <p className="theme-lab__selection-thesis">{candidate.thesis}</p>
          </div>

          <dl className="theme-lab__decision-notes">
            <div>
              <dt>设计关键词</dt>
              <dd>{candidate.keywords.join(" / ")}</dd>
            </div>
            <div>
              <dt>观察方向</dt>
              <dd>{candidate.influence}</dd>
            </div>
            <div>
              <dt>取舍</dt>
              <dd>{candidate.tradeoff}</dd>
            </div>
          </dl>

          {/* Isolation boundary: this specimen owns mock copy and local choice state only. */}
          <ThemeWorkspacePreview candidate={candidate} />
        </section>
      </main>
    </div>
  );
}
