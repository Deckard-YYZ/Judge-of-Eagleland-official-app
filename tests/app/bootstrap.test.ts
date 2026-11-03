import { describe, expect, it, vi } from "vitest";

import { bootstrapApplication, type ApplicationBootstrapResult } from "../../src/app/bootstrap";
import type { ProfileEntry } from "../../src/application/profileEntry";
import type { StorageRepositories } from "../../src/storage";

const profileEntry = {} as ProfileEntry;

const storage = (close: () => Promise<void>): StorageRepositories =>
  ({
    database: { close },
    profiles: {},
    saves: {},
    settings: {},
  }) as StorageRepositories;

describe("application bootstrap", () => {
  it("preserves the original demo without automatic tutorial at the ordinary browser entry", async () => {
    const result = await bootstrapApplication({ detectRuntime: () => "browser" });
    const entered = await result.profileEntry.register("Default demo");
    if (!entered.ok) throw new Error(entered.error.message);
    expect(entered.session.getSnapshot().envelope!.contentRef).toEqual({
      packageId: "minimal-test-package",
      version: "1.3.0",
    });
    expect(entered.session.getSnapshot().state!.pendingStoryIds).not.toContain(
      "tutorial_voice_order",
    );
    expect(entered.session.getSnapshot().state!.mainFlow).toBeUndefined();
  });
  it("uses the explicit memory preview without opening desktop storage", async () => {
    const initializeStorage = vi.fn();
    const result = await bootstrapApplication({
      detectRuntime: () => "browser",
      initializeStorage,
      createDemoProfileEntry: () => profileEntry,
    });

    expect(result).toEqual({
      runtime: "browser",
      storageMode: "memory-preview",
      profileEntry,
    });
    expect(initializeStorage).not.toHaveBeenCalled();
  });

  it("keeps desktop initialization on SQLite and passes one repository set to Profile entry", async () => {
    const desktopStorage = storage(vi.fn(async () => undefined));
    const initializeStorage = vi.fn(async () => desktopStorage);
    const createDesktopProfileEntry = vi.fn(async () => profileEntry);

    const result = await bootstrapApplication({
      detectRuntime: () => "desktop",
      initializeStorage,
      createDesktopProfileEntry,
    });

    expect(result).toMatchObject({
      runtime: "desktop",
      storageMode: "sqlite",
      profileEntry,
      storage: desktopStorage,
    } satisfies Partial<ApplicationBootstrapResult>);
    expect(createDesktopProfileEntry).toHaveBeenCalledWith(desktopStorage, {
      tutorialEnabled: false,
    });
  });

  it("propagates storage failures instead of falling back to memory preview", async () => {
    const failure = new Error("SQLite unavailable");
    const createDemoProfileEntry = vi.fn(() => profileEntry);

    await expect(
      bootstrapApplication({
        detectRuntime: () => "desktop",
        initializeStorage: async () => Promise.reject(failure),
        createDemoProfileEntry,
      }),
    ).rejects.toBe(failure);
    expect(createDemoProfileEntry).not.toHaveBeenCalled();
  });

  it("closes the initialized database when Profile entry setup fails", async () => {
    const close = vi.fn(async () => undefined);
    const desktopStorage = storage(close);
    const failure = new Error("Profile load failed");

    await expect(
      bootstrapApplication({
        detectRuntime: () => "desktop",
        initializeStorage: async () => desktopStorage,
        createDesktopProfileEntry: async () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });
});
