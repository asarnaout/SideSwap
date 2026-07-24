// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAREER_STARTING_CASH_BY_COUNTRY,
  createCareerSlice,
  DAY_LENGTH_MS,
  stampCareerChecksum,
  type CareerSliceV1,
} from "../app/game/career";
import { getDestinationProfile } from "../app/game/content";
import {
  createDefaultProgress,
  PROGRESS_STORAGE_KEY,
  writeCareer,
} from "../app/game/progress";
import SideSwapApp from "../app/SideSwapApp";

// The career loop is driven end-to-end through the mock canvas: buttons fire
// canned HUD snapshots (the sim clock) and runtime events (a fine, exit) so
// the whole day → settlement → next-day cycle runs on fireEvent.click with no
// timers and no Babylon.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockGameCanvas(props: {
      lesson?: { readonly id: string };
      playerVehicle?: { readonly model: string | null } | null;
      vehiclePhysics?: { readonly maxForwardSpeedMps?: number } | null;
      onHudUpdate?: (snapshot: Record<string, unknown>) => void;
      onEvent?: (event: Record<string, unknown>) => void;
      onExit?: () => void;
    }) {
      const snapshot = (simElapsedMs: number) => ({
        speed: 0,
        speedUnit: "mph",
        gear: "D",
        cameraMode: "third",
        indicator: "off",
        score: 100,
        objectiveProgress: 0,
        instruction: "",
        paused: false,
        honking: false,
        rearViewVisible: false,
        scenarioId: props.lesson?.id ?? "",
        scenarioTitle: "",
        objective: "",
        checkpoint: "",
        trafficSide: "left",
        playerX: 0,
        playerZ: 0,
        heading: 0,
        simElapsedMs,
      });
      return (
        <section
          aria-label="Mock driving scene"
          data-scenario={props.lesson?.id}
          data-player-model={props.playerVehicle?.model ?? "default"}
          data-max-speed={props.vehiclePhysics?.maxForwardSpeedMps ?? "default"}
        >
          <button
            type="button"
            data-testid="mock-hud-mid"
            onClick={() => props.onHudUpdate?.(snapshot(1_000))}
          >
            hud mid
          </button>
          <button
            type="button"
            data-testid="mock-hud-end"
            onClick={() => props.onHudUpdate?.(snapshot(DAY_LENGTH_MS))}
          >
            hud end
          </button>
          <button
            type="button"
            data-testid="mock-fine"
            onClick={() =>
              props.onEvent?.({
                type: "fine",
                message: "Fined",
                timestamp: 1,
                ruleCode: "red_light",
              })
            }
          >
            fine
          </button>
          <button
            type="button"
            data-testid="mock-exit"
            onClick={() => props.onExit?.()}
          >
            exit
          </button>
        </section>
      );
    },
}));

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
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const storedCareer = (): CareerSliceV1 | { state: string } | null => {
  const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (raw === null) return null;
  return (JSON.parse(raw) as { career: CareerSliceV1 | null }).career;
};

const seedProgressWithCareer = (slice: CareerSliceV1) => {
  const progress = writeCareer(createDefaultProgress(), slice);
  window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
};

const findTagline = () =>
  screen.findByRole("heading", { name: /Rise and Grind/i });

const enterCareerMode = async () => {
  render(<SideSwapApp />);
  await findTagline();
  fireEvent.click(screen.getByTestId("mode-career"));
};

// Default city is uk-london; the career slice therefore prices in GBP.
const UK_START_CASH = CAREER_STARTING_CASH_BY_COUNTRY.uk; // 20
const HATCH_RENT_UK = 12;
const LONDON_FREE_DRIVE_ID = getDestinationProfile("uk-london").freeDriveId;

