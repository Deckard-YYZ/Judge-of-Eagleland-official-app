import type { ChatVariant } from "../ui/presentation/chat/chatVariant";
import mainGame from "../../content/mainflow-short/0.1.3/game.json";
import mainZh from "../../content/mainflow-short/0.1.3/locales/zh-CN.json";
import mainEn from "../../content/mainflow-short/0.1.3/locales/en-US.json";
import {
  CONFIGURATION_PILOT_GAME_CONTENT,
  CONFIGURATION_PILOT_LOCALIZATIONS,
  createConfigurationPilotProfileEntry,
} from "./configurationPilot";
import { createMemoryProfileEntry } from "./demoProfiles";
import { loadSplitContentPackage } from "../content/localizedPackageFormat";
import { transition } from "../game/transition";
import type { GameContentCatalog, ContentLocale, LocalizedContentCatalog } from "../content/schema";
import type { ModulePreviewId } from "./debugPreviewRoutes";
import type { BrowserBootstrapResult } from "./bootstrap";
import type { ProfileEntryResult } from "../application/profileEntry";

type ModulePreviewBootstrapResult = BrowserBootstrapResult & {
  initialSession: Extract<ProfileEntryResult, { ok: true }>;
  mainFlowOverlays?: boolean;
};

/** DEV-only composition: reuse installed pilot content and real application commands. */
export async function bootstrapInstructionPreview(): Promise<ModulePreviewBootstrapResult> {
  const profileEntry = createConfigurationPilotProfileEntry();
  const profile = profileEntry.getSnapshot().profiles[0];
  const entered = await profileEntry.enter(profile.profileId);
  if (!entered.ok) throw new Error(entered.error.message);
  const started = await entered.session.dispatch({ type: "startCase", caseId: "intake" });
  if (!started.ok) throw new Error(started.message);
  entered.session.selectCase("intake");
  return {
    runtime: "browser",
    storageMode: "memory-preview",
    profileEntry,
    initialSession: entered,
  };
}

