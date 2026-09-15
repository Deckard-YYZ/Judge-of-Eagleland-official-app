import { useId, useMemo, useState, type ReactNode } from "react";
import type { CaseId } from "../../content/schema";
import type { GameSessionViewSnapshot } from "../../application/gameSessionView";
import { createSidebarModel } from "./sidebarModel";

export interface SidebarProps {
  snapshot: GameSessionViewSnapshot;
  interactionLocked: boolean;
  onSelectCase(caseId: CaseId): void;
}

interface SidebarSectionProps {
  id: string;
  title: string;
  count: number;
  expanded: boolean;
  onToggle(): void;
  children: ReactNode;
}

function SidebarSection({ id, title, count, expanded, onToggle, children }: SidebarSectionProps) {
  return (
    <section className="case-sidebar__section" aria-labelledby={`${id}-toggle`}>
      <h2 className="case-sidebar__section-heading">
        <button
          className="case-sidebar__section-toggle"
          id={`${id}-toggle`}
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={onToggle}
        >
          <span>{title}</span>
          <span className="case-sidebar__section-count" aria-label={`${count} 项`}>
            {count}
          </span>
          <span className="case-sidebar__chevron" aria-hidden="true">
            {expanded ? "−" : "+"}
          </span>
        </button>
      </h2>
      <div id={`${id}-content`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

export function Sidebar({ snapshot, interactionLocked, onSelectCase }: SidebarProps) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [attributesExpanded, setAttributesExpanded] = useState(true);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const baseId = useId();
  const model = useMemo(() => createSidebarModel(snapshot), [snapshot]);

  const selectCase = (caseId: CaseId): void => {
    // Loading and saving form one interaction lock across shell exit and document selection.
    if (!interactionLocked) {
      onSelectCase(caseId);
    }
  };

  return (
    <aside
      className={`case-sidebar${sidebarExpanded ? "" : " case-sidebar--collapsed"}`}
      aria-label="案件导航"
    >
      <div className="case-sidebar__rail">
        <button
          className="case-sidebar__collapse"
          type="button"
          aria-expanded={sidebarExpanded}
          aria-controls={`${baseId}-panels`}
          aria-label={sidebarExpanded ? "收起侧边栏" : "展开侧边栏"}
          onClick={() => setSidebarExpanded((current) => !current)}
        >
          <span aria-hidden="true">{sidebarExpanded ? "‹" : "›"}</span>
        </button>
      </div>

      <div className="case-sidebar__panels" id={`${baseId}-panels`} hidden={!sidebarExpanded}>
        <SidebarSection
          id={`${baseId}-attributes`}
          title="属性"
          count={model.attributes.length}
          expanded={attributesExpanded}
          onToggle={() => setAttributesExpanded((current) => !current)}
        >
          {model.attributes.length > 0 ? (
            <dl className="case-sidebar__attributes">
              {model.attributes.map((attribute) => (
                <div className="case-sidebar__attribute" key={attribute.id}>
                  <dt>{attribute.label}</dt>
                  <dd>
                    <strong>{attribute.value}</strong>
                    <span>
                      范围 {attribute.min}–{attribute.max}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="case-sidebar__empty">尚无可显示属性</p>
          )}
        </SidebarSection>

        <SidebarSection
          id={`${baseId}-pending`}
          title="未处理文档"
          count={model.pendingCases.length}
          expanded={pendingExpanded}
          onToggle={() => setPendingExpanded((current) => !current)}
        >
          {model.pendingCases.length > 0 ? (
            <ul className="case-sidebar__case-list">
              {model.pendingCases.map(({ caseId, definition, progress }) => {
                const selected = snapshot.selectedCaseId === caseId;
                const statusLabel = progress.status === "active" ? "审理中" : "待开始";
                return (
                  <li key={caseId}>
                    <button
                      className="case-sidebar__case"
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      aria-label={`${definition.title}，${statusLabel}`}
                      title={definition.title}
                      disabled={interactionLocked}
                      onClick={() => selectCase(caseId)}
                    >
                      <span className="case-sidebar__case-title">{definition.title}</span>
                      <span
                        className={`case-sidebar__case-status case-sidebar__case-status--${progress.status}`}
                      >
                        {statusLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="case-sidebar__empty">没有未处理文档</p>
          )}
        </SidebarSection>

        <SidebarSection
          id={`${baseId}-resolved`}
          title="已处理文档"
          count={model.resolvedCases.length}
          expanded={resolvedExpanded}
          onToggle={() => setResolvedExpanded((current) => !current)}
        >
          {model.resolvedCases.length > 0 ? (
            <ul className="case-sidebar__case-list">
              {model.resolvedCases.map(({ caseId, definition }) => {
                const selected = snapshot.selectedCaseId === caseId;
                return (
                  <li key={caseId}>
                    <button
                      className="case-sidebar__case"
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      aria-label={`${definition.title}，已结案`}
                      title={definition.title}
                      disabled={interactionLocked}
                      onClick={() => selectCase(caseId)}
                    >
                      <span className="case-sidebar__case-title">{definition.title}</span>
                      <span className="case-sidebar__case-status case-sidebar__case-status--resolved">
                        已结案
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="case-sidebar__empty">尚无已处理文档</p>
          )}
        </SidebarSection>
      </div>
    </aside>
  );
}
