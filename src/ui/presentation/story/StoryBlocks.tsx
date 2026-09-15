import type { TextBlock } from "../../../content/schema";

export interface StoryBlocksProps {
  blocks: readonly Readonly<TextBlock>[];
}

/** Story copy stays semantic and selectable in both normal and media-fallback steps. */
export function StoryBlocks({ blocks }: StoryBlocksProps) {
  return (
    <div className="story-blocks">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;

        switch (block.type) {
          case "heading":
            return <h3 key={key}>{block.text}</h3>;
          case "quote":
            return (
              <blockquote key={key}>
                <p>{block.text}</p>
              </blockquote>
            );
          case "paragraph":
            return <p key={key}>{block.text}</p>;
        }
      })}
    </div>
  );
}
