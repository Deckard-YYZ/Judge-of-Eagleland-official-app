import game from "../../content/configuration-complete/0.1.0/game.json";
import zh from "../../content/configuration-complete/0.1.0/locales/zh-CN.json";
import en from "../../content/configuration-complete/0.1.0/locales/en-US.json";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";

export const COMPLETE_INVENTORY = [
  "game.json",
  "locales/zh-CN.json",
  "locales/en-US.json",
  "media/portrait.png",
  "media/notification.wav",
];
const loaded = loadSplitContentPackage(
  [
    { source: "game.json", text: JSON.stringify(game) },
    { source: "locales/zh-CN.json", text: JSON.stringify(zh) },
    { source: "locales/en-US.json", text: JSON.stringify(en) },
  ],
  { fileInventory: COMPLETE_INVENTORY },
);
if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
export const COMPLETE_GAME = loaded.gameContent;
export const COMPLETE_LOCALES = loaded.localizations;
