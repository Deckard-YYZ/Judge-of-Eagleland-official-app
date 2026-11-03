// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bootstrapInstructionPreview, bootstrapModulePreview } from "../../src/app/modulePreview";
import { App } from "../../src/ui/App";

beforeEach(() => {
  // jsdom has no native dialog top layer; browser acceptance covers modality.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
const tick = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
it.each([undefined, "bracket", "advice", "memo"] as const)(
  "opens the actual instruction case (%s) without login and resets through a fresh isolated bootstrap",
  async (instructionVariant) => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 10,
      bottom: 110,
      left: 10,
      right: 510,
      width: 500,
      height: 100,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    const first = await bootstrapInstructionPreview();
    const session = first.initialSession.session;
    expect(session.getSnapshot().selectedCaseId).toBe("intake");
    expect(session.getSnapshot().state!.cases.intake.status).toBe("active");
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    expect(first.storageMode).toBe("memory-preview");
    render(
      <App
        profileEntry={first.profileEntry}
        initialSession={first.initialSession}
        instructionVariant={instructionVariant}
      />,
    );
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
    await tick(0);
    await tick(750);
    expect(screen.getByRole("button", { name: /按指示确认登记/ })).toBeTruthy();
    expect(screen.getByRole("note").getAttribute("aria-busy")).toBe("true");
    expect(
      document.querySelector(".decision-panel")?.getAttribute("data-instruction-variant"),
    ).toBe(instructionVariant ?? "bracket");
    if (instructionVariant)
      expect(
        screen.getByText(
          instructionVariant === "advice"
            ? "审阅建议"
            : instructionVariant === "memo"
              ? "审阅附笺"
              : "审阅意见",
        ),
      ).toBeTruthy();
    if (instructionVariant === "memo") {
      expect(screen.getAllByRole("note")).toHaveLength(1);
      const note = screen.getByRole("note");
      expect(
        note.closest(".decision-option")?.querySelector("button")?.getAttribute("aria-describedby"),
      ).toContain(note.id);
      expect(note.querySelector(".case-text-block")).toBeNull();
      expect(note.querySelector("img")).toBeNull();
    }
    if (instructionVariant === "advice") {
      expect(screen.getAllByRole("note")).toHaveLength(1);
      const note = screen.getByRole("note");
      const target = screen.getByRole("button", { name: /按指示确认登记/ });
      expect(target.getAttribute("aria-describedby")).toContain(note.id);
      expect(note.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(note.querySelector("button")).toBeNull();
      expect(screen.getByText("建议采纳")).toBeTruthy();
    }
    await tick(session.getSnapshot().content!.cases.intake.nodes.assessment.instruction!.delayMs);
    expect(screen.getByRole("note")).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", {
          name: instructionVariant ? /自行重新核对登记/ : /按指示确认登记/,
        }),
      ),
    );
    expect(session.getSnapshot().state!.cases.intake).toMatchObject({
      status: "active",
      currentNodeId: "disposition",
    });
    const fresh = await bootstrapInstructionPreview();
    expect(fresh.initialSession.session).not.toBe(session);
    expect(fresh.initialSession.session.getSnapshot().state!.cases.intake).toMatchObject({
      status: "active",
      currentNodeId: "assessment",
    });
    expect(fresh.initialSession.session.getSnapshot().state!.pendingStoryIds).toEqual([]);
  },
);

