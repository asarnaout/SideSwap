// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LESSONS } from "../app/game/content";
import {
  PROGRESS_STORAGE_KEY,
  createDefaultProgress,
} from "../app/game/progress";
import SideSwapApp from "../app/SideSwapApp";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockGameCanvas({
      lesson,
      onComplete,
    }: {
      lesson?: { readonly id: string; readonly title: string };
      onComplete?: (score: number) => void;
    }) {
      return (
        <section aria-label="Mock driving scene" data-scenario={lesson?.id}>
          <span>{lesson?.title}</span>
          <button type="button" onClick={() => onComplete?.(94)}>
            Finish mock drive
          </button>
        </section>
      );
    },
}));

const desktopMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }) as unknown as MediaQueryList;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(desktopMatchMedia));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("game-first launcher", () => {
  it("returns corrupted saves to first-time setup", async () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, "{broken");
    render(<SideSwapApp />);

    expect(
      await screen.findByRole("heading", {
        name: /Which side feels normal to you/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Choose your usual traffic side/i }),
    ).toBeDisabled();
  });

  it("requires only the familiar traffic side and suggests the opposite-side destination", async () => {
    render(<SideSwapApp />);

    expect(
      await screen.findByRole("heading", { name: /Which side feels normal to you/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Choose your usual traffic side/i }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Traffic keeps right" }));

    expect(
      screen.getByRole("button", { name: /Start Milton Keynes orientation/i }),
    ).toBeEnabled();
    expect(
      within(screen.getByRole("group", { name: "Destination" })).getByRole(
        "button",
        { name: /Milton Keynes/i },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves a manually selected destination and restores focus after setup closes", async () => {
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Which side feels normal to you/i });

    const destinations = screen.getByRole("group", { name: "Destination" });
    fireEvent.click(
      within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Traffic keeps left" }));

    expect(
      within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Start Tokyo — Setagaya orientation/i }),
    ).toBeEnabled();

    const setupTrigger = screen.getByRole("button", { name: "Change setup" });
    setupTrigger.focus();
    fireEvent.click(setupTrigger);
    expect(screen.getByRole("dialog", { name: "Ready your drive" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setupTrigger).toHaveFocus();
  });

  it("resets a wheel override to the destination default when the destination changes", async () => {
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Which side feels normal to you/i });
    fireEvent.click(screen.getByRole("button", { name: "Traffic keeps right" }));

    fireEvent.click(screen.getByRole("button", { name: "Change setup" }));
    fireEvent.click(screen.getByRole("button", { name: "left wheel" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /^Wheel/i })).toHaveTextContent(
      /^Wheelleft$/,
    );

    const destinations = screen.getByRole("group", { name: "Destination" });
    fireEvent.click(
      within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }),
    );
    expect(screen.getByRole("button", { name: /^Wheel/i })).toHaveTextContent(
      "right · local",
    );
  });

  it("gives returning players one-click Continue and advances from results", async () => {
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      familiarSideConfirmed: true,
      familiarTrafficSide: "right" as const,
      lastCountryId: "us" as const,
      completedLessonIds: ["orientation-right" as const],
    };
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));

    render(<SideSwapApp />);

    const continueButton = await screen.findByRole("button", {
      name: /Continue — The Manhattan Grid/i,
    });
    fireEvent.click(continueButton);

    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "us-one-way-grid",
    );
    fireEvent.click(screen.getByRole("button", { name: "Finish mock drive" }));

    const nextButton = await screen.findByRole("button", {
      name: /Next — Signals & Crosswalks/i,
    });
    fireEvent.click(nextButton);
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "us-signals-crosswalks",
    );
  });

  it("starts unlocked free drive and the cross-border capstone directly from the hub", async () => {
    const completedCountryLessons = LESSONS.filter((lesson) => lesson.countryId).map(
      (lesson) => lesson.id,
    );
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      familiarSideConfirmed: true,
      lastCountryId: "jp" as const,
      completedLessonIds: [
        "orientation-left" as const,
        "orientation-right" as const,
        ...completedCountryLessons,
      ],
    };
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));

    render(<SideSwapApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Training" }));

    const capstone = screen.getByRole("button", { name: "Start capstone" });
    expect(capstone).toBeEnabled();
    fireEvent.click(capstone);
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "uk-fr-side-swap",
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit lesson" }));
    fireEvent.click(screen.getByRole("button", { name: "Training" }));
    const hub = screen.getByRole("heading", { name: "Choose your next drive." }).closest("section");
    expect(hub).not.toBeNull();
    fireEvent.click(within(hub as HTMLElement).getByRole("button", { name: "Start free drive" }));
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "free-uk",
    );
  });
});
