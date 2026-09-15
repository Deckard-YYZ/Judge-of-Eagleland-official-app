import type { EndingId } from "../../../content/schema";
import "./story.css";

export interface EndingViewProps {
  endingId: EndingId;
  title: string;
  onReturnToArchive(): void;
}

/** Final read-only view. Reaching this component never dispatches another case command. */
export function EndingView({ endingId, title, onReturnToArchive }: EndingViewProps) {
  return (
    <section className="ending-view" aria-labelledby="ending-view-title" data-ending-id={endingId}>
      <p className="ending-view__kicker">Final archive</p>
      <div className="ending-view__seal" aria-hidden="true">
        结
      </div>
      <h1 id="ending-view-title">{title}</h1>
      <p>本局裁定已经全部归档。你可以返回工作区，继续查阅本局已经完成的记录。</p>
      <button
        className="story-button story-button--primary ending-view__return"
        type="button"
        onClick={onReturnToArchive}
      >
        返回已归档案卷
      </button>
      <span className="ending-view__folio">ENDING · {endingId}</span>
    </section>
  );
}