it.each(["tutorial", "story", "action", "news"] as const)(
  "opens isolated %s directly and reopens a fresh session",
  async (id) => {
    const result = await bootstrapModulePreview(id);
    const session = result.initialSession.session;
    const before = session.getSnapshot();
    expect(Object.keys(before.state!.cases)).toEqual([]);
    expect(Object.keys(before.state!.mainFlow?.chats ?? {})).toEqual([]);
    render(
      <App
        profileEntry={result.profileEntry}
        initialSession={result.initialSession}
        mainFlowOverlays={result.mainFlowOverlays}
      />,
    );
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
    if (id === "news") {
      expect(document.querySelector('.news-sheet[data-news-variant="signature"]')).toBeTruthy();
      expect(document.querySelector(".news-sheet__body .news-sheet__response")).toBeTruthy();
      expect(document.querySelector(".news-sheet__footer")).toBeNull();
      expect(before.state!.pendingStoryIds).toEqual([]);
      expect(before.state!.mainFlow!.publishedNewsIds).toEqual(["news-n"]);
      expect(document.querySelector(".news-overlay[open]")).toBeTruthy();
      expect(screen.queryByLabelText("输入动作")).toBeNull();
      await act(async () =>
        fireEvent.click(screen.getAllByRole("button", { name: "确认阅读并继续" })[0]),
      );
      expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual(["news-n"]);
      expect(session.getSnapshot().state!.pendingStoryIds).toEqual(["news-ack"]);
      expect(document.querySelector(".news-overlay[open]")).toBeTruthy();
      expect(document.querySelector(".story-overlay")).toBeNull();
    } else {
      expect(document.querySelector(".news-overlay")).toBeNull();
      expect(before.state!.mainFlow?.publishedNewsIds ?? []).toEqual([]);
      expect(before.state!.pendingStoryIds).toEqual([
        id === "tutorial" ? "tutorial" : id === "story" ? "judgment_notice" : "news-ack",
      ]);
    }
    const storyId = session.getSnapshot().state!.pendingStoryIds[0];
    const storyPlayer = document.querySelector(".story-player")!;
    expect(storyPlayer.getAttribute("data-story-id")).toBe(storyId);
    if (id === "tutorial" || id === "story") {
      expect(storyPlayer.getAttribute("data-step-type")).toBe("text");
      fireEvent.click(screen.getByRole("button", { name: "继续" }));
    }
    expect(storyPlayer.getAttribute("data-step-type")).toBe("actionInput");
    fireEvent.change(screen.getByLabelText("输入动作"), {
      target: { value: id === "tutorial" ? "挥手" : "敬礼" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认动作" })));
    // Each reused story ends in an action: its successful saved input completes it.
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    expect(session.getSnapshot().state!.completedStoryIds).toContain(storyId);
    expect(document.querySelector(".story-player")).toBeNull();
    expect(Object.keys(session.getSnapshot().state!.cases)).toEqual([]);
    expect(Object.keys(session.getSnapshot().state!.mainFlow?.chats ?? {})).toEqual([]);
    const fresh = await bootstrapModulePreview(id);
    expect(fresh.initialSession.session).not.toBe(session);
    expect(fresh.initialSession.session.getSnapshot().state!.pendingStoryIds).toEqual(
      before.state!.pendingStoryIds,
    );
  },
);

it("allows the standalone tutorial to exit without starting other modules", async () => {
  const result = await bootstrapModulePreview("tutorial");
  const session = result.initialSession.session;
  render(<App profileEntry={result.profileEntry} initialSession={result.initialSession} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "退出教程并返回登录" })),
  );
  expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
  expect(Object.keys(session.getSnapshot().state!.cases)).toEqual([]);
  expect(session.getSnapshot().state!.mainFlow!.publishedNewsIds).toEqual([]);
  expect(Object.keys(session.getSnapshot().state!.mainFlow!.chats)).toEqual([]);
});

