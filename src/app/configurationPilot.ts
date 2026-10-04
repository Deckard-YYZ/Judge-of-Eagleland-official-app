import game from "../../content/configuration-pilot/0.1.0/game.json";
import zhCn from "../../content/configuration-pilot/0.1.0/locales/zh-CN.json";
import enUs from "../../content/configuration-pilot/0.1.0/locales/en-US.json";
import { loadSplitContentPackage } from "../content/localizedPackageFormat";
import { transition } from "../game/transition";
import { createMemoryProfileEntry } from "./demoProfiles";

const loaded = loadSplitContentPackage(
  [
    { source: "game.json", text: JSON.stringify(game) },
    { source: "locales/zh-CN.json", text: JSON.stringify(zhCn) },
    { source: "locales/en-US.json", text: JSON.stringify(enUs) },
  ],
  { expectedPackageId: "configuration-pilot", expectedVersion: "0.1.0" },
);
if (!loaded.ok) throw new Error(`CONFIGURATION_PILOT_INVALID: ${loaded.issues[0].message}`);
export const CONFIGURATION_PILOT_GAME_CONTENT = loaded.gameContent;
export const CONFIGURATION_PILOT_LOCALIZATIONS = loaded.localizations;

/** The explicit browser sample uses the production Core, Session, View, and App. */
export const createConfigurationPilotProfileEntry = () =>
  createMemoryProfileEntry({
    tutorialEnabled: false,
    gameContent: CONFIGURATION_PILOT_GAME_CONTENT,
    localizations: CONFIGURATION_PILOT_LOCALIZATIONS,
    transition,
  });
