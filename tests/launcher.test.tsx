// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LESSONS } from "../app/game/content";
import type { SimulationScoreSnapshot } from "../app/game/simulation";
import {
  PROGRESS_STORAGE_KEY,
  createDefaultProgress,
} from "../app/game/progress";
import SideSwapApp from "../app/SideSwapApp";

const MOCK_CORE_SCORE: SimulationScoreSnapshot = {
  safety: 73.5,
  ruleUse: 42.25,
  vehicleControl: 91.75,
  total: 63.4,
  criticalErrors: 2,
  mastered: false,
};

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockGameCanvas({
      lesson,
      onComplete,
    }: {
      lesson?: { readonly id: string; readonly title: string };
      onComplete?: (score: SimulationScoreSnapshot) => void;
    }) {
      return (
        <section aria-label="Mock driving scene" data-scenario={lesson?.id}>
          <span>{lesson?.title}</span>
          <button type="button" onClick={() => onComplete?.(MOCK_CORE_SCORE)}>
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
const originalGetGamepads = Object.getOwnPropertyDescriptor(navigator, "getGamepads");

const createGamepadButtons = (count = 17) =>
  Array.from({ length: count }, () => ({ pressed: false, touched: false, value: 0 }));

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalGetGamepads) {
    Object.defineProperty(navigator, "getGamepads", originalGetGamepads);
  } else {
    Reflect.deleteProperty(navigator, "getGamepads");
  }
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: originalScrollIntoView,
  });
});

