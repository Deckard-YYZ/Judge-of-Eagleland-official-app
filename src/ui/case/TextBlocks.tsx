import { useId } from "react";
import type { CharacterBrief, TextBlock as TextBlockDefinition } from "../../content/schema";

export interface TextBlockProps {
  block: Readonly<TextBlockDefinition>;
}

/** Render authored case copy as selectable, semantic text instead of presentation-only markup. */
export function TextBlock({ block }: TextBlockProps) {
  switch (block.type) {
    case "heading":
      return <h3 className="case-text-block case-text-block--heading">{block.text}</h3>;
    case "quote":
      return (
        <blockquote className="case-text-block case-text-block--quote">
          <p>{block.text}</p>
        </blockquote>
      );
    case "paragraph":
      return <p className="case-text-block case-text-block--paragraph">{block.text}</p>;
  }
}

export interface TextBlockListProps {
  blocks: readonly Readonly<TextBlockDefinition>[];
}

export function TextBlockList({ blocks }: TextBlockListProps) {
  return (
    <div className="case-text-blocks">
      {blocks.map((block, index) => (
        <TextBlock key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

export interface CharacterSectionProps {
  characters: readonly Readonly<CharacterBrief>[];
}

export function CharacterSection({ characters }: CharacterSectionProps) {
  const headingId = useId();

  if (characters.length === 0) {
    return null;
  }

  return (
    <section className="case-section case-characters" aria-labelledby={headingId}>
      <h2 id={headingId} className="case-section__title">
        相关人员
      </h2>
      <ul className="case-characters__list">
        {characters.map((character) => (
          <li key={character.id} className="case-characters__item">
            <article>
              <h3>{character.name}</h3>
              <TextBlockList blocks={character.description} />
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface CaseSummaryProps {
  blocks: readonly Readonly<TextBlockDefinition>[];
}

export function CaseSummary({ blocks }: CaseSummaryProps) {
  const headingId = useId();

  return (
    <section className="case-section case-summary" aria-labelledby={headingId}>
      <h2 id={headingId} className="case-section__title">
        案情摘要
      </h2>
      <TextBlockList blocks={blocks} />
    </section>
  );
}

export interface CaseBodyProps {
  blocks: readonly Readonly<TextBlockDefinition>[];
}

export function CaseBody({ blocks }: CaseBodyProps) {
  const headingId = useId();

  return (
    <section className="case-section case-body" aria-labelledby={headingId}>
      <h2 id={headingId} className="case-section__title">
        案卷正文
      </h2>
      <TextBlockList blocks={blocks} />
    </section>
  );
}