/** Scenario configuration changes initial declarations, never an initialized GameState. */
export async function bootstrapModulePreview(
  id: ModulePreviewId,
  chatVariant?: ChatVariant,
): Promise<ModulePreviewBootstrapResult> {
  if (id === "instructions") return bootstrapInstructionPreview();
  const pilot = id === "story";
  const game = structuredClone(
    pilot ? CONFIGURATION_PILOT_GAME_CONTENT : mainGame,
  ) as GameContentCatalog;
  const copies = structuredClone(
    pilot ? CONFIGURATION_PILOT_LOCALIZATIONS : { "zh-CN": mainZh, "en-US": mainEn },
  ) as Record<ContentLocale, LocalizedContentCatalog>;
  const withCase = id === "chat-ignored" || id === "dispatch";
  const withChats = id === "chat-single" || id === "chat-multiple" || id === "chat-ignored";
  game.initial = {
    ...game.initial,
    caseIds: [],
    storyIds: pilot ? ["judgment_notice"] : id === "action" ? ["news-ack"] : [],
  };
  if (game.mainFlow) {
    game.mainFlow.initialNodeId = "module-preview";
    game.mainFlow.casePools = {};
    game.mainFlow.nodes = {
      "module-preview": {
        stageId: "module-preview",
        onEnter: id === "news" ? [{ type: "publishNews", newsId: "news-n" }] : [],
        transitions: [],
      },
    };
    if (id !== "tutorial") delete game.mainFlow.tutorialStoryId;
    // The standalone action owns this story instead of the bulletin's read trigger.
    if (id === "action") delete game.mainFlow.news["news-n"].actionStoryId;
  }

  if (withCase || withChats) {
    const flow = game.mainFlow!;
    const entry = flow.nodes["module-preview"];
    if (withCase) entry.onEnter.push({ type: "dispatchCase", caseId: "case-a" });
    if (withChats) {
      const chatIds = id === "chat-multiple" ? ["chat-b", "chat-c"] : ["chat-a"];
      for (const chatId of chatIds)
        entry.onEnter.push({ type: "startChat", chatId, instanceId: `preview-${chatId}` });
    }
    if (id === "dispatch") {
      entry.transitions.push({
        id: "case-completed",
        when: { all: [{ type: "caseResolved", caseId: "case-a" }] },
        targetNodeId: "dispatched",
      });
      flow.casePools = {
        "pool-p": {
          members: [
            { caseId: "case-b", when: { all: [{ type: "caseResolved", caseId: "case-a" }] } },
          ],
        },
      };
      flow.nodes.dispatched = {
        stageId: "dispatched",
        onEnter: [
          { type: "openPool", poolId: "pool-p" },
          {
            type: "dispatchPool",
            poolId: "pool-p",
            strategy: { type: "ordered", caseIds: ["case-b"] },
          },
        ],
        transitions: [],
      };
    }
    if (withCase) {
      copies["zh-CN"].cases["case-a"].summary.unshift({
        type: "paragraph",
        text:
          id === "chat-ignored"
            ? "验证步骤：暂不回复右侧聊天，连续完成本案两次裁定选择。真实无交互计数达到 2 后，聊天会结束并保留 4 秒告别状态。可通过诊断重新验证。"
            : "验证步骤：依次完成本案三次裁定选择。案卷 A 由主线直接派发，结案后主线规则会从案卷池派发案卷 B；请在未处理文档列表核对。可通过诊断重新验证。",
      });
      copies["en-US"].cases["case-a"].summary.unshift({
        type: "paragraph",
        text:
          id === "chat-ignored"
            ? "Validation: leave the chat unanswered and make two choices in this case. The real inactivity count reaches 2, retiring the chat with a four-second farewell. Restart from Diagnostics."
            : "Validation: complete the three choices in this case. Case A is dispatched directly by the main flow; resolution triggers Case B from its pool. Check the pending documents list. Restart from Diagnostics.",
      });
    }
  }
  if (pilot) {
    game.configuration!.actionInputHooks = [];
    game.configuration!.dispatchRules = [];
  }
  if (chatVariant && withChats) {
    for (const [chatId, chat] of Object.entries(game.mainFlow!.chats)) {
      chat.nodes.hello = {
        type: "message",
        replies: [
          { id: "ack", targetNodeId: "detail" },
          { id: "disconnect", targetNodeId: "disconnected" },
        ],
      };
      chat.nodes.detail = {
        type: "message",
        replies: [
          { id: "finish", targetNodeId: "closed" },
          { id: "disconnect", targetNodeId: "disconnected" },
        ],
      };
      chat.nodes.disconnected = { type: "terminal", resultId: "normal" };
      for (const locale of ["zh-CN", "en-US"] as const) {
        const zh = locale === "zh-CN";
        const nodes = copies[locale].mainFlow!.chats[chatId].nodes;
        nodes.hello = {
          blocks: [
            {
              type: "paragraph",
              text: zh
                ? "我借用了你的动作按钮与你核对档案。点击「敬礼」表示继续接收我的消息，点击「挥手」表示停止联系。"
                : "I have borrowed your action buttons to check the record with you. Select Salute to keep receiving my messages, or Wave to end contact.",
            },
          ],
          replies: { ack: zh ? "敬礼" : "Salute", disconnect: zh ? "挥手" : "Wave" },
        };
        nodes.detail = {
          blocks: [
            {
              type: "paragraph",
              text: zh
                ? "档案核对完毕。点击「敬礼」确认收到并结束本次联系；点击「挥手」直接停止联系。"
                : "The record check is complete. Select Salute to acknowledge receipt and finish, or Wave to end contact directly.",
            },
          ],
          replies: { finish: zh ? "敬礼" : "Salute", disconnect: zh ? "挥手" : "Wave" },
        };
        nodes.closed = {
          blocks: [
            {
              type: "paragraph",
              text: zh
                ? "已收到你的确认，本次联系结束。"
                : "Your acknowledgement was received. This contact is complete.",
            },
          ],
          replies: {},
        };
        nodes.disconnected = {
          blocks: [
            {
              type: "paragraph",
              text: zh
                ? "你选择停止联系。不会继续发送消息。"
                : "You chose to end contact. No further messages will be sent.",
            },
          ],
          replies: {},
        };
      }
    }
  }
  if (id === "attributes") {
    game.attributes = {
      authority: { initial: 75, min: 0, max: 100 },
      demo_two: { initial: 25, min: 0, max: 100 },
      demo_three: { initial: 50, min: 0, max: 100 },
    };
    copies["zh-CN"].attributes = {
      authority: { label: "一" },
      demo_two: { label: "二" },
      demo_three: { label: "三" },
    };
    copies["en-US"].attributes = {
      authority: { label: "One" },
      demo_two: { label: "Two" },
      demo_three: { label: "Three" },
    };
  }
  const loaded = loadSplitContentPackage([
    { source: "game.json", text: JSON.stringify(game) },
    ...Object.entries(copies).map(([locale, copy]) => ({
      source: `locales/${locale}.json`,
      text: JSON.stringify(copy),
    })),
  ]);
  if (!loaded.ok) throw new Error(loaded.issues.map((issue) => issue.message).join("; "));
  const profileEntry = createMemoryProfileEntry({
    gameContent: loaded.gameContent,
    localizations: loaded.localizations,
    tutorialEnabled: id === "tutorial",
    transition,
  });
  const entered = await profileEntry.enter(profileEntry.getSnapshot().profiles[0].profileId);
  if (!entered.ok) throw new Error(entered.error.message);
  if (withCase) {
    const started = await entered.session.dispatch({ type: "startCase", caseId: "case-a" });
    if (!started.ok) throw new Error(started.message);
    entered.session.selectCase("case-a");
  }
  return {
    runtime: "browser",
    storageMode: "memory-preview",
    profileEntry,
    initialSession: entered,
    mainFlowOverlays: id === "news" || withChats,
  };
}
