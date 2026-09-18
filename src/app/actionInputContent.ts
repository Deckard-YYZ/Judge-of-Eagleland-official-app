import game from "../../content/minimal-test-package/1.2.0/game.json";
import zhCn from "../../content/minimal-test-package/1.2.0/locales/zh-CN.json";
import enUs from "../../content/minimal-test-package/1.2.0/locales/en-US.json";
import { GameContentCatalogSchema, LocalizedContentCatalogSchema } from "../content/schema";

/** Browser demos and desktop integration share the same versioned physical content package. */
export const ACTION_INPUT_GAME_CONTENT = GameContentCatalogSchema.parse(game);
export const ACTION_INPUT_LOCALIZATIONS = {
  "zh-CN": LocalizedContentCatalogSchema.parse(zhCn),
  "en-US": LocalizedContentCatalogSchema.parse(enUs),
} as const;
