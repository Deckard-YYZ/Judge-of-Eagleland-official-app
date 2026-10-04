import { describe, expect, it } from "vitest";
import { CONFIGURATION_PILOT_GAME_CONTENT } from "../../src/app/configurationPilot";
import {
  applyConfigurationEvent,
  queryCasePool,
  queryConfigurationEvent,
} from "../../src/game/configuration";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
} from "../../src/content/validate";
import { CONFIGURATION_PILOT_LOCALIZATIONS } from "../../src/app/configurationPilot";
import {
  pilotInput,
  pilotSession,
  pilotVerdict,
  preparePilotVerdict,
  pilotSave,
} from "../fixtures/configurationPilot";
import type { GameContentCatalog } from "../../src/content/schema";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";

const cloneGame = (): GameContentCatalog => structuredClone(CONFIGURATION_PILOT_GAME_CONTENT);
const event = { type: "caseResolved", caseId: "intake", resolutionId: "approved" } as const;

describe("schema5 configuration with the real Core and Session", () => {
  it("commits start, ordinary-choice and both final events in order, restores hooks once, and locks ending independently of required actions", async () => {
    const game = cloneGame();
    const localizations = structuredClone(CONFIGURATION_PILOT_LOCALIZATIONS);
    for (const id of ["started_notice", "choice_notice", "final_choice_notice"]) {
      game.stories[id] = structuredClone(game.stories.judgment_notice);
      for (const localized of Object.values(localizations))
        localized.stories[id] = structuredClone(localized.stories.judgment_notice);
    }
    game.stories.ending_notice = { skippable: false, steps: [{ id: "ending_text", type: "text" }] };
    game.endings.final = {
      priority: 1,
      when: { all: [{ type: "attributeAtLeast", attributeId: "authority", value: 1 }] },
      storyId: "ending_notice",
    };
    for (const localized of Object.values(localizations)) {
      localized.stories.ending_notice = {
        title: "Ending",
        steps: { ending_text: { blocks: [{ type: "paragraph", text: "Finished." }] } },
      };
      localized.endings.final = { title: "Completed" };
    }
    game.configuration!.actionInputHooks.push(
      {
        id: "on_start",
        event: { type: "caseStarted", caseId: "intake" },
        storyId: "started_notice",
      },
      {
        id: "on_choice",
        event: {
          type: "choiceCompleted",
          caseId: "intake",
          nodeId: "assessment",
          choiceId: "review",
        },
        storyId: "choice_notice",
      },
      {
        id: "on_final_choice",
        event: {
          type: "choiceCompleted",
          caseId: "intake",
          nodeId: "disposition",
          choiceId: "approve",
        },
        storyId: "final_choice_notice",
      },
    );
    const saves = new InMemorySaveRepository([pilotSave(game)]);
    const { session } = await pilotSession(saves, game, localizations);
    const submit = (storyId: string, actionId: "salute" | "wave") =>
      session.dispatch({ type: "submitStoryInput", storyId, stepId: "required_action", actionId });
    const unchangedOnRejected = async (command: Parameters<typeof session.dispatch>[0]) => {
      const before = await saves.load("pilot-save", "pilot-profile");
      expect(await session.dispatch(command)).toMatchObject({ ok: false });
      expect(await saves.load("pilot-save", "pilot-profile")).toEqual(before);
    };
    expect(await session.dispatch({ type: "startCase", caseId: "intake" })).toMatchObject({
      ok: true,
    });
    expect(session.getSnapshot().state?.pendingStoryIds).toEqual(["started_notice"]);
    await unchangedOnRejected({ type: "startCase", caseId: "intake" });
    await session.reload();
    expect(session.getSnapshot().state?.pendingStoryIds).toEqual(["started_notice"]);
    expect(await submit("started_notice", "salute")).toMatchObject({ ok: true });
    expect(
      await session.dispatch({
        type: "chooseOption",
        caseId: "intake",
        nodeId: "assessment",
        choiceId: "review",
      }),
    ).toMatchObject({ ok: true });
    expect(session.getSnapshot().state?.pendingStoryIds).toEqual(["choice_notice"]);
    expect(await submit("choice_notice", "salute")).toMatchObject({ ok: true });
    await unchangedOnRejected({
      type: "chooseOption",
      caseId: "intake",
      nodeId: "assessment",
      choiceId: "review",
    });
    expect(await session.dispatch(pilotVerdict)).toMatchObject({ ok: true });
    const beforeInput = session.getSnapshot().state!;
    expect(beforeInput.phase).toEqual({ type: "ending", endingId: "final" });
    expect(beforeInput.pendingStoryIds).toEqual([
      "final_choice_notice",
      "judgment_notice",
      "ending_notice",
    ]);
    expect(beforeInput.configurationFacts?.map((fact) => [fact.event.type, fact.hookIds])).toEqual([
      ["caseStarted", ["on_start"]],
      ["choiceCompleted", ["on_choice"]],
      ["choiceCompleted", ["on_final_choice"]],
      ["caseResolved", ["after_intake"]],
    ]);
    await session.reload();
    expect(session.getSnapshot().state).toEqual(beforeInput);
    expect(await submit("final_choice_notice", "wave")).toMatchObject({ ok: true });
    expect(session.getSnapshot().state?.phase).toEqual(beforeInput.phase);
    expect(session.getSnapshot().state?.attributes).toEqual({ authority: 1, input_errors: 1 });
    await unchangedOnRejected({ type: "completeStory", storyId: "final_choice_notice" });
    expect(await submit("final_choice_notice", "salute")).toMatchObject({ ok: true });
    expect(await submit("judgment_notice", "salute")).toMatchObject({ ok: true });
    expect(session.getSnapshot().state?.pendingStoryIds).toEqual(["ending_notice"]);
    expect(session.getSnapshot().state?.configurationFacts).toEqual(beforeInput.configurationFacts);
  });
  it("separates qualification from deterministic dispatch and commits the verdict, hook and selection together", async () => {
    const { session, saves } = await pilotSession();
    const before = session.getSnapshot().state!;
    expect(queryCasePool(before, CONFIGURATION_PILOT_GAME_CONTENT, "review_pool")).toMatchObject({
      ok: true,
      value: [
        { caseId: "deferred", eligible: false },
        { caseId: "followup", eligible: false },
      ],
    });
    expect(before.cases.followup).toBeUndefined();
    await preparePilotVerdict(session);
    expect(await session.dispatch(pilotVerdict)).toMatchObject({ ok: true });
    const committed = await saves.load("pilot-save", "pilot-profile");
    expect(committed?.revision).toBe(3);
    expect(committed?.state).toMatchObject({
      attributes: { authority: 1, input_errors: 0 },
      flags: { judged: true },
      cases: { intake: { status: "resolved" }, followup: { status: "pending" } },
      pendingStoryIds: ["judgment_notice"],
    });
    expect(committed?.state.cases.deferred).toBeUndefined();
    expect(committed?.state.configurationFacts).toHaveLength(4);
    expect(committed?.state.configurationFacts?.at(-1)).toMatchObject({
      event,
      hookIds: ["after_intake"],
      dispatch: { status: "dispatched", ruleId: "after_intake_dispatch", caseId: "followup" },
    });
    const state = session.getSnapshot().state!;
    const qualified = queryCasePool(state, CONFIGURATION_PILOT_GAME_CONTENT, "review_pool");
    expect(qualified).toMatchObject({
      ok: true,
      value: [{ eligible: false }, { eligible: true, predicates: [{ matches: true }] }],
    });
    expect(state).toEqual(committed?.state);
    expect(queryConfigurationEvent(state, CONFIGURATION_PILOT_GAME_CONTENT, event)).toMatchObject({
      ok: true,
      value: { dispatch: { status: "dispatched", caseId: "followup" } },
    });
    expect(applyConfigurationEvent(state, CONFIGURATION_PILOT_GAME_CONTENT, event)).toEqual({
      ok: true,
      value: state,
    });
    expect(await session.reload()).toMatchObject({ ok: true });
    expect(session.getSnapshot().state).toEqual(state);
  });

  it("requires the configured action after a wrong action and preserves retry across reload", async () => {
    const { session } = await pilotSession();
    await preparePilotVerdict(session);
    await session.dispatch(pilotVerdict);
    expect(
      await session.dispatch({ type: "completeStory", storyId: "judgment_notice" }),
    ).toMatchObject({ ok: false, code: "STORY_INPUT_REQUIRED" });
    expect(await session.dispatch(pilotInput("wave"))).toMatchObject({ ok: true });
    expect(session.getSnapshot().state).toMatchObject({
      attributes: { authority: 1, input_errors: 1 },
      flags: { action_mistake: true },
      pendingStoryIds: ["judgment_notice"],
      storyCheckpoint: { storyId: "judgment_notice", resumeStepId: "required_action" },
    });
    await session.reload();
    expect(await session.dispatch({ type: "startCase", caseId: "followup" })).toMatchObject({
      ok: false,
      code: "STORY_BLOCKING",
    });
    expect(
      await session.dispatch({ type: "completeStory", storyId: "judgment_notice" }),
    ).toMatchObject({ ok: false, code: "STORY_INPUT_REQUIRED" });
    expect(await session.dispatch(pilotInput("salute"))).toMatchObject({ ok: true });
    expect(session.getSnapshot().state?.completedStoryIds).toEqual(["judgment_notice"]);
    expect(await session.dispatch({ type: "startCase", caseId: "followup" })).toMatchObject({
      ok: true,
    });
  });

  it("returns explicit pending decisions for conflicting rules or an empty qualified pool", async () => {
    for (const reason of ["ruleConflict", "emptyPool"] as const) {
      const game = cloneGame();
      const configuration = game.configuration!;
      if (reason === "ruleConflict")
        configuration.dispatchRules.push({
          ...configuration.dispatchRules[0],
          id: "second_dispatch",
        });
      else
        configuration.casePools.review_pool.members.forEach(
          (member) =>
            (member.when = {
              all: [{ type: "attributeAtLeast", attributeId: "authority", value: 10 }],
            }),
        );
      const { session } = await pilotSession(undefined, game);
      await preparePilotVerdict(session);
      expect(await session.dispatch(pilotVerdict)).toMatchObject({ ok: true });
      const state = session.getSnapshot().state!;
      expect(state.cases.followup).toBeUndefined();
      expect(state.configurationFacts?.at(-1)?.dispatch).toMatchObject({
        status: "needsDecision",
        reason,
      });
      expect(state.phase).toEqual({ type: "playing" });
      expect(state.pendingStoryIds).toEqual(["judgment_notice"]);
      expect(queryConfigurationEvent(state, game, event)).toMatchObject({
        ok: true,
        value: { dispatch: { status: "needsDecision", reason } },
      });
    }
  });

  it("keeps later verdict ending selection identical after zero or several wrong actions", async () => {
    const outcomes = [];
    for (const mistakes of [0, 3]) {
      const game = cloneGame();
      game.stories.ending_notice = {
        skippable: false,
        steps: [{ id: "ending_text", type: "text" }],
      };
      game.endings.final = {
        priority: 1,
        when: { all: [{ type: "attributeAtLeast", attributeId: "authority", value: 2 }] },
        storyId: "ending_notice",
      };
      expect(validateGameContentCatalog(game).ok).toBe(true);
      const localizations = structuredClone(CONFIGURATION_PILOT_LOCALIZATIONS);
      for (const localized of Object.values(localizations)) {
        localized.stories.ending_notice = {
          title: "Ending notice",
          steps: { ending_text: { blocks: [{ type: "paragraph", text: "Run finished." }] } },
        };
        localized.endings.final = { title: "Completed" };
      }
      const { session } = await pilotSession(undefined, game, localizations);
      await preparePilotVerdict(session);
      await session.dispatch(pilotVerdict);
      for (let i = 0; i < mistakes; i++) await session.dispatch(pilotInput("wave"));
      await session.dispatch(pilotInput("salute"));
      await session.dispatch({ type: "startCase", caseId: "followup" });
      expect(
        await session.dispatch({
          type: "chooseOption",
          caseId: "followup",
          nodeId: "followup_judgment",
          choiceId: "finish_followup",
        }),
      ).toMatchObject({ ok: true });
      expect(session.getSnapshot().state?.attributes.input_errors).toBe(mistakes);
      outcomes.push(session.getSnapshot().state?.phase);
    }
    expect(outcomes).toEqual([
      { type: "ending", endingId: "final" },
      { type: "ending", endingId: "final" },
    ]);
  });
});