describe("career mode flow", () => {
  it("starts a career, persists a verified slice, and opens the garage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));

    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    expect(screen.getByTestId("garage-cash")).toHaveTextContent("£20.00");

    const stored = storedCareer();
    expect(stored).not.toBeNull();
    expect((stored as CareerSliceV1).state).toBe("active");
    expect((stored as CareerSliceV1).day).toBe(1);
    expect((stored as CareerSliceV1).countryId).toBe("uk");
    expect(typeof (stored as CareerSliceV1).checksum).toBe("string");
  });

  it("locks the bicycle for now and starts the day on the hatch with rent prepaid", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    expect(screen.getByTestId("garage-vehicle-bicycle")).toBeDisabled();
    expect(screen.getByTestId("garage-vehicle-compact-hatch")).toBeEnabled();

    fireEvent.click(screen.getByTestId("garage-start-day"));
    const scene = await screen.findByLabelText("Mock driving scene");
    expect(scene).toHaveAttribute(
      "data-scenario",
      `career-${LONDON_FREE_DRIVE_ID}-d1`,
    );
    // Rent left the day cash before the first metre was driven.
    expect(screen.getByTestId("day-cash")).toHaveTextContent(
      `£${(UK_START_CASH - HATCH_RENT_UK).toFixed(2)}`,
    );
    // The morning slice is untouched on disk until settlement.
    expect((storedCareer() as CareerSliceV1).cash).toBe(UK_START_CASH);
  });

  it("keeps career fines out of the free-drive wallet and lets cash go negative", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine"));
    // 20 - 12 rent - 8 fine = 0.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("£0.00");

    const raw = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { walletByCountry: Record<string, number> };
    expect(raw.walletByCountry.uk).toBe(20);
  });

  it("settles at the whistle: ledger lines, borrowed shortfall, then the next day's garage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine"));
    fireEvent.click(screen.getByTestId("mock-hud-end"));

    expect(
      await screen.findByRole("heading", { name: /The day's reckoning/i }),
    ).toBeVisible();
    expect(screen.getByTestId("ledger-rent_info")).toHaveTextContent("£12.00");
    expect(screen.getByTestId("ledger-fines")).toHaveTextContent("£8.00");
    expect(screen.getByTestId("ledger-platform_fee")).toHaveTextContent("£3.00");
    // 0 cash − 3 fee = −3 shortfall → loan ceil(3 × 1.15) = 4.
    expect(screen.getByTestId("ledger-loan_origination")).toHaveTextContent(
      "£4.00",
    );
    expect(screen.getByTestId("ledger-closing_balance")).toHaveTextContent(
      "£0.00",
    );

    const settled = storedCareer() as CareerSliceV1;
    expect(settled.day).toBe(2);
    expect(settled.cash).toBe(0);
    expect(settled.loan).toEqual({ principalRemaining: 4, daysRemaining: 3 });

    fireEvent.click(screen.getByTestId("ledger-continue"));
    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    expect(screen.getByTestId("forecast-installment")).toHaveTextContent(
      "£2.00",
    );
  });

  it("discards a quit day: same slice, same day, back at the garage", async () => {
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-start"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
    fireEvent.click(screen.getByTestId("garage-start-day"));
    await screen.findByLabelText("Mock driving scene");

    fireEvent.click(screen.getByTestId("mock-fine"));
    fireEvent.click(screen.getByTestId("mock-exit"));

    expect(window.confirm).toHaveBeenCalled();
    expect(
      await screen.findByRole("heading", { name: /Pick today's ride/i }),
    ).toBeVisible();
    const stored = storedCareer() as CareerSliceV1;
    expect(stored.day).toBe(1);
    expect(stored.cash).toBe(UK_START_CASH);
  });

  it("offers only a reset for a tampered career, leaving free-drive progress alone", async () => {
    const slice = createCareerSlice({
      countryId: "uk",
      destinationId: "uk-london",
      careerSeed: 99,
    });
    const progress = writeCareer(createDefaultProgress(), slice);
    const raw = JSON.parse(JSON.stringify(progress)) as {
      career: { cash: number };
    };
    raw.career.cash = 999_999;
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(raw));

    await enterCareerMode();
    expect(await screen.findByTestId("career-corrupt")).toBeVisible();
    fireEvent.click(screen.getByTestId("career-reset-corrupt"));

    expect(await screen.findByTestId("career-new-panel")).toBeVisible();
    expect(storedCareer()).toBeNull();
    const stored = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}",
    ) as { walletByCountry: Record<string, number> };
    expect(stored.walletByCountry.uk).toBe(20);
  });

  it("takes the van out with its own model and physics", async () => {
    seedProgressWithCareer(
      stampCareerChecksum({
        ...createCareerSlice({
          countryId: "uk",
          destinationId: "uk-london",
          careerSeed: 55,
        }),
        cash: 100,
      }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    const vanCard = screen.getByTestId("garage-vehicle-delivery-van");
    expect(vanCard).toBeEnabled();
    expect(vanCard).toHaveTextContent(/Deliveries only/i);
    fireEvent.click(vanCard);
    fireEvent.click(screen.getByTestId("garage-start-day"));

    const scene = await screen.findByLabelText("Mock driving scene");
    expect(scene).toHaveAttribute("data-player-model", "delivery-van");
    expect(scene).toHaveAttribute("data-max-speed", "19");

    fireEvent.click(screen.getByTestId("mock-exit"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });
  });

  it("rents on credit when broke, and a shortfall under FINAL NOTICE ends the career", async () => {
    seedProgressWithCareer(
      stampCareerChecksum({
        ...createCareerSlice({
          countryId: "uk",
          destinationId: "uk-london",
          careerSeed: 7,
        }),
        cash: 0,
        loan: { principalRemaining: 30, daysRemaining: 3 },
        finalNotice: true,
      }),
    );
    await enterCareerMode();
    fireEvent.click(screen.getByTestId("career-continue"));
    await screen.findByRole("heading", { name: /Pick today's ride/i });

    expect(screen.getByRole("alert")).toHaveTextContent(/FINAL NOTICE/i);
    expect(screen.getByText(/Rent on credit/i)).toBeVisible();
    const startDay = screen.getByTestId("garage-start-day");
    expect(startDay).toBeEnabled();
    fireEvent.click(startDay);
    await screen.findByLabelText("Mock driving scene");
    // Rent went straight into the red.
    expect(screen.getByTestId("day-cash")).toHaveTextContent("-£12.00");

    fireEvent.click(screen.getByTestId("mock-hud-end"));
    expect(
      await screen.findByRole("heading", { name: /The bank called it/i }),
    ).toBeVisible();
    expect((storedCareer() as CareerSliceV1).state).toBe("over");

    fireEvent.click(screen.getByTestId("career-restart"));
    expect(await screen.findByTestId("career-new-panel")).toBeVisible();
    expect(storedCareer()).toBeNull();
  });
});
