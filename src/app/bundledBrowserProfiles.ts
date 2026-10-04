import {
  BundledSplitContentRepository,
  DEFAULT_BUNDLED_CONTENT_REF,
} from "../content/bundledRepository";
import { transition } from "../game/transition";
import { createMemoryProfileEntry } from "./demoProfiles";
import type { ContentRef } from "../content/schema";

const installedJson = import.meta.glob<string>(
  ["../../content/minimal-test-package/**/*.json", "../../content/mainflow-short/**/*.json"],
  { query: "?raw", import: "default" },
);

/** Browser preview uses the same installed content and production rules as desktop. */
export async function createBundledBrowserProfileEntry(
  ref: ContentRef = DEFAULT_BUNDLED_CONTENT_REF,
) {
  const repository = new BundledSplitContentRepository(async ({ packageId, version }) => {
    const prefix = `../../content/${packageId}/${version}/`;
    const files = Object.entries(installedJson).filter(([path]) => path.startsWith(prefix));
    return {
      sources: await Promise.all(
        files.map(async ([path, load]) => ({
          source: path.slice(prefix.length),
          text: await load(),
        })),
      ),
      fileInventory: files.map(([path]) => path.slice(prefix.length)),
    };
  });
  const gameContent = await repository.loadGameContent(ref);
  const [zhCn, enUs] = await Promise.all([
    repository.loadLocalization(ref, "zh-CN"),
    repository.loadLocalization(ref, "en-US"),
  ]);
  return createMemoryProfileEntry({
    gameContent,
    localizations: { "zh-CN": zhCn, "en-US": enUs },
    transition,
  });
}
