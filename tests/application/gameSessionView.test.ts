import { describe, expect, it, vi } from "vitest";
import { createDemoSave, createDemoSession } from "../../src/app/demoSession";
import { demoTransition } from "../../src/app/demoTransition";
import { createGameSession } from "../../src/application/gameSession";
import { createGameSessionView } from "../../src/application/gameSessionView";
import {
  MINIMAL_GAME_CONTENT,
  MINIMAL_LOCALIZATIONS,
} from "../../src/content/fixtures/minimalCatalog";
import { FakeSplitContentRepository } from "../../src/content/repository";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import type { SaveRepository } from "../../src/storage/saveRepository";

describe("GameSessionView", () => {
  it("runs the complete demo identically in Chinese and English", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    const play = async (locale: "zh-CN" | "en-US") => {
      const demo = createDemoSession();
      const view = createGameSessionView(demo.session, demo.contentRepository, locale);
      await demo.reload();
      await view.setLocale(locale);
      await view.dispatch({ type: "startCase", caseId: "case_001" });
      await view.dispatch({
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "confirm_violation",
      });
      await view.dispatch({
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "disposition",
        choiceId: "formal_warning",
      });
      await view.dispatch({ type: "completeStory", storyId: "story_after_case_001" });
      await view.dispatch({ type: "startCase", caseId: "case_002" });
      await view.dispatch({
        type: "chooseOption",
        caseId: "case_002",
        nodeId: "assessment",
        choiceId: "request_review",
      });
      await view.dispatch({ type: "completeStory", storyId: "ending_balanced" });
      return view.getSnapshot();
    };

    try {
      const zh = await play("zh-CN");
      const en = await play("en-US");
      expect(en.state).toEqual(zh.state);
      expect(en.envelope?.revision).toBe(zh.envelope?.revision);
      expect(en.state?.phase).toEqual({ type: "ended", endingId: "balanced" });
      expect(zh.content?.endings.balanced.title).toBe("平衡的裁定");
      expect(en.content?.endings.balanced.title).toBe("A Balanced Judgment");
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes only presentation when locale changes", async () => {
    const { session, contentRepository, reload } = createDemoSession();
    const view = createGameSessionView(session, contentRepository, "zh-CN");
    await reload();
    await view.setLocale("zh-CN");
    view.selectCase("case_001");
    const before = view.getSnapshot();
    const beforeState = JSON.stringify(before.state);
    const beforeRevision = before.envelope?.revision;

    await view.setLocale("en-US");
    const after = view.getSnapshot();
    expect(after.content?.cases.case_001.title).toContain("Night Archive");
    expect(after.content?.cases.case_001.nodes.assessment.choices[0]).not.toHaveProperty("target");
    expect(JSON.stringify(after.state)).toBe(beforeState);
    expect(after.envelope?.revision).toBe(beforeRevision);
    expect(after.selectedCaseId).toBe("case_001");

    const command = await view.dispatch({ type: "startCase", caseId: "case_001" });
    expect(command.ok).toBe(true);
    expect(view.getSnapshot().envelope?.revision).toBe((beforeRevision ?? 0) + 1);
  });

  it("falls back to the rules default locale without changing state", async () => {
    const demo = createDemoSession();
    const missingEnglish = {
      loadGameContent: demo.contentRepository.loadGameContent.bind(demo.contentRepository),
      loadLocalization: async (
        ref: Parameters<typeof demo.contentRepository.loadLocalization>[0],
        locale: Parameters<typeof demo.contentRepository.loadLocalization>[1],
      ) => {
        if (locale === "en-US") throw new Error("missing language pack");
        return demo.contentRepository.loadLocalization(ref, locale);
      },
    };
    const view = createGameSessionView(demo.session, missingEnglish, "zh-CN");
    await demo.reload();
    await view.setLocale("zh-CN");
    const facts = JSON.stringify(view.getSnapshot().state);

    await view.setLocale("en-US");
    expect(view.getSnapshot()).toMatchObject({
      localizationStatus: "fallback",
      localizationError: {
        code: "LOCALIZATION_LOAD_FAILED",
        requestedLocale: "en-US",
      },
    });
    expect(view.getSnapshot().content?.locale).toBe("zh-CN");
    expect(JSON.stringify(view.getSnapshot().state)).toBe(facts);
  });

  it("preserves session statuses, owns selection and forwards post-save feedback", async () => {
    const { session, contentRepository, reload } = createDemoSession();
    const view = createGameSessionView(session, contentRepository);
    const statuses: string[] = [];
    view.subscribe(() => statuses.push(view.getSnapshot().status));

    expect(view.getSnapshot()).toMatchObject({ status: "idle", selectedCaseId: null });
    const loading = reload();
    expect(view.getSnapshot()).toMatchObject({ status: "loading", selectedCaseId: null });
    await loading;
    expect(view.getSnapshot()).toMatchObject({ status: "ready", selectedCaseId: null });
    expect("selectedCaseId" in (view.getSnapshot().state ?? {})).toBe(false);
    expect(view.getSnapshot()).toBe(view.getSnapshot());

    view.selectCase("case_002");
    expect(view.getSnapshot().selectedCaseId).toBeNull();
    view.selectCase("case_001");
    expect(view.getSnapshot().selectedCaseId).toBe("case_001");

    const starting = view.dispatch({ type: "startCase", caseId: "case_001" });
    expect(view.getSnapshot().status).toBe("saving");
    view.selectCase(null);
    expect(view.getSnapshot().selectedCaseId).toBe("case_001");
    await starting;

    await view.dispatch({
      type: "chooseOption",
      caseId: "case_001",
      nodeId: "assessment",
      choiceId: "confirm_violation",
    });
    const feedback = vi.fn();
    const unsubscribe = view.subscribeFeedback(feedback);
    await view.dispatch({
      type: "chooseOption",
      caseId: "case_001",
      nodeId: "disposition",
      choiceId: "formal_warning",
    });
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(view.getSnapshot().state?.cases.case_002).toEqual({ status: "pending" });

    view.selectCase("case_002");
    expect(view.getSnapshot().selectedCaseId).toBe("case_002");
    unsubscribe();
    expect(statuses).toContain("loading");
    expect(statuses).toContain("saving");
    expect(statuses.at(-1)).toBe("ready");
  });

  it("retains committed data in needsReload and clears selection in error", async () => {
    const seed = createDemoSave(
      "demo-profile",
      "demo-save",
      MINIMAL_GAME_CONTENT,
      "2026-09-15T00:00:00.000Z",
    );
    const memoryRepository = new InMemorySaveRepository([seed]);
    let makeCommitUncertain = false;
    const saveRepository: SaveRepository = {
      load: (saveId, profileId) => memoryRepository.load(saveId, profileId),
      create: (save) => memoryRepository.create(save),
      commit: (input) =>
        makeCommitUncertain
          ? Promise.reject(new Error("uncertain write"))
          : memoryRepository.commit(input),
    };
    const session = createGameSession({
      saveRepository,
      contentRepository: new FakeSplitContentRepository([
        { gameContent: MINIMAL_GAME_CONTENT, localizations: MINIMAL_LOCALIZATIONS },
      ]),
      transition: demoTransition,
      clock: () => "2026-09-15T00:00:00.000Z",
    });
    const viewRepository = new FakeSplitContentRepository([
      { gameContent: MINIMAL_GAME_CONTENT, localizations: MINIMAL_LOCALIZATIONS },
    ]);
    const view = createGameSessionView(session, viewRepository);

    await session.load(seed.saveId, seed.profileId);
    view.selectCase("case_001");
    makeCommitUncertain = true;
    await view.dispatch({ type: "startCase", caseId: "case_001" });
    expect(view.getSnapshot()).toMatchObject({
      status: "needsReload",
      selectedCaseId: "case_001",
      envelope: { saveId: "demo-save" },
      error: { code: "RELOAD_REQUIRED" },
    });

    await session.load("missing", seed.profileId);
    expect(view.getSnapshot()).toMatchObject({
      status: "error",
      selectedCaseId: null,
      envelope: null,
      state: null,
      content: null,
      error: { code: "SAVE_NOT_FOUND" },
    });
  });
});
