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

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
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
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: originalScrollIntoView,
  });
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

  it("requires only the familiar traffic side and features London as the opposite-side suggestion", async () => {
    render(<SideSwapApp />);

    expect(
      await screen.findByRole("heading", { name: /Which side feels normal to you/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Choose your usual traffic side/i }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Traffic keeps right" }));

    expect(
      screen.getByRole("button", { name: /Start London orientation/i }),
    ).toBeEnabled();
    const destinations = within(
      screen.getByRole("group", { name: "Destination" }),
    ).getAllByRole("button");
    expect(destinations[0]).toHaveAccessibleName(/London/i);
    expect(destinations[0]).toHaveTextContent("Featured · Recommended start");
    expect(destinations[0]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Traffic keeps left" }));
    expect(
      screen.getByRole("button", { name: /Start New York City orientation/i }),
    ).toBeEnabled();
    expect(destinations[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a straight, destination-specific preview with the car on the local traffic side", async () => {
    const { container } = render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Which side feels normal to you/i });

    const londonPreview = screen.getByLabelText("London training preview");
    expect(londonPreview).toHaveClass("launcher-scene-uk-london");
    expect(londonPreview.querySelector(".london-museum")).toBeInTheDocument();
    expect(londonPreview.querySelector(".launcher-car")).toHaveClass("left");
    expect(londonPreview.querySelector(".launcher-car-body")).toBeInTheDocument();
    expect(londonPreview.querySelector(".launcher-car-cabin")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("group", { name: "Destination" })).getByRole(
        "button",
        { name: /New York City/i },
      ),
    );

    const newYorkPreview = screen.getByLabelText("New York City training preview");
    expect(newYorkPreview).toHaveClass("launcher-scene-us-nyc");
    expect(newYorkPreview.querySelector(".nyc-skyline")).toBeInTheDocument();
    expect(newYorkPreview.querySelector(".launcher-car")).toHaveClass("right");
    expect(container.querySelectorAll(".launcher-road")).toHaveLength(1);
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
      lastDestinationId: "us-nyc" as const,
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

  it("restores an existing Milton Keynes player to Roundabout Academy", async () => {
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      familiarSideConfirmed: true,
      familiarTrafficSide: "right" as const,
      lastCountryId: "uk" as const,
      lastDestinationId: "uk-milton-keynes" as const,
      completedLessonIds: ["orientation-left" as const],
    };
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));

    render(<SideSwapApp />);

    await screen.findByRole("heading", { name: /Swap your instincts/i });
    expect(
      within(screen.getByRole("group", { name: "Destination" })).getByRole(
        "button",
        { name: /Milton Keynes/i },
      ),
    ).toHaveAttribute("aria-pressed", "true");
    const continueButton = screen.getByRole("button", {
      name: /Continue — Keep Left/i,
    });
    fireEvent.click(continueButton);
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "uk-left-side-basics",
    );
  });

  it("launches a London lesson and its unlocked free drive directly", async () => {
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      familiarSideConfirmed: true,
      familiarTrafficSide: "right" as const,
      lastCountryId: "uk" as const,
      lastDestinationId: "uk-london" as const,
      completedLessonIds: [
        "orientation-left" as const,
        "uk-london-left-side-basics" as const,
      ],
    };
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));

    render(<SideSwapApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Training" }));

    expect(screen.getByRole("link", { name: /Transport for London charge guidance/i })).toBeVisible();
    expect(screen.getByText(/Charges are informational and never affect your score/i)).toBeVisible();
    const londonLesson = screen.getByText("Left in London").closest("article");
    expect(londonLesson).not.toBeNull();
    fireEvent.click(within(londonLesson as HTMLElement).getByRole("button", { name: "Start" }));
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "uk-london-left-side-basics",
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit lesson" }));
    fireEvent.click(screen.getByRole("button", { name: "Training" }));
    fireEvent.click(screen.getByRole("button", { name: "Start free drive" }));
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "free-uk-london",
    );
  });

  it("keeps four passport stamps and shows both UK destination paths", async () => {
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      familiarSideConfirmed: true,
      lastCountryId: "uk" as const,
      lastDestinationId: "uk-london" as const,
      completedLessonIds: [
        "orientation-left" as const,
        "uk-london-left-side-basics" as const,
        "uk-left-side-basics" as const,
      ],
    };
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));

    render(<SideSwapApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Passport 0\/4/i }));

    const passport = screen.getByRole("heading", {
      name: "Your practised road habits",
    }).closest("section");
    expect(passport).not.toBeNull();
    expect(within(passport as HTMLElement).getAllByRole("article")).toHaveLength(4);
    const ukStamp = screen.getByRole("heading", { name: "United Kingdom" }).closest("article");
    expect(ukStamp).not.toBeNull();
    expect(ukStamp).toHaveTextContent("UK");
    expect(ukStamp).toHaveTextContent("London1/3 lessons");
    expect(ukStamp).toHaveTextContent("Milton Keynes1/3 lessons");
  });

  it("auto-reveals the selected destination in the narrow launcher strip", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Which side feels normal to you/i });
    const destinations = screen.getByRole("group", { name: "Destination" });
    fireEvent.click(within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }));
    fireEvent.click(screen.getByRole("button", { name: "Traffic keeps right" }));

    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
    expect(
      screen.getByRole("button", { name: /Start Tokyo — Setagaya orientation/i }),
    ).toBeVisible();
  });

  it("starts unlocked free drive and the cross-border capstone directly from the hub", async () => {
    const completedCountryLessons = LESSONS.filter((lesson) => lesson.countryId).map(
      (lesson) => lesson.id,
    );
    const progress = {
      ...createDefaultProgress("2026-07-10T12:00:00.000Z"),
      familiarSideConfirmed: true,
      lastCountryId: "uk" as const,
      lastDestinationId: "uk-milton-keynes" as const,
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
    fireEvent.click(screen.getByRole("button", { name: /Milton Keynes/i }));
    const hub = screen.getByRole("heading", { name: "Choose your next drive." }).closest("section");
    expect(hub).not.toBeNull();
    fireEvent.click(within(hub as HTMLElement).getByRole("button", { name: "Start free drive" }));
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "free-uk",
    );
  });
});
