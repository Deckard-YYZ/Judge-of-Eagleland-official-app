import { readFile, mkdir, mkdtemp, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
} from "../../src/content/validate";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import { buildContent } from "../../scripts/content/build";
import type { GameContentCatalog } from "../../src/content/schema";
const directory = path.resolve("content/mainflow-short/0.1.0");
const read = async () =>
  JSON.parse(await readFile(path.join(directory, "game.json"), "utf8")) as GameContentCatalog;

describe("schema 6 main-flow authoring validation", () => {
  it("loads the real bilingual package, with three reachable rounds in A and B", async () => {
    const sources = await Promise.all(
      ["game.json", "locales/zh-CN.json", "locales/en-US.json"].map(async (source) => ({
        source,
        text: await readFile(path.join(directory, source), "utf8"),
      })),
    );
    const loaded = loadSplitContentPackage(sources);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    for (const id of ["case-a", "case-b"]) {
      const definition = loaded.gameContent.cases[id];
      let nodeId = definition.startNodeId,
        count = 0;
      while (true) {
        const choice = definition.nodes[nodeId].choices[0];
        count++;
        if (choice.target.type === "resolution") break;
        nodeId = choice.target.nodeId;
      }
      expect(count).toBe(3);
    }
  });
  it("rejects a schema-5 flow mixed into the main-flow catalog", async () => {
    const game = await read();
    const legacy = JSON.parse(
      await readFile("content/configuration-complete/0.1.0/game.json", "utf8"),
    ) as GameContentCatalog;
    game.configuration!.flow = legacy.configuration!.flow;
    expect(validateGameContentCatalog(game).ok).toBe(false);
  });
  it("rejects a missing declared language file", async () => {
    const sources = await Promise.all(
      ["game.json", "locales/zh-CN.json"].map(async (source) => ({
        source,
        text: await readFile(path.join(directory, source), "utf8"),
      })),
    );
    const loaded = loadSplitContentPackage(sources);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok)
      expect(
        loaded.issues.some(
          (issue) =>
            issue.code === "CONTENT_PACKAGE_FILE_MISSING" && issue.source === "locales/en-US.json",
        ),
      ).toBe(true);
  });
  it.each([
    [
      "main cycle",
      (g: GameContentCatalog) => {
        g.mainFlow!.nodes.done.transitions.push({
          id: "cycle",
          when: { all: [{ type: "resolvedCountAtLeast", count: 0 }] },
          targetNodeId: "start",
        });
      },
    ],
    [
      "unknown result",
      (g: GameContentCatalog) => {
        g.mainFlow!.nodes.start.transitions[0].when = {
          all: [{ type: "chatResult", instanceId: "instance-a", resultId: "missing" }],
        };
      },
    ],
    [
      "duplicate instance",
      (g: GameContentCatalog) => {
        g.mainFlow!.nodes.done.onEnter.push({
          type: "startChat",
          chatId: "chat-a",
          instanceId: "instance-a",
        });
      },
    ],
    [
      "missing target",
      (g: GameContentCatalog) => {
        g.mainFlow!.nodes.start.transitions[0].targetNodeId = "missing";
      },
    ],
    [
      "unreachable chat",
      (g: GameContentCatalog) => {
        g.mainFlow!.chats["chat-a"].nodes.orphan = { type: "terminal", resultId: "orphan" };
      },
    ],
    [
      "local effect",
      (g: GameContentCatalog) => {
        Object.assign(g.mainFlow!.chats["chat-a"].nodes.hello, { effects: { setFlags: {} } });
      },
    ],
    [
      "external branch",
      (g: GameContentCatalog) => {
        Object.assign(g.mainFlow!.chats["chat-a"], { externalBranches: [] });
      },
    ],
    [
      "legacy dispatch",
      (g: GameContentCatalog) => {
        g.initial.caseIds.push("case-a");
      },
    ],
    [
      "multiple dispatch",
      (g: GameContentCatalog) => {
        g.mainFlow!.nodes.start.onEnter.push({ type: "dispatchCase", caseId: "case-b" });
      },
    ],
    [
      "nonterminating chat",
      (g: GameContentCatalog) => {
        g.mainFlow!.chats["chat-a"].nodes.detail = {
          type: "message",
          replies: [{ id: "loop", targetNodeId: "hello" }],
        };
      },
    ],
  ] as const)("rejects %s", async (_name, mutate) => {
    const game = await read();
    mutate(game);
    expect(validateGameContentCatalog(game).ok).toBe(false);
  });
  it.each(["news", "initial", "storyRule", "hook", "tutorial", "ending"] as const)(
    "rejects action story shared with %s",
    async (owner) => {
      const game = await read(),
        storyId = "news-ack",
        when = { all: [{ type: "resolvedCountAtLeast" as const, count: 1 }] };
      switch (owner) {
        case "news":
          game.mainFlow!.news.other = { actionStoryId: storyId };
          break;
        case "initial":
          game.initial.storyIds.push(storyId);
          break;
        case "storyRule":
          game.storyRules.push({ id: "shared", storyId, when, order: 1 });
          break;
        case "hook":
          game.configuration!.actionInputHooks.push({
            id: "shared",
            storyId,
            event: { type: "caseStarted", caseId: "case-a" },
          });
          break;
        case "tutorial":
          game.mainFlow!.tutorialStoryId = storyId;
          break;
        case "ending":
          game.endings.shared = { priority: 1, storyId, when };
          break;
      }
      const result = validateGameContentCatalog(game);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((i) => i.message.includes("exclusive"))).toBe(true);
    },
  );
  it.each(["news", "initial", "storyRule", "hook", "ending"] as const)(
    "rejects tutorial story shared with %s and identifies both owners",
    async (owner) => {
      const game = await read();
      const storyId = game.mainFlow!.tutorialStoryId!;
      const when = { all: [{ type: "resolvedCountAtLeast" as const, count: 1 }] };
      const sources = {
        news: "mainFlow.news.shared",
        initial: "initial.storyIds",
        storyRule: "storyRules.shared",
        hook: "actionInputHooks.shared",
        ending: "endings.shared",
      };
      switch (owner) {
        case "news":
          game.mainFlow!.news.shared = { actionStoryId: storyId };
          break;
        case "initial":
          game.initial.storyIds.push(storyId);
          break;
        case "storyRule":
          game.storyRules.push({ id: "shared", storyId, when, order: 1 });
          break;
        case "hook":
          game.configuration!.actionInputHooks.push({
            id: "shared",
            storyId,
            event: { type: "caseStarted", caseId: "case-a" },
          });
          break;
        case "ending":
          game.endings.shared = { priority: 1, storyId, when };
          break;
      }
      const result = validateGameContentCatalog(game);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((entry) =>
          entry.message.startsWith("Tutorial story must be exclusive"),
        );
        expect(issue?.message).toContain(sources[owner]);
        expect(issue?.message).toContain("mainFlow.tutorialStoryId");
      }
    },
  );
  it("rejects missing terminal, reply and news translations", async () => {
    const game = await read();
    for (const field of ["terminal", "reply", "news"]) {
      const copy = JSON.parse(await readFile(path.join(directory, "locales/en-US.json"), "utf8"));
      if (field === "terminal") delete copy.mainFlow.chats["chat-a"].nodes.closed;
      if (field === "reply") delete copy.mainFlow.chats["chat-a"].nodes.hello.replies.ack;
      if (field === "news") delete copy.mainFlow.news["news-n"];
      expect(validateLocalizedContentCatalog(copy, game).ok).toBe(false);
    }
  });
});