it("keeps the standalone required story active on a saved wrong action and accepts a retry", async () => {
  const result = await bootstrapModulePreview("story");
  const session = result.initialSession.session;
  render(<App profileEntry={result.profileEntry} initialSession={result.initialSession} />);
  expect(screen.queryByRole("button", { name: "退出教程并返回登录" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.change(screen.getByLabelText("输入动作"), { target: { value: "挥手" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认动作" })));
  expect(screen.getByText("动作不符合要求，结果已保存，请重试。")).toBeTruthy();
  expect(session.getSnapshot().state!.pendingStoryIds).toEqual(["judgment_notice"]);
  expect(session.getSnapshot().state!.attributes.input_errors).toBe(1);
  fireEvent.change(screen.getByLabelText("输入动作"), { target: { value: "敬礼" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认动作" })));
  expect(session.getSnapshot().state!.completedStoryIds).toEqual(["judgment_notice"]);
  expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
  expect(document.querySelector(".story-player")).toBeNull();
});

it.each(["chat-single", "chat-multiple"] as const)(
  "opens %s directly with independent real replies and four-second retirement",
  async (id) => {
    vi.useFakeTimers();
    const result = await bootstrapModulePreview(id);
    const session = result.initialSession.session;
    const ids = id === "chat-single" ? ["preview-chat-a"] : ["preview-chat-b", "preview-chat-c"];
    expect(Object.keys(session.getSnapshot().state!.mainFlow!.chats)).toEqual(ids);
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    expect(session.getSnapshot().state!.mainFlow!.publishedNewsIds).toEqual([]);
    render(
      <App
        profileEntry={result.profileEntry}
        initialSession={result.initialSession}
        mainFlowOverlays={result.mainFlowOverlays}
      />,
    );
    const windowFor = (instance: string) =>
      document.querySelector<HTMLElement>(`[data-instance="${instance}"]`)!;
    if (ids.length === 2)
      expect(windowFor(ids[0]).style.cssText).not.toBe(windowFor(ids[1]).style.cssText);
    for (const instance of ids) {
      expect(windowFor(instance).dataset.chatVariant).toBe("hybrid");
      const choice = within(windowFor(instance)).getByRole("button", { name: "请继续说明" });
      expect(choice.classList.contains("action-choice-button")).toBe(true);
      expect(choice.closest("[role=log]")).toBeNull();
      expect(within(windowFor(instance)).queryByRole("button", { name: "敬礼" })).toBeNull();
      await act(async () =>
        fireEvent.click(within(windowFor(instance)).getByRole("button", { name: "请继续说明" })),
      );
      await act(async () =>
        fireEvent.click(within(windowFor(instance)).getByRole("button", { name: "已收到，谢谢" })),
      );
      expect(session.getSnapshot().state!.mainFlow!.chatResults[instance]).toMatchObject({
        resultId: "normal",
      });
      expect(within(windowFor(instance)).getByRole("log").textContent).toContain("确认完成。");
    }
    await tick(3999);
    for (const instance of ids) expect(windowFor(instance)).toBeTruthy();
    await tick(1);
    for (const instance of ids) expect(windowFor(instance)).toBeNull();
    const fresh = await bootstrapModulePreview(id);
    expect(fresh.initialSession.session.getSnapshot().state!.mainFlow!.chatResults).toEqual({});
    expect(Object.keys(fresh.initialSession.session.getSnapshot().state!.mainFlow!.chats)).toEqual(
      ids,
    );
  },
);

it.each(["chat-ignored", "dispatch"] as const)(
  "runs %s through real case commands without unrelated modules",
  async (id) => {
    vi.useFakeTimers();
    const result = await bootstrapModulePreview(id);
    const session = result.initialSession.session;
    expect(session.getSnapshot().selectedCaseId).toBe("case-a");
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    expect(session.getSnapshot().state!.mainFlow!.publishedNewsIds).toEqual([]);
    render(
      <App
        profileEntry={result.profileEntry}
        initialSession={result.initialSession}
        mainFlowOverlays={result.mainFlowOverlays}
      />,
    );
    await tick(0);
    expect(screen.getByText(/验证步骤：/)).toBeTruthy();
    const count = id === "chat-ignored" ? 2 : 3;
    for (let index = 1; index <= count; index++) {
      await act(async () => {
        expect(
          await session.dispatch({
            type: "chooseOption",
            caseId: "case-a",
            nodeId: `case-a-${index}`,
            choiceId: `case-a-choose-${index}`,
          }),
        ).toMatchObject({ ok: true });
      });
      if (index === 1 && id === "chat-ignored")
        expect(
          session.getSnapshot().state!.mainFlow!.chats["preview-chat-a"].inactivityChoices,
        ).toBe(1);
      if (index < 3 && id === "dispatch")
        expect(Object.keys(session.getSnapshot().state!.cases)).toEqual(["case-a"]);
    }
    if (id === "chat-ignored") {
      expect(session.getSnapshot().state!.mainFlow!.chatResults["preview-chat-a"]).toMatchObject({
        reason: "inactivity",
        resultId: "ignored",
      });
      await tick(3999);
      expect(document.querySelector('[data-instance="preview-chat-a"]')).toBeTruthy();
      await tick(1);
      expect(document.querySelector('[data-instance="preview-chat-a"]')).toBeNull();
    } else {
      expect(session.getSnapshot().state!.cases).toMatchObject({
        "case-a": { status: "resolved" },
        "case-b": { status: "pending" },
      });
    }
    const fresh = await bootstrapModulePreview(id);
    expect(fresh.initialSession.session.getSnapshot().state!.cases["case-a"]).toMatchObject({
      status: "active",
      currentNodeId: "case-a-1",
    });
    expect(Object.keys(fresh.initialSession.session.getSnapshot().state!.cases)).toEqual([
      "case-a",
    ]);
  },
);

it.each(["receipt", "postscript", "signature"] as const)(
  "keeps the %s response in the article scroll flow through real reading and action completion",
  async (variant) => {
    const result = await bootstrapModulePreview("news");
    render(
      <App
        profileEntry={result.profileEntry}
        initialSession={result.initialSession}
        mainFlowOverlays
        newsVariant={variant}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const body = dialog.querySelector(".news-sheet__body")!;
    const response = body.querySelector(".news-sheet__response")!;
    expect(
      within(response as HTMLElement).getByText(
        variant === "receipt" ? "阅读回执" : variant === "postscript" ? "公告附记" : "确认记录",
      ),
    ).toBeTruthy();
    expect(dialog.querySelector(".news-sheet__footer")).toBeNull();
    await act(async () =>
      fireEvent.click(
        within(response as HTMLElement).getByRole("button", { name: "确认阅读并继续" }),
      ),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(body.querySelector(".news-sheet__response")).toBe(response);
    expect(response.querySelector(".story-player--news")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("输入动作"), { target: { value: "敬礼" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认动作" })));
    expect(result.initialSession.session.getSnapshot().state!.completedStoryIds).toContain(
      "news-ack",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it.each([
  ["terminal", "continue"],
  ["terminal", "disconnect"],
  ["takeover", "continue"],
  ["takeover", "disconnect"],
  ["fragments", "continue"],
  ["fragments", "disconnect"],
  ["hybrid", "continue"],
  ["hybrid", "disconnect"],
] as const)(
  "%s preset commands commit the %s branch and retire normally",
  async (variant, branch) => {
    vi.useFakeTimers();
    const preview = await bootstrapModulePreview("chat-single", variant);
    const session = preview.initialSession.session;
    render(
      <App
        profileEntry={preview.profileEntry}
        initialSession={preview.initialSession}
        mainFlowOverlays
        chatVariant={variant}
      />,
    );
    if (variant === "hybrid") {
      expect(screen.getByText("外来消息")).toBeTruthy();
      expect(screen.queryByText("借用模块 / 动作确认")).toBeNull();
      expect(document.querySelector(".chat-event__system-header")).toBeNull();
      expect(document.querySelector(".chat-event__source")).toBeNull();
      expect(screen.getByRole("button", { name: "敬礼" }).closest("[role=log]")).toBeNull();
      expect(
        screen.getByRole("button", { name: "敬礼" }).closest(".chat-event__body"),
      ).toBeTruthy();
    } else {
      expect(
        screen.getByText(variant === "terminal" ? "预置命令 · 选择后发送" : "借用模块 / 动作确认"),
      ).toBeTruthy();
    }
    expect(screen.queryByRole("textbox")).toBeNull();
    if (variant === "fragments") {
      expect(screen.getByRole("button", { name: "敬礼" }).closest("[role=log]")).toBeNull();
      expect(screen.getByRole("button", { name: "敬礼" }).closest(".chat-event")).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "敬礼" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "挥手" })).toBeTruthy();
    if (branch === "continue") {
      fireEvent.click(screen.getByRole("button", { name: "敬礼" }));
      await tick(0);
      expect(session.getSnapshot().state!.mainFlow!.chats["preview-chat-a"].currentNodeId).toBe(
        "detail",
      );
    }
    fireEvent.click(screen.getByRole("button", { name: branch === "continue" ? "敬礼" : "挥手" }));
    await tick(0);
    if (variant === "hybrid") {
      const records = document.querySelectorAll(".chat-event__sent");
      expect(records.length).toBe(branch === "continue" ? 2 : 1);
      expect(records[records.length - 1].textContent).toContain(
        branch === "continue" ? "敬礼" : "挥手",
      );
      expect(records[records.length - 1].querySelector("button")).toBeNull();
    }
    const result = session.getSnapshot().state!.mainFlow!.chatResults["preview-chat-a"];
    expect(result.reason).toBe("normal");
    expect(result.terminalNodeId).toBe(branch === "continue" ? "closed" : "disconnected");
    expect(document.querySelector(".chat-event")).toBeTruthy();
    await tick(3999);
    expect(document.querySelector(".chat-event")).toBeTruthy();
    await tick(1);
    expect(document.querySelector(".chat-event")).toBeNull();
  },
);

it("shows point-preview attributes from the committed demo snapshot without replacing ordinary attributes", async () => {
  const preview = await bootstrapModulePreview("attributes");
  expect(preview.initialSession.session.getSnapshot().state!.attributes).toEqual({
    authority: 75,
    demo_two: 25,
    demo_three: 50,
  });
  render(
    <App
      profileEntry={preview.profileEntry}
      initialSession={preview.initialSession}
      attributeVariant="point"
    />,
  );
  expect(document.querySelector('[data-attribute-variant="point"]')).toBeTruthy();
  expect(screen.getByText("相对比例")).toBeTruthy();
  expect(document.querySelectorAll(".case-sidebar__attribute")).toHaveLength(3);
  expect(screen.getByText("75")).toBeTruthy();
});

it("uses a small square by default for three attributes and keeps contour as an explicit preview", async () => {
  const preview = await bootstrapModulePreview("attributes");
  const props = { profileEntry: preview.profileEntry, initialSession: preview.initialSession };
  const mounted = render(<App {...props} />);
  expect(document.querySelector('[data-attribute-variant="point"]')).toBeTruthy();
  expect(document.querySelector('[data-attribute-marker="square"]')).toBeTruthy();
  expect(document.querySelector(".attribute-triangle figcaption")).toBeNull();
  const marker = document.querySelector(".attribute-triangle__point rect")!;
  expect(marker.getAttribute("width")).toBe("6");
  expect(marker.getAttribute("height")).toBe("6");
  const vertices = document.querySelectorAll("rect.attribute-triangle__vertex");
  expect(vertices).toHaveLength(3);
  vertices.forEach((vertex) => {
    expect(vertex.getAttribute("width")).toBe("4");
    expect(vertex.getAttribute("height")).toBe("4");
  });
  expect(document.querySelector(".case-sidebar__scale")).toBeNull();
  expect(document.querySelectorAll(".case-sidebar__attribute")).toHaveLength(3);
  mounted.rerender(<App {...props} attributeVariant="contour" />);
  expect(document.querySelector('[data-attribute-variant="contour"] polygon')).toBeTruthy();
  expect(screen.getByText("独立刻度")).toBeTruthy();
  expect(screen.getByText("75")).toBeTruthy();
});

it("renders three independently patterned fill regions with the same committed values", async () => {
  const preview = await bootstrapModulePreview("attributes");
  render(
    <App
      profileEntry={preview.profileEntry}
      initialSession={preview.initialSession}
      attributeVariant="fill"
    />,
  );
  expect(document.querySelectorAll(".attribute-triangle__filled")).toHaveLength(3);
  expect(document.querySelectorAll(".attribute-triangle pattern")).toHaveLength(3);
  expect(screen.getByText("各区独立填充；满区对应最大值")).toBeTruthy();
  expect(screen.getByText("75")).toBeTruthy();
});

it("uses identical coordinates for the three point markers", async () => {
  const preview = await bootstrapModulePreview("attributes");
  const props = {
    profileEntry: preview.profileEntry,
    initialSession: preview.initialSession,
    attributeVariant: "point" as const,
  };
  const mounted = render(<App {...props} attributeMarker="dot" />);
  expect(screen.getByText("标记 A · 实心圆点")).toBeTruthy();
  const circle = document.querySelector(".attribute-triangle__point circle")!;
  const x = Number(circle.getAttribute("cx")),
    y = Number(circle.getAttribute("cy"));
  expect(document.querySelectorAll(".attribute-triangle__ticks line")).toHaveLength(12);
  for (const marker of ["square", "bar"] as const) {
    mounted.rerender(<App {...props} attributeMarker={marker} />);
    expect(
      screen.getByText(marker === "square" ? "标记 B · 实心方块" : "标记 C · 短横游标"),
    ).toBeTruthy();
    const rect = document.querySelector(".attribute-triangle__point rect")!;
    expect(Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2).toBe(x);
    expect(Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2).toBe(y);
    expect(document.querySelector(".attribute-triangle__point path")).toBeNull();
  }
});
