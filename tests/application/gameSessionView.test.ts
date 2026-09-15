import { describe, expect, it, vi } from "vitest";
import { createDemoSave, createDemoSession } from "../../src/app/demoSession";
import { demoTransition } from "../../src/app/demoTransition";
import { createGameSession } from "../../src/application/gameSession";
import { createGameSessionView } from "../../src/application/gameSessionView";
import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import { FakeContentRepository } from "../../src/content/repository";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import type { SaveRepository } from "../../src/storage/saveRepository";

describe("GameSessionView", () => {
  it("preserves session statuses, owns selection and forwards post-save feedback", async () => {
    const { session, reload } = createDemoSession();
    const view = createGameSessionView(session);
    const statuses: string[] = [];
    view.subscribe(() => statuses.push(view.getSnapshot().status));

    expect(view.getSnapshot()).toMatchObject({ status: "idle", selectedCaseId: null });
    const loading = reload();
    expect(view.getSnapshot()).toMatchObject({ status: "loading", selectedCaseId: null });
    await loading;
    expect(view.getSnapshot()).toMatchObject({ status: "ready", selectedCaseId: "case_001" });
    expect("selectedCaseId" in (view.getSnapshot().state ?? {})).toBe(false);
    expect(view.getSnapshot()).toBe(view.getSnapshot());

    view.selectCase("case_002");
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
      MINIMAL_CATALOG,
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
      contentRepository: new FakeContentRepository([MINIMAL_CATALOG]),
      transition: demoTransition,
      clock: () => "2026-09-15T00:00:00.000Z",
    });
    const view = createGameSessionView(session);

    await session.load(seed.saveId, seed.profileId);
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