describe.skipIf(!process.env.LUBAN_ROOT)("real schema 6 XLSX through pinned Luban", () => {
  it("regenerates exact output and rejects bad local references without replacing output", async () => {
    await mkdir("artifacts/content-authoring/tests", { recursive: true });
    const scratch = await mkdtemp(path.resolve("artifacts/content-authoring/tests/mainflow-"));
    const source = path.join(scratch, "source"),
      output = path.join(scratch, "mainflow-short/0.1.0");
    await cp("content-authoring/samples/mainflow-short", source, { recursive: true });
    const options = { source, output, lubanRoot: process.env.LUBAN_ROOT! };
    await buildContent(options);
    await buildContent({ ...options, check: true });
    const before = await readFile(path.join(output, "game.json"), "utf8");
    const rules = JSON.parse(await readFile(path.join(source, "rules.json"), "utf8"));
    rules.chatNodes["chat-a"].hello.replies.push({ id: "broken", targetNodeId: "missing" });
    await writeFile(path.join(source, "rules.json"), JSON.stringify(rules));
    await expect(buildContent(options)).rejects.toThrow(
      /rules.json.*chat-a.*Unknown local reply target/,
    );
    expect(await readFile(path.join(output, "game.json"), "utf8")).toBe(before);
  }, 180_000);
});
