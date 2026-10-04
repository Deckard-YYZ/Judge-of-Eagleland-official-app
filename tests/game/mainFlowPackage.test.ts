import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import { mainFlowSession } from "../fixtures/mainFlow";
import type { GameCommand } from "../../src/game/commands";

function authoredFixture() {
  const loaded = loadSplitContentPackage(
    ["game.json", "locales/zh-CN.json", "locales/en-US.json"].map((source) => ({
      source,
      text: readFileSync(
        new URL(`../../content/mainflow-short/0.1.0/${source}`, import.meta.url),
        "utf8",
      ),
    })),
    { expectedPackageId: "mainflow-short", expectedVersion: "0.1.0" },
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  return { game: loaded.gameContent, localizations: loaded.localizations };
}

describe("the generated mainflow-short package through real Core and Session", () => {
  it.each(["normal", "ignored"])(
    "runs the %s branch, independent concurrent chats, news action, and the complete case path",
    async (branch) => {
      const { session } = await mainFlowSession(undefined, authoredFixture());
      const send = async (command: GameCommand) =>
        expect(await session.dispatch(command)).toMatchObject({ ok: true });
      const choose = (caseId: string, round: number) =>
        send({
          type: "chooseOption",
          caseId,
          nodeId: `${caseId}-${round}`,
          choiceId: `${caseId}-choose-${round}`,
        });
      await send({ type: "readNews", newsId: "news-n" });
      await send({
        type: "submitStoryInput",
        storyId: "news-ack",
        stepId: "ack",
        actionId: "salute",
      });
      await send({ type: "startCase", caseId: "case-a" });
      await choose("case-a", 1);
      expect(session.getSnapshot().state!.mainFlow!.chats["instance-a"].inactivityChoices).toBe(1);
      await send({ type: "replyChat", instanceId: "instance-a", nodeId: "hello", replyId: "ack" });
      expect(session.getSnapshot().state!.mainFlow!.chats["instance-a"].inactivityChoices).toBe(0);
      if (branch === "normal")
        await send({
          type: "replyChat",
          instanceId: "instance-a",
          nodeId: "detail",
          replyId: "finish",
        });
      await choose("case-a", 2);
      await choose("case-a", 3);
      expect(session.getSnapshot().state!.mainFlow!.chatResults["instance-a"].resultId).toBe(
        branch,
      );
      expect(session.getSnapshot().state!.mainFlow!.currentNodeId).toBe("special");
      const afterA = session.getSnapshot().state;
      await session.reload();
      expect(session.getSnapshot().state).toEqual(afterA);
      await send({ type: "startCase", caseId: "case-b" });
      await choose("case-b", 1);
      await send({ type: "replyChat", instanceId: "instance-b", nodeId: "hello", replyId: "ack" });
      await choose("case-b", 2);
      expect(session.getSnapshot().state!.mainFlow!.chatResults["instance-c"].resultId).toBe(
        "ignored",
      );
      expect(session.getSnapshot().state!.mainFlow!.chats["instance-b"].inactivityChoices).toBe(1);
      await choose("case-b", 3);
      expect(session.getSnapshot().state!.mainFlow!.currentNodeId).toBe("followup");
      await send({ type: "startCase", caseId: "case-c" });
      for (const round of [1, 2, 3]) await choose("case-c", round);
      expect(session.getSnapshot().state!.mainFlow!.currentNodeId).toBe("done");
      expect(session.getSnapshot().state!.phase.type).toBe("playing");
      expect(
        session.getSnapshot().state!.mainFlow!.dispatches.map((entry) => entry.caseId),
      ).toEqual(["case-a", "case-b", "case-c"]);
    },
  );
});
