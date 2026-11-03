import { expect, it } from "vitest";
import { GameConfigurationSchema } from "../../src/content/schema";
import oldPilot from "../../content/configuration-pilot/0.1.0/game.json";
import newPilot from "../../content/configuration-pilot/0.1.2/game.json";
import oldFlow from "../../content/mainflow-short/0.1.0/game.json";
import newFlow from "../../content/mainflow-short/0.1.2/game.json";
it("accepts 300–2000ms author delays, preserves old packages and publishes short waits in new refs", () => {
  for (const delayMs of [300, 800, 1000, 1500, 2000]) {
    const config = structuredClone(newPilot.configuration);
    config.instructions.assessment_instruction.delayMs = delayMs;
    expect(GameConfigurationSchema.safeParse(config).success).toBe(true);
  }
  for (const delayMs of [299, 2001]) {
    const config = structuredClone(newPilot.configuration);
    config.instructions.assessment_instruction.delayMs = delayMs;
    expect(GameConfigurationSchema.safeParse(config).success).toBe(false);
  }
  expect(oldPilot.configuration.instructions.assessment_instruction.delayMs).toBe(1500);
  expect(oldFlow.configuration.instructions["first-instruction"].delayMs).toBe(1200);
  expect(newPilot.configuration.instructions.assessment_instruction.delayMs).toBe(800);
  expect(newFlow.configuration.instructions["first-instruction"].delayMs).toBe(800);
});
