// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCountryProfile,
  getDestinationProfile,
} from "../app/game/content";
import { PROGRESS_STORAGE_KEY } from "../app/game/progress";
import SideSwapApp from "../app/SideSwapApp";

// The gig launcher drops the player straight into a city's open free drive. The
// mock exposes the scenario plus the resolved driving parameters as data
// attributes, so we can assert the free-roam handoff (correct scenario, local
// traffic side, auto steering, built-in HUD off) without a real Babylon canvas.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockGameCanvas({
      lesson,
      trafficSide,
      steeringSide,
      cameraMode,
      showBuiltInHud,
    }: {
      lesson?: {
        readonly id: string;
        readonly title: string;
        readonly route?: readonly string[];
      };
      trafficSide?: string;
      steeringSide?: string;
      cameraMode?: string;
      showBuiltInHud?: boolean;
    }) {
      return (
        <section
          aria-label="Mock driving scene"
          data-scenario={lesson?.id}
          data-route-count={lesson?.route?.length ?? 0}
          data-traffic-side={trafficSide}
          data-steering-side={steeringSide}
          data-camera={cameraMode}
          data-show-hud={String(showBuiltInHud)}
        >
          <span>{lesson?.title}</span>
        </section>
      );
    },
}));

// jsdom in this project does not expose window.localStorage; install a minimal
// in-memory polyfill so the app's progress persistence can run under test.
const installLocalStorage = () => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
};

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
const originalGetGamepads = Object.getOwnPropertyDescriptor(
  navigator,
  "getGamepads",
);

beforeEach(() => {
  installLocalStorage();
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
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

const findTagline = () =>
  screen.findByRole("heading", {
    name: /Rise and Grind/i,
  });

const startButton = (destinationId: Parameters<typeof getDestinationProfile>[0]) =>
  screen.getByRole("button", {
    name: new RegExp(
      `Start driving in ${getDestinationProfile(destinationId).destinationName}`,
      "i",
    ),
  });

describe("gig launcher", () => {
  it("shows the gig tagline and hides all lesson, setup and passport chrome", async () => {
    render(<SideSwapApp />);

    expect(await findTagline()).toBeVisible();
    // The lesson hub, wheel/camera choosers, passport and capstone are gone.
    expect(
      screen.queryByRole("button", { name: /Browse all drives/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Drives$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Passport/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Wheel$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("drops the player straight into the selected city's open free drive", async () => {
    render(<SideSwapApp />);
    await findTagline();

    const london = getDestinationProfile("uk-london");
    fireEvent.click(startButton("uk-london"));

    const scene = await screen.findByLabelText("Mock driving scene");
    // Launches the free drive directly — no lesson id, no route, no finish.
    expect(scene).toHaveAttribute("data-scenario", london.freeDriveId);
    expect(scene).toHaveAttribute("data-route-count", "0");
    // The reworked HUD replaces the built-in coach/score panel.
    expect(scene).toHaveAttribute("data-show-hud", "false");
  });

  it.each(["uk-london", "us-nyc"] as const)(
    "matches the car and road to %s (auto steering, local traffic side)",
    async (destinationId) => {
      const destination = getDestinationProfile(destinationId);
      const country = getCountryProfile(destination.countryId);
      render(<SideSwapApp />);
      await findTagline();

      const group = screen.getByRole("group", { name: "Destination" });
      fireEvent.click(
        within(group).getByRole("button", {
          name: new RegExp(destination.destinationName, "i"),
        }),
      );
      fireEvent.click(startButton(destinationId));

      const scene = await screen.findByLabelText("Mock driving scene");
      expect(scene).toHaveAttribute("data-scenario", destination.freeDriveId);
      expect(scene).toHaveAttribute("data-traffic-side", country.trafficSide);
      // "auto" resolves to the country's own convention — you drive the local car.
      expect(scene).toHaveAttribute(
        "data-steering-side",
        country.defaultSteeringSide,
      );
    },
  );

  it("keeps Settings reachable from the header", async () => {
    render(<SideSwapApp />);
    await findTagline();

    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    expect(
      await screen.findByRole("heading", { name: /driving preferences/i }),
    ).toBeVisible();
  });

  it("boots a corrupted save straight to a playable launcher", async () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, "{broken");
    render(<SideSwapApp />);

    expect(await findTagline()).toBeVisible();
    expect(startButton("uk-london")).toBeEnabled();
  });
});
