import type { ActionId } from "../shared/action";
import type {
  ChoiceAnnotation,
  ContentLocale,
  GameContentCatalog,
  LocalizedContentCatalog,
  NarrationDefinition,
  NarrationVoiceId,
  TextBlock,
} from "../content/schema";

export interface ContentAttributeView {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

export interface ContentChoiceView {
  readonly id: string;
  readonly text: string;
  readonly annotation?: Readonly<ChoiceAnnotation>;
}

export interface ContentNodeView {
  readonly prompt: string;
  readonly choices: readonly Readonly<ContentChoiceView>[];
}

export interface ContentCaseView {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly characters: readonly Readonly<{
    id: string;
    name: string;
    description: readonly Readonly<TextBlock>[];
  }>[];
  readonly summary: readonly Readonly<TextBlock>[];
  readonly body: readonly Readonly<TextBlock>[];
  readonly nodes: Readonly<Record<string, Readonly<ContentNodeView>>>;
  readonly resolutions: Readonly<
    Record<
      string,
      Readonly<{
        verdict: readonly Readonly<TextBlock>[];
        result: readonly Readonly<TextBlock>[];
      }>
    >
  >;
}

export interface ContentNarrationView {
  readonly voiceId: NarrationVoiceId;
  readonly locale: ContentLocale;
  readonly text: string;
}

/** Pure presentation projection: use the loaded content locale, never the selected input locale. */
export function projectNarration(
  definition: Readonly<NarrationDefinition> | undefined,
  source: Readonly<{ blocks: readonly Readonly<TextBlock>[]; narrationText?: string }>,
  actualContentLocale: ContentLocale,
): ContentNarrationView | undefined {
  const dedicated = definition?.textSource === "narrationText";
  if (!dedicated && source.narrationText !== undefined) throw new Error("NARRATION_TEXT_UNUSED");
  if (definition === undefined) return undefined;
  const text = dedicated
    ? source.narrationText?.trim()
    : source.blocks
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n");
  if (!text) throw new Error("NARRATION_TEXT_MISSING");
  return Object.freeze({ voiceId: definition.voiceId, locale: actualContentLocale, text });
}

export type ContentStoryStepView =
  | Readonly<{
      id: string;
      type: "actionInput";
      targetActionId: ActionId;
      blocks: readonly Readonly<TextBlock>[];
      narration?: ContentNarrationView;
    }>
  | Readonly<{
      id: string;
      type: "text";
      blocks: readonly Readonly<TextBlock>[];
      narration?: ContentNarrationView;
    }>
  | Readonly<{
      id: string;
      type: "video";
      assetId: string;
      fallbackBlocks: readonly Readonly<TextBlock>[];
    }>
  | Readonly<{
      id: string;
      type: "effect";
      effect: "blood" | "fade";
      durationMs: number;
    }>;

export interface ContentStoryView {
  readonly title: string;
  readonly skippable: boolean;
  readonly steps: readonly ContentStoryStepView[];
}

/** Read-only presentation projection. React cannot observe rule targets or resolution effects. */
export interface GameContentView {
  readonly locale: ContentLocale;
  readonly attributes: Readonly<Record<string, Readonly<ContentAttributeView>>>;
  readonly cases: Readonly<Record<string, Readonly<ContentCaseView>>>;
  readonly stories: Readonly<Record<string, Readonly<ContentStoryView>>>;
  readonly endings: Readonly<Record<string, Readonly<{ title: string }>>>;
}

export function createGameContentView(
  game: Readonly<GameContentCatalog>,
  localized: Readonly<LocalizedContentCatalog>,
): GameContentView {
  const attributes = Object.fromEntries(
    Object.entries(game.attributes).map(([id, attribute]) => [
      id,
      { label: localized.attributes[id].label, min: attribute.min, max: attribute.max },
    ]),
  );
  const cases = Object.fromEntries(
    Object.entries(game.cases).map(([caseId, definition]) => {
      const copy = localized.cases[caseId];
      return [
        caseId,
        {
          id: definition.id,
          title: copy.title,
          order: definition.order,
          characters: definition.characters.map(({ id }) => ({ id, ...copy.characters[id] })),
          summary: copy.summary,
          body: copy.body,
          nodes: Object.fromEntries(
            Object.entries(definition.nodes).map(([nodeId, node]) => [
              nodeId,
              {
                prompt: copy.nodes[nodeId].prompt,
                choices: node.choices.map(({ id }) => ({ id, ...copy.choices[id] })),
              },
            ]),
          ),
          resolutions: copy.resolutions,
        },
      ];
    }),
  );
  const stories = Object.fromEntries(
    Object.entries(game.stories).map(([storyId, story]) => {
      const copy = localized.stories[storyId];
      return [
        storyId,
        {
          title: copy.title,
          skippable: story.skippable,
          steps: story.steps.map((step): ContentStoryStepView => {
            if (step.type === "actionInput") {
              // Projection is a whitelist: penalties remain exclusively in the rules catalog.
              return {
                id: step.id,
                type: step.type,
                targetActionId: step.targetActionId,
                blocks: copy.steps[step.id].blocks,
                ...(step.narration === undefined
                  ? {}
                  : {
                      narration: projectNarration(
                        step.narration,
                        copy.steps[step.id],
                        localized.locale,
                      ),
                    }),
              };
            }
            if (step.type === "effect") return step;
            if (step.type === "video") {
              return { ...step, fallbackBlocks: copy.steps[step.id].blocks };
            }
            return {
              id: step.id,
              type: step.type,
              blocks: copy.steps[step.id].blocks,
              ...(step.narration === undefined
                ? {}
                : {
                    narration: projectNarration(
                      step.narration,
                      copy.steps[step.id],
                      localized.locale,
                    ),
                  }),
            };
          }),
        },
      ];
    }),
  );
  return Object.freeze({
    locale: localized.locale,
    attributes,
    cases,
    stories,
    endings: localized.endings,
  });
}