describe("strict configuration and localization validation", () => {
  it("rejects state coupling through every supported condition consumer and through verdict effects", () => {
    const mutations: ((game: GameContentCatalog) => void)[] = [
      (game) => {
        game.stories.judgment_notice.steps[1] = {
          ...game.stories.judgment_notice.steps[1],
          type: "actionInput",
          id: "required_action",
          targetActionId: "salute",
          wrongEffects: { attributeDeltas: { authority: 1 }, setFlags: {} },
        };
      },
      (game) => {
        game.cases.intake.resolutions.approved.effects.attributeDeltas.input_errors = 1;
      },
      (game) => {
        game.cases.intake.resolutions.approved.effects.setFlags.action_mistake = true;
      },
      (game) => {
        game.configuration!.casePools.review_pool.members[0].when = {
          all: [{ type: "attributeAtLeast", attributeId: "input_errors", value: 1 }],
        };
      },
      (game) => {
        game.configuration!.dispatchRules[0].when = {
          all: [{ type: "flagEquals", flagId: "action_mistake", value: true }],
        };
      },
      (game) => {
        game.unlockRules = [
          {
            id: "bad",
            when: { all: [{ type: "attributeAtLeast", attributeId: "input_errors", value: 1 }] },
            caseIds: ["followup"],
          },
        ];
      },
      (game) => {
        game.storyRules = [
          {
            id: "bad",
            when: { all: [{ type: "flagEquals", flagId: "action_mistake", value: true }] },
            storyId: "judgment_notice",
            order: 1,
          },
        ];
      },
      (game) => {
        game.endings.bad = {
          priority: 1,
          when: { all: [{ type: "attributeAtLeast", attributeId: "input_errors", value: 1 }] },
          storyId: "judgment_notice",
        };
      },
    ];
    for (const mutate of mutations) {
      const game = cloneGame();
      mutate(game);
      const result = validateGameContentCatalog(game);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.issues.some((issue) => issue.code === "CONFIGURATION_INVALID")).toBe(true);
    }
  });
  it.each(["toString", "constructor"])(
    "diagnoses inherited-name references %s without throwing",
    (id) => {
      const mutations: ((game: GameContentCatalog) => void)[] = [
        (game) => {
          game.configuration!.dispatchRules[0].poolId = id;
        },
        (game) => {
          game.configuration!.actionInputHooks[0].storyId = id;
        },
        (game) => {
          game.configuration!.actionInputHooks[0].event = { type: "caseStarted", caseId: id };
        },
        (game) => {
          game.configuration!.actionInputHooks[0].event = {
            type: "caseResolved",
            caseId: "intake",
            resolutionId: id,
          };
        },
        (game) => {
          game.configuration!.instructions.assessment_instruction.nodeId = id;
        },
        (game) => {
          game.configuration!.casePools.review_pool.members[0].caseId = id;
        },
      ];
      for (const mutate of mutations) {
        const game = cloneGame();
        mutate(game);
        expect(() => validateGameContentCatalog(game)).not.toThrow();
        expect(validateGameContentCatalog(game).ok).toBe(false);
      }
    },
  );
  it("rejects unused fields, missing instruction copy, a long-story hook and unsupported strategies", () => {
    const game = cloneGame();
    game.stories.judgment_notice.steps.push({ id: "extra", type: "text" });
    expect(validateGameContentCatalog(game).ok).toBe(false);
    expect(
      validateGameContentCatalog({
        ...cloneGame(),
        configuration: { ...cloneGame().configuration, freePayload: {} },
      }).ok,
    ).toBe(false);
    const localized = structuredClone(CONFIGURATION_PILOT_LOCALIZATIONS["en-US"]);
    delete localized.instructions;
    expect(validateLocalizedContentCatalog(localized, CONFIGURATION_PILOT_GAME_CONTENT).ok).toBe(
      false,
    );
    const strategyGame = cloneGame();
    Reflect.set(strategyGame.configuration!.dispatchRules[0], "strategy", { type: "random" });
    expect(validateGameContentCatalog(strategyGame).ok).toBe(false);
  });
});
