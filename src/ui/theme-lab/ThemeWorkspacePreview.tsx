import { useState } from "react";
import type { ThemeCandidate } from "./themeCandidates";

interface ThemeWorkspacePreviewProps {
  candidate: ThemeCandidate;
}

const choices = [
  {
    id: "confirm",
    label: "确认程序违规",
    detail: "记录达到认定阈值，移交处分序列。",
  },
  {
    id: "review",
    label: "要求补充复核",
    detail: "暂缓签发，调取门禁记录与完整授权链。",
  },
  {
    id: "dismiss",
    label: "证据不足，不予认定",
    detail: "材料未达处置阈值，案件转入受限归档。",
  },
] as const;

export function ThemeWorkspacePreview({ candidate }: ThemeWorkspacePreviewProps) {
  const [selectedChoice, setSelectedChoice] = useState("review");

  return (
    <section
      className="theme-lab__specimen"
      data-candidate={candidate.id}
      aria-labelledby="theme-lab-specimen-title"
    >
      <header className="theme-lab__workspace-bar">
        <a className="theme-lab__brand" href="#theme-lab-case-title">
          <span className="theme-lab__brand-mark" aria-hidden="true">
            衡
          </span>
          <span>
            <strong>鹰国司法档案处</strong>
            <small>JUDICIAL ARCHIVE / OBSERVATION DESK</small>
          </span>
        </a>

        <div className="theme-lab__session">
          <span className="theme-lab__live-dot" aria-hidden="true" />
          <span>监察链已接通</span>
          <span className="theme-lab__session-divider" aria-hidden="true" />
          <span>审判员 07 / 受记录</span>
          <button type="button">结束会话</button>
        </div>
      </header>

      <div className="theme-lab__workspace-frame">
        <aside className="theme-lab__sidebar" aria-label="案件导航样板">
          <div className="theme-lab__docket-heading">
            <span>指令队列</span>
            <strong>02 / 02</strong>
          </div>

          <section className="theme-lab__side-section" aria-labelledby="theme-lab-attributes">
            <h3 id="theme-lab-attributes">
              <span>行为指标</span>
              <small>03</small>
            </h3>
            <dl className="theme-lab__attributes">
              <div>
                <dt>秩序</dt>
                <dd>68</dd>
              </div>
              <div>
                <dt>公正</dt>
                <dd>74</dd>
              </div>
              <div>
                <dt>民望</dt>
                <dd>51</dd>
              </div>
            </dl>
          </section>

          <nav className="theme-lab__side-section" aria-labelledby="theme-lab-pending">
            <h3 id="theme-lab-pending">
              <span>待核验文档</span>
              <small>02</small>
            </h3>
            <ol className="theme-lab__case-list">
              <li>
                <button type="button" aria-current="page">
                  <span>001</span>
                  <strong>夜间档案室事件</strong>
                  <small>核验进行中</small>
                </button>
              </li>
              <li>
                <button type="button">
                  <span>002</span>
                  <strong>调阅权限申请</strong>
                  <small>等待指令</small>
                </button>
              </li>
            </ol>
          </nav>

          <div className="theme-lab__archive-count">
            <span>受限归档</span>
            <strong>12</strong>
          </div>
        </aside>

        <main className="theme-lab__case" id="theme-lab-workspace">
          <article className="theme-lab__case-document" aria-labelledby="theme-lab-case-title">
            <header className="theme-lab__case-header">
              <div className="theme-lab__case-number">
                <span>JUDICIAL RECORD</span>
                <strong>CASE — 001</strong>
              </div>
              <span className="theme-lab__case-status">监察中</span>
              <h2 id="theme-lab-case-title">夜间档案室事件</h2>
              <p>关于未经完整授权进入司法档案室的行为核验</p>
            </header>

            <div className="theme-lab__case-grid">
              <div className="theme-lab__record">
                <section aria-labelledby="theme-lab-summary">
                  <div className="theme-lab__section-label">
                    <span>01</span>
                    <h3 id="theme-lab-summary">案情摘要</h3>
                  </div>
                  <p className="theme-lab__lead">
                    第三值班日前夜，书记员林默在未取得当值审判员书面许可的情况下进入一级档案室，停留十七分钟。
                  </p>
                  <p>
                    林默称其目的是修正次日公开卷宗中的编号错误。门禁记录与值班簿可以证明进入事实，但现有材料无法确认其是否接触其他密封档案。
                  </p>
                </section>

                <section className="theme-lab__evidence" aria-labelledby="theme-lab-evidence">
                  <div className="theme-lab__section-label">
                    <span>02</span>
                    <h3 id="theme-lab-evidence">关键记录</h3>
                  </div>
                  <blockquote>
                    “紧急校订可先行处理，但必须由当值审判员在场，并于离室前补录授权。”
                    <cite>《档案处夜间管理细则》第 14 条</cite>
                  </blockquote>
                </section>
              </div>

              <form className="theme-lab__decision" onSubmit={(event) => event.preventDefault()}>
                <fieldset>
                  <legend>
                    <span>ASSESSMENT / 01</span>
                    <strong>确认当前处置级别</strong>
                  </legend>
                  <p>选择一项初步判断。签发前，系统将保留本次选择。</p>
                  <div className="theme-lab__choices">
                    {choices.map((choice, index) => {
                      const selected = selectedChoice === choice.id;
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSelectedChoice(choice.id)}
                        >
                          <span className="theme-lab__choice-index">0{index + 1}</span>
                          <span>
                            <strong>{choice.label}</strong>
                            <small>{choice.detail}</small>
                          </span>
                          <span className="theme-lab__choice-mark" aria-hidden="true">
                            {selected ? "●" : "○"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button className="theme-lab__submit" type="submit">
                    签发处置记录
                    <span aria-hidden="true">→</span>
                  </button>
                </fieldset>
              </form>
            </div>

            <footer className="theme-lab__record-footer">
              <span>记录完整性：已核验</span>
              <span>最近监察：14:32:08</span>
              <span>会话状态：等待同步</span>
            </footer>
          </article>
        </main>
      </div>
    </section>
  );
}
