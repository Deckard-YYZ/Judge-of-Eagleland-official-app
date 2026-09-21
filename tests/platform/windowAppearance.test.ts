import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { detectRuntime } from "../../src/platform/runtime";
import { syncWindowTheme } from "../../src/platform/windowAppearance";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../../src/platform/runtime", () => ({ detectRuntime: vi.fn() }));
const setTheme = vi.fn<(theme: string) => Promise<void>>();

beforeEach(() => {
  vi.clearAllMocks();
  setTheme.mockReset().mockResolvedValue(undefined);
  vi.mocked(detectRuntime).mockReturnValue({ kind: "tauri", supportsSqlite: true });
  vi.mocked(getCurrentWindow).mockReturnValue({ setTheme } as unknown as ReturnType<
    typeof getCurrentWindow
  >);
});

describe("native window appearance", () => {
  it("does not access a native window in browser preview", async () => {
    vi.mocked(detectRuntime).mockReturnValue({ kind: "browser", supportsSqlite: false });
    await syncWindowTheme("dark");
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it("serializes rapid changes so the final native appearance matches the latest choice", async () => {
    let finishFirst!: () => void;
    setTheme.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = syncWindowTheme("dark");
    const latest = syncWindowTheme("light");
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledTimes(1));
    expect(setTheme).toHaveBeenNthCalledWith(1, "dark");
    finishFirst();
    await Promise.all([first, latest]);
    expect(setTheme).toHaveBeenNthCalledWith(2, "light");
  });

  it("contains a native failure and still applies a subsequent change", async () => {
    setTheme.mockRejectedValueOnce(new Error("native bridge unavailable"));
    await expect(syncWindowTheme("dark")).resolves.toBeUndefined();
    await syncWindowTheme("light");
    expect(setTheme).toHaveBeenLastCalledWith("light");
  });
});