describe("game-first launcher", () => {
  it("returns corrupted saves to a directly playable default launcher", async () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, "{broken");
    render(<SideSwapApp />);

    expect(
      await screen.findByRole("heading", {
        name: /Swap your instincts. Start driving./i,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Start Left-Side Orientation/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/Tell us where you normally drive/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Traffic keeps (right|left)/i })).not.toBeInTheDocument();
  });

  it("starts the selected destination immediately without a familiarity profile", async () => {
    render(<SideSwapApp />);

    expect(
      await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Start Left-Side Orientation/i }),
    ).toBeEnabled();
    const destinations = within(
      screen.getByRole("group", { name: "Destination" }),
    ).getAllByRole("button");
    expect(destinations[0]).toHaveAccessibleName(/London/i);
    expect(destinations[0]).not.toHaveTextContent("Featured · Recommended start");
    expect(destinations[2]).not.toHaveTextContent("Specialist · Roundabout Academy");
    expect(destinations[0]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(destinations[1]);
    expect(
      screen.getByRole("button", { name: /Start Right-Side Orientation/i }),
    ).toBeEnabled();
    expect(destinations[1]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      screen.getByRole("button", { name: /Start Right-Side Orientation/i }),
    );
    expect(await screen.findByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "orientation-right",
    );
  });

  it("renders a straight, destination-specific preview with the car on the local traffic side", async () => {
    const { container } = render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });

    const londonPreview = screen.getByLabelText("London training preview");
    expect(londonPreview).toHaveClass("launcher-scene-uk-london");
    expect(londonPreview.querySelector(".london-museum")).toBeInTheDocument();
    expect(londonPreview.querySelector(".london-elizabeth-tower")).toBeInTheDocument();
    expect(londonPreview.querySelector(".london-black-cab")).toBeInTheDocument();
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
    expect(newYorkPreview.querySelector(".nyc-empire-tower")).toBeInTheDocument();
    expect(newYorkPreview.querySelector(".nyc-water-tower")).not.toBeInTheDocument();
    expect(newYorkPreview.querySelector(".launcher-car")).toHaveClass("right");
    expect(container.querySelectorAll(".launcher-road")).toHaveLength(1);

    fireEvent.click(
      within(screen.getByRole("group", { name: "Destination" })).getByRole(
        "button",
        { name: /Tokyo — Setagaya/i },
      ),
    );
    const tokyoPreview = screen.getByLabelText("Tokyo — Setagaya training preview");
    expect(tokyoPreview.querySelector(".tokyo-shrine")).toBeInTheDocument();
    expect(tokyoPreview.querySelector(".tokyo-tramway")).toBeInTheDocument();
  });

  it("preserves a selected destination and restores focus after setup closes", async () => {
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });

    const destinations = screen.getByRole("group", { name: "Destination" });
    fireEvent.click(
      within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }),
    );

    expect(
      within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Start Left-Side Orientation/i }),
    ).toBeEnabled();

    const setupTrigger = screen.getByRole("button", { name: /^Wheel/i });
    setupTrigger.focus();
    fireEvent.click(setupTrigger);
    expect(screen.getByRole("dialog", { name: "Ready your drive" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setupTrigger).toHaveFocus();
  });

  it("resets a wheel override to the destination default when the destination changes", async () => {
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });

    fireEvent.click(screen.getByRole("button", { name: /^Wheel/i }));
    fireEvent.click(screen.getByRole("button", { name: /^LeftWheel on the left$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /^Wheel/i })).toHaveTextContent(
      /^Wheelleft$/,
    );

    const destinations = screen.getByRole("group", { name: "Destination" });
    fireEvent.click(
      within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }),
    );
    expect(screen.getByRole("button", { name: /^Wheel/i })).toHaveTextContent(
      /^Wheelright$/,
    );
  });

  it("offers only left and right wheel positions, defaulting to the selected destination", async () => {
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });

    fireEvent.click(screen.getByRole("button", { name: /^Wheel/i }));
    const wheelGroup = within(screen.getByRole("dialog", { name: "Ready your drive" }))
      .getByRole("group", { name: "Wheel position" });
    expect(within(wheelGroup).getAllByRole("button")).toHaveLength(2);
    expect(within(wheelGroup).getByRole("button", { name: /^RightWheel on the right$/i }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(wheelGroup).queryByText(/Local default/i)).not.toBeInTheDocument();
  });

  it("uses modern option cards for wheel and camera without a control preference", async () => {
    render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });

    const setupSummary = screen.getByLabelText("Current car setup");
    expect(within(setupSummary).getAllByRole("button")).toHaveLength(2);
    expect(within(setupSummary).queryByRole("button", { name: /^Controls/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change setup" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Camera/i }));
    const dialog = screen.getByRole("dialog", { name: "Ready your drive" });
    expect(dialog.querySelector("select")).not.toBeInTheDocument();

    const cameraGroup = within(dialog).getByRole("group", { name: "Starting camera" });
    const driverView = within(cameraGroup).getByRole("button", { name: /Driver view/i });
    const chaseView = within(cameraGroup).getByRole("button", { name: /Chase view/i });
    expect(chaseView).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(driverView);
    expect(driverView).toHaveAttribute("aria-pressed", "true");
    expect(chaseView).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).queryByRole("group", { name: "Control prompts" })).not.toBeInTheDocument();
    expect(dialog.querySelector(".control-help")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /^Camera/i })).toHaveTextContent("First person");
    expect(screen.queryByRole("button", { name: /^Controls/i })).not.toBeInTheDocument();
  });

  it("keeps camera preferences in Settings without persisting a control preference", async () => {
    const { container } = render(<SideSwapApp />);
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Make the road comfortable to read" })).toBeVisible();
    expect(container.querySelector("select")).not.toBeInTheDocument();
    expect(screen.queryByText("Familiar traffic side")).not.toBeInTheDocument();

    const cameraGroup = screen.getByRole("group", { name: "Default camera" });
    fireEvent.click(within(cameraGroup).getByRole("button", { name: /Driver view/i }));
    expect(screen.queryByRole("group", { name: "Control prompts" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(screen.getByRole("button", { name: /^Camera/i })).toHaveTextContent("First person");
    expect(screen.queryByRole("button", { name: /^Controls/i })).not.toBeInTheDocument();
    const saved = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}");
    expect(saved.preferredCamera).toBe("first_person");
    expect(saved).not.toHaveProperty("preferredInput");
  });

  it("gives returning players a compact Start action and advances from results", async () => {
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

    const startButton = await screen.findByRole("button", {
      name: /Start The Manhattan Grid/i,
    });
    expect(screen.queryByText(/Continue in New York City, or choose a different training route/i)).not.toBeInTheDocument();
    expect(screen.getByText("Next drive")).toBeVisible();
    expect(screen.getByText("The Manhattan Grid")).toBeVisible();
    expect(screen.getByRole("button", { name: /Browse all drives, lessons, and free practice/i })).toBeVisible();
    fireEvent.click(startButton);

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

  it("persists the authoritative simulation score without reconstructing or weighting it again", async () => {
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
    fireEvent.click(
      await screen.findByRole("button", { name: /Start The Manhattan Grid/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Finish mock drive" }));

    const saved = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    );
    expect(saved.lessonScores["us-one-way-grid"]).toMatchObject({
      lessonId: "us-one-way-grid",
      total: MOCK_CORE_SCORE.total,
      safety: MOCK_CORE_SCORE.safety,
      ruleUse: MOCK_CORE_SCORE.ruleUse,
      vehicleControl: MOCK_CORE_SCORE.vehicleControl,
      criticalErrors: MOCK_CORE_SCORE.criticalErrors,
      mastered: MOCK_CORE_SCORE.mastered,
    });
  });

  it("lets a controller player launch a returning drive without choosing an input type", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const buttons = createGamepadButtons();
    const gamepad = { buttons, axes: [0, 0] } as unknown as Gamepad;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
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
    act(() => vi.advanceTimersByTime(1));
    expect(
      screen.getByRole("button", { name: /Start The Manhattan Grid/i }),
    ).toBeEnabled();

    buttons[0].pressed = true;
    act(() => vi.advanceTimersByTime(34));

    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "us-one-way-grid",
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
    const startButton = screen.getByRole("button", {
      name: /Start Keep Left/i,
    });
    fireEvent.click(startButton);
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
    fireEvent.click(await screen.findByRole("button", { name: "Drives" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Drives" }));
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
    await screen.findByRole("heading", { name: /Swap your instincts. Start driving./i });
    const destinations = screen.getByRole("group", { name: "Destination" });
    fireEvent.click(within(destinations).getByRole("button", { name: /Tokyo — Setagaya/i }));

    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
    expect(
      screen.getByRole("button", { name: /Start Left-Side Orientation/i }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Drives" }));

    const capstone = screen.getByRole("button", { name: "Start capstone" });
    expect(capstone).toBeEnabled();
    fireEvent.click(capstone);
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "uk-fr-side-swap",
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit lesson" }));
    fireEvent.click(screen.getByRole("button", { name: "Drives" }));
    fireEvent.click(screen.getByRole("button", { name: /Milton Keynes/i }));
    const hub = screen.getByRole("heading", { name: "All drives and lessons." }).closest("section");
    expect(hub).not.toBeNull();
    fireEvent.click(within(hub as HTMLElement).getByRole("button", { name: "Start free drive" }));
    expect(screen.getByRole("region", { name: "Mock driving scene" })).toHaveAttribute(
      "data-scenario",
      "free-uk",
    );
  });
});
