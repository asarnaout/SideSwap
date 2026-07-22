"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
import type {
  CutsceneRequest,
  GameCanvasLesson,
  GameHudSnapshot,
  GameRuntimeEvent,
} from "./game/GameCanvas";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  FINE_BY_COUNTRY,
  FUEL_CONSUMPTION_L_PER_M,
  REPAIR_FEE_BY_COUNTRY,
  FUEL_PRICE_PER_LITRE_BY_COUNTRY,
  GIG_FARE_BY_COUNTRY,
  PASSENGER_FARE_BY_COUNTRY,
  TANK_CAPACITY_L,
  formatMoney,
  getCountryProfile,
  getDestinationProfile,
  getFreeDrive,
  getMapPack,
  resolveSessionConfig,
  resolveSteeringSide,
} from "./game/content";
import {
  createDefaultProgress,
  credit,
  debit,
  loadProgress,
  resetProgress,
  saveProgress,
  setFuel,
} from "./game/progress";
import { FULL_CONDITION_PCT, damageForCollision } from "./game/damage";
import { resolveSimulationLaneAnchor } from "./game/simulationAdapter";
import {
  FUEL_PUMP_REACH_M,
  distanceToNearestPump,
  gasStationPumpPositions,
} from "./game/servicePoints";
import { Minimap } from "./game/MinimapCanvas";
import { primeAudioContext, suspendAudioContext } from "./game/audio/audioContext";
import { useDriveMusic } from "./game/audio/musicPlayer";
import {
  generateGigFromPools,
  gigTarget,
  pickGigKind,
  selectGigPools,
} from "./game/gigs";
import type { Gig, GigVenuePosition } from "./game/gigs";
import { streetAddressesForMap } from "./game/streetAddresses";
import type {
  CameraMode,
  CountryProfile,
  DestinationId,
  GameSessionConfig,
  PlayerProgressV2,
  ScenarioId,
} from "./game/types";

type View = "launcher" | "driving" | "settings" | "credits";

const GameCanvas = dynamic(() => import("./game/GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="game-loading" role="status">
      Building roads, traffic and your cockpit…
    </div>
  ),
});

type ChoiceOption<T extends string> = {
  readonly value: T;
  readonly symbol: string;
  readonly label: string;
  readonly hint: string;
};

const CAMERA_CHOICES: readonly ChoiceOption<CameraMode>[] = [
  { value: "first_person", symbol: "1P", label: "Driver view", hint: "First person" },
  { value: "third_person", symbol: "3P", label: "Chase view", hint: "Third person" },
];

const toCanvasCamera = (camera: CameraMode): "first" | "third" =>
  camera === "first_person" ? "first" : "third";

const fromCanvasCamera = (camera: "first" | "third"): CameraMode =>
  camera === "first" ? "first_person" : "third_person";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function useGamepadUiNavigation(
  enabled: boolean,
  onBack: () => void,
) {
  const previousButtonsRef = useRef<boolean[]>([]);
  const previousDirectionsRef = useRef({ up: false, down: false });

  useEffect(() => {
    if (!enabled || !("getGamepads" in navigator)) return;

    const visibleFocusable = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const root = dialog ?? document.querySelector<HTMLElement>("main");
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.closest("[hidden], [aria-hidden=\"true\"]") &&
          element.getAttribute("aria-disabled") !== "true",
      );
    };
    const preferredFocusable = (items: HTMLElement[]) =>
      items.find((item) =>
        item.matches(
          ".launcher-primary:not(:disabled), .primary-button:not(:disabled)",
        ),
      ) ?? items[0];
    const moveFocus = (direction: -1 | 1) => {
      const items = visibleFocusable();
      if (!items.length) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        currentIndex < 0
          ? items.indexOf(preferredFocusable(items))
          : (currentIndex + direction + items.length) % items.length;
      items[Math.max(0, nextIndex)]?.focus();
    };
    const activateFocused = () => {
      const items = visibleFocusable();
      const active = document.activeElement as HTMLElement | null;
      const target = active && items.includes(active)
        ? active
        : preferredFocusable(items);
      target?.focus();
      target?.click();
    };
    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(gamepads).find(Boolean);
      if (!pad) {
        previousButtonsRef.current = [];
        previousDirectionsRef.current = { up: false, down: false };
        return;
      }
      const buttons = pad.buttons.map((button) => button.pressed);
      const up = Boolean(buttons[12]) || (pad.axes[1] ?? 0) <= -0.65;
      const down = Boolean(buttons[13]) || (pad.axes[1] ?? 0) >= 0.65;
      if (up && !previousDirectionsRef.current.up) moveFocus(-1);
      if (down && !previousDirectionsRef.current.down) moveFocus(1);
      if (buttons[0] && !previousButtonsRef.current[0]) activateFocused();
      if (buttons[1] && !previousButtonsRef.current[1]) onBack();
      previousButtonsRef.current = buttons;
      previousDirectionsRef.current = { up, down };
    };
    poll();
    const interval = window.setInterval(poll, 1000 / 30);
    return () => window.clearInterval(interval);
  }, [enabled, onBack]);
}

const DESTINATION_PREVIEW_IMAGES: Record<DestinationId, string> = {
  "uk-london": "/landing/london.webp",
  "us-nyc": "/landing/nyc.webp",
  "uk-milton-keynes": "/landing/milton-keynes.webp",
  "fr-calais": "/landing/calais.webp",
  "jp-tokyo": "/landing/tokyo.webp",
};

// Horizontal focus for the cover-cropped preview. Defaults to centre; Calais is
// nudged right so the lighthouse on the image's right edge stays in frame.
const DESTINATION_PREVIEW_FOCUS: Partial<Record<DestinationId, string>> = {
  "fr-calais": "64% center",
};

const assistanceFromProgress = (
  progress: PlayerProgressV2,
): GameSessionConfig["assistance"] => ({
  coachPrompts: true,
  subtitles: progress.accessibility.subtitles,
  wrongSideWarnings: true,
  autoResetAfterCriticalError: true,
  reducedMotion: progress.accessibility.reducedMotion,
});

function resolveGigVenues(
  map: ReturnType<typeof getMapPack>,
): GigVenuePosition[] {
  return (map.geometry.gigVenues ?? []).flatMap((venue) => {
    const pose = resolveSimulationLaneAnchor(map.laneGraph.lanes, venue.anchor);
    return pose
      ? [
          {
            id: venue.id,
            name: venue.name,
            kind: venue.kind,
            x: pose.x,
            z: pose.z,
          },
        ]
      : [];
  });
}

/** The map's generated street addresses, in gig-pool shape. */
function resolveGigAddresses(
  map: ReturnType<typeof getMapPack>,
): GigVenuePosition[] {
  return streetAddressesForMap(map).map((address) => ({
    id: address.id,
    name: address.name,
    kind: address.kind,
    x: address.x,
    z: address.z,
  }));
}

/**
 * Builds the next gig for a drive: picks delivery vs. passenger deterministically
 * from the seed, then draws from the matching fare table so rides pay their
 * premium. Returns null when the map has too few places to work with. Which
 * places each end may use is `selectGigPools`' call.
 */
function nextGigFor(
  map: ReturnType<typeof getMapPack>,
  country: CountryProfile,
  seed: number,
): Gig | null {
  const kind = pickGigKind(seed);
  const fare =
    kind === "passenger"
      ? PASSENGER_FARE_BY_COUNTRY[country.id]
      : GIG_FARE_BY_COUNTRY[country.id];
  const { pickups, dropoffs } = selectGigPools(
    resolveGigVenues(map),
    resolveGigAddresses(map),
    kind,
  );
  return generateGigFromPools(
    pickups,
    dropoffs,
    fare,
    country.currency.code,
    seed,
    kind,
  );
}

/** How close to a gig stop counts as arrived — mirrors `advanceGig`'s radius;
 * the state itself now flips when the arrival cutscene completes. */
const GIG_ARRIVAL_RADIUS_M = 14;

/** Human-readable reason for a fine toast, from the violation's rule code. */
function fineReason(code: string | undefined): string {
  switch (code) {
    case "wrong_way":
      return "driving on the wrong side";
    case "out_of_bounds":
      return "leaving the road";
    case "red_light":
      return "running a red light";
    case "collision":
      return "careless driving";
    default:
      return "a road violation";
  }
}

export default function SideSwapApp() {
  const [progress, setProgress] = useState<PlayerProgressV2>(() =>
    createDefaultProgress(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("launcher");
  const [destinationId, setDestinationId] =
    useState<DestinationId>("uk-london");
  const [camera, setCamera] = useState<CameraMode>("third_person");
  const [activeSession, setActiveSession] = useState<GameSessionConfig | null>(
    null,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const destinationRefs = useRef(
    new Map<DestinationId, HTMLButtonElement>(),
  );
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<GameHudSnapshot | null>(null);
  const [driveFuel, setDriveFuel] = useState(TANK_CAPACITY_L);
  const lastPoseRef = useRef<{ x: number; z: number } | null>(null);
  const [gig, setGig] = useState<Gig | null>(null);
  const gigSeedRef = useRef(1);
  const paidGigRef = useRef<string | null>(null);
  const [fineToast, setFineToast] = useState<{
    amount: number;
    reason: string;
  } | null>(null);
  const lastFineAtRef = useRef(0);
  // Per-drive car condition (100 = pristine). Collision events wear it down;
  // at zero the car is towed and repaired for a fee. Never persisted — like
  // the score, the wallet debit is the only durable consequence. The ref
  // mirrors the state so back-to-back collision events in one frame all
  // subtract from the live value.
  const [carCondition, setCarCondition] = useState(FULL_CONDITION_PCT);
  const carConditionRef = useRef(FULL_CONDITION_PCT);
  const [towing, setTowing] = useState(false);
  const towingRef = useRef(false);
  const towResetNonceRef = useRef(0);
  const [towResetNonce, setTowResetNonce] = useState(0);
  const lastPedFineAtRef = useRef(0);
  // The interaction cutscene being performed (refuel, boarding, an errand).
  // While set, the canvas locks driving input; its `done` event applies the
  // durable effect (gig state flip) and clears this. The ref mirrors the
  // state so the 10 Hz HUD path and event handler read the live value.
  const [cutscene, setCutscene] = useState<CutsceneRequest | null>(null);
  const cutsceneRef = useRef<CutsceneRequest | null>(null);
  const cutsceneNonceRef = useRef(0);
  // While the pump runs, the fuel bar's CSS transition is stretched to the
  // fill window so the gauge glides while the driver holds the nozzle.
  const [fuelFillMs, setFuelFillMs] = useState(0);

  const clearCutscene = useCallback(() => {
    cutsceneRef.current = null;
    setCutscene(null);
    setFuelFillMs(0);
  }, []);

  const beginCutscene = useCallback(
    (
      kind: CutsceneRequest["kind"],
      venueId?: string,
      actorSeedId?: string,
      missingFuelFraction?: number,
    ) => {
      if (cutsceneRef.current || towingRef.current) return;
      cutsceneNonceRef.current += 1;
      const request: CutsceneRequest = {
        nonce: cutsceneNonceRef.current,
        kind,
        venueId,
        actorSeedId,
        missingFuelFraction,
      };
      cutsceneRef.current = request;
      setCutscene(request);
    },
    [],
  );
  // Lives out here rather than inside GameCanvas, which remounts mid-session
  // whenever the destination or steering side changes — music placed in there
  // would restart at apparently random moments.
  const musicMuted = progress.accessibility.musicMuted;
  const music = useDriveMusic(
    musicMuted
      ? 0
      : progress.accessibility.masterVolume * progress.accessibility.musicVolume,
  );
  // Mute is its own switch rather than a volume of zero, so the slider keeps the
  // level to come back to.
  const toggleMusicMuted = useCallback(() => {
    setProgress((current) => {
      const next: PlayerProgressV2 = {
        ...current,
        accessibility: {
          ...current.accessibility,
          musicMuted: !current.accessibility.musicMuted,
        },
      };
      saveProgress(next);
      return next;
    });
  }, []);

  // Drain fuel by the distance the car actually moved between HUD samples, then
  // mirror the pose for the next delta. Fuel lives in the drive session and is
  // written back to the country's tank on refuel and on exit.
  const handleHud = useCallback((snapshot: GameHudSnapshot) => {
    setHud(snapshot);
    const last = lastPoseRef.current;
    if (last) {
      const moved = Math.hypot(
        snapshot.playerX - last.x,
        snapshot.playerZ - last.z,
      );
      if (moved > 0 && moved < 40) {
        setDriveFuel((fuel) =>
          Math.max(0, fuel - moved * FUEL_CONSUMPTION_L_PER_M),
        );
      }
    }
    lastPoseRef.current = { x: snapshot.playerX, z: snapshot.playerZ };
  }, []);

  // Arriving at a gig stop now means actually stopping there: inside the
  // arrival radius at walking pace. That starts the matching interaction
  // cutscene (rider boards, driver runs the errand); the gig state flips when
  // its `done` event lands — no more drive-by pickups.
  useEffect(() => {
    if (view !== "driving" || !hud || !gig || gig.state === "delivered") return;
    if (cutscene || towing || hud.speed > 1) return;
    const target = gigTarget(gig);
    if (!target) return;
    const distance = Math.hypot(
      hud.playerX - target.x,
      hud.playerZ - target.z,
    );
    if (distance > GIG_ARRIVAL_RADIUS_M) return;
    if (gig.state === "enroute_pickup") {
      beginCutscene(
        gig.kind === "passenger" ? "board" : "food_pickup",
        target.id,
        gig.pickup.id,
      );
    } else {
      beginCutscene(
        gig.kind === "passenger" ? "exit" : "food_dropoff",
        target.id,
        gig.pickup.id,
      );
    }
  }, [view, hud, gig, cutscene, towing, beginCutscene]);

  const handleUiGamepadBack = useCallback(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      return;
    }
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
      return;
    }
    if (view !== "launcher") setView("launcher");
  }, [mobileMenuOpen, view]);

  useGamepadUiNavigation(view !== "driving", handleUiGamepadBack);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadProgress();
      setProgress(loaded);
      setDestinationId(loaded.lastDestinationId);
      setCamera(loaded.preferredCamera);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const destination = getDestinationProfile(destinationId);
  const country = getCountryProfile(destination.countryId);
  const driveDestination = getDestinationProfile(
    activeSession?.destinationId ?? destinationId,
  );
  const driveCountry = getCountryProfile(driveDestination.countryId);
  const activeSteeringSide = resolveSteeringSide(
    activeSession?.steeringPreference ?? "auto",
    driveCountry,
  );

  // The car is a write-off: fade to the tow overlay, debit the repair bill,
  // snap the car back to its spawn repaired, and fade back in. No button, no
  // modal — the drive itself never stops being playable for long.
  const beginTow = useCallback(() => {
    if (towingRef.current) return;
    towingRef.current = true;
    setTowing(true);
    // A scene in flight is torn down by the session's reset; drop the app
    // side too so nothing waits on a `done` that will never come.
    clearCutscene();
    const fee = REPAIR_FEE_BY_COUNTRY[driveCountry.id];
    const paid = debit(progress, driveCountry.id, fee);
    setProgress(paid);
    saveProgress(paid);
    const reduced = progress.accessibility.reducedMotion;
    window.setTimeout(() => {
      towResetNonceRef.current += 1;
      setTowResetNonce(towResetNonceRef.current);
      carConditionRef.current = FULL_CONDITION_PCT;
      setCarCondition(FULL_CONDITION_PCT);
    }, reduced ? 80 : 900);
    window.setTimeout(() => {
      towingRef.current = false;
      setTowing(false);
    }, reduced ? 500 : 2400);
  }, [progress, driveCountry, clearCutscene]);

  // Collision events wear the car down (and striking a person is cited on the
  // spot); a fine event reaches us only when a patrol witnessed the violation.
  // Both debit the local wallet and flash the toast, mirroring the refuel path.
  const handleGameEvent = useCallback(
    (event: GameRuntimeEvent) => {
      if (event.type === "cutscene") {
        const active = cutsceneRef.current;
        const evidence = event.evidence ?? {};
        if (!active || evidence.nonce !== active.nonce) return;
        if (evidence.phase === "pump") {
          // The nozzle is in: pay and fill atomically, and stretch the fuel
          // bar's transition across the fill window so the gauge pours while
          // the driver pumps. An aborted scene after this point was still a
          // completed purchase; before it, nothing happened.
          const litres = Math.max(0, TANK_CAPACITY_L - driveFuel);
          const cost =
            Math.round(
              litres * FUEL_PRICE_PER_LITRE_BY_COUNTRY[driveCountry.id] * 100,
            ) / 100;
          const refueled = setFuel(
            debit(progress, driveCountry.id, cost),
            driveCountry.id,
            TANK_CAPACITY_L,
          );
          setProgress(refueled);
          saveProgress(refueled);
          setFuelFillMs(
            typeof evidence.durationMs === "number" ? evidence.durationMs : 0,
          );
          setDriveFuel(TANK_CAPACITY_L);
          return;
        }
        if (evidence.phase === "done") {
          clearCutscene();
          if (active.kind === "board" || active.kind === "food_pickup") {
            setGig((current) =>
              current && current.state === "enroute_pickup"
                ? { ...current, state: "carrying" }
                : current,
            );
          } else if (active.kind === "exit" || active.kind === "food_dropoff") {
            setGig((current) =>
              current && current.state === "carrying"
                ? { ...current, state: "delivered" }
                : current,
            );
          }
        }
        return;
      }
      if (event.type === "collision") {
        const evidence = event.evidence ?? {};
        const damage = damageForCollision(evidence);
        if (damage > 0 && !towingRef.current) {
          const next = Math.max(0, carConditionRef.current - damage);
          carConditionRef.current = next;
          setCarCondition(next);
          if (next <= 0) beginTow();
        }
        const roadUser = evidence.roadUserType;
        if (roadUser === "pedestrian" || roadUser === "cyclist") {
          const now = Date.now();
          if (now - lastPedFineAtRef.current < 4000) return;
          lastPedFineAtRef.current = now;
          const amount = FINE_BY_COUNTRY[driveCountry.id];
          const fined = debit(progress, driveCountry.id, amount);
          setProgress(fined);
          saveProgress(fined);
          setFineToast({
            amount,
            reason:
              roadUser === "cyclist"
                ? "striking a cyclist"
                : "striking a pedestrian",
          });
        }
        return;
      }
      if (event.type !== "fine") return;
      const now = Date.now();
      if (now - lastFineAtRef.current < 8000) return;
      lastFineAtRef.current = now;
      const amount = FINE_BY_COUNTRY[driveCountry.id];
      const fined = debit(progress, driveCountry.id, amount);
      setProgress(fined);
      saveProgress(fined);
      setFineToast({ amount, reason: fineReason(event.ruleCode) });
    },
    [progress, driveCountry, driveFuel, beginTow, clearCutscene],
  );

  // Auto-dismiss the fine toast a few seconds after it appears.
  useEffect(() => {
    if (!fineToast) return;
    const timer = window.setTimeout(() => setFineToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [fineToast]);
  const activeScenarioId = activeSession?.scenarioId ?? destination.freeDriveId;
  const activeFreeDrive = getFreeDrive(activeScenarioId);
  const runtimeMap = getMapPack(activeFreeDrive.mapId);
  // The open-world drive is self-contained: the authored spawn drops the car in
  // a legal lane on the city map, with no route, checkpoints or finish line.
  const runtimeLesson: GameCanvasLesson = {
    id: activeFreeDrive.id,
    title: activeFreeDrive.title,
    kind: "free_drive",
    trafficSide: driveCountry.trafficSide,
    startSpawnId: activeFreeDrive.startSpawnId,
    route: [],
    objectives: [
      {
        id: `${activeFreeDrive.id}-explore`,
        label: "Explore the city",
      },
    ],
    trafficSeed: activeFreeDrive.trafficSeed,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
    checkpoints: [],
    coachPrompts: [],
    assessedRules: [],
    scenarioClock: activeFreeDrive.scenarioClock,
  };

  const themeDestination = view === "driving" ? driveDestination : destination;
  const themeStyle = {
    "--destination-accent": themeDestination.visualTheme.accent,
    "--destination-sky": themeDestination.visualTheme.sky,
    "--destination-ground": themeDestination.visualTheme.ground,
    "--destination-road": themeDestination.visualTheme.road,
    "--destination-lane": themeDestination.visualTheme.laneMarking,
  } as CSSProperties;

  useEffect(() => {
    if (!hydrated || window.innerWidth > 780) return;
    const selected = destinationRefs.current.get(destinationId);
    if (typeof selected?.scrollIntoView === "function") {
      selected.scrollIntoView({
        behavior: progress.accessibility.reducedMotion ? "auto" : "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [destinationId, hydrated, progress.accessibility.reducedMotion]);

  // Pay out a completed delivery and immediately offer the next one. Guarded by
  // paidGigRef so re-renders can't double-credit the same gig.
  useEffect(() => {
    if (!gig || gig.state !== "delivered" || paidGigRef.current === gig.id) {
      return;
    }
    paidGigRef.current = gig.id;
    const settled: PlayerProgressV2 = {
      ...credit(progress, driveCountry.id, gig.reward),
      completedGigCount: progress.completedGigCount + 1,
    };
    setProgress(settled);
    saveProgress(settled);
    gigSeedRef.current += 1;
    setGig(nextGigFor(runtimeMap, driveCountry, gigSeedRef.current));
  }, [gig, progress, driveCountry, runtimeMap]);

  const chooseDestination = (id: DestinationId) => {
    setDestinationId(id);
  };

  const beginDrive = (
    scenarioId: ScenarioId,
    nextDestinationId = destinationId,
  ) => {
    // Both synchronously, inside the click that got us here: Safari only honours
    // an audio resume and a play() in the same task as the gesture that
    // triggered them, so neither can move into an effect or behind an await.
    primeAudioContext();
    music.start(nextDestinationId);
    const nextDestination = getDestinationProfile(nextDestinationId);
    const nextCountryId = nextDestination.countryId;
    const session: GameSessionConfig = {
      countryId: nextCountryId,
      destinationId: nextDestinationId,
      scenarioId,
      // The car now always matches the local convention; the wheel side is
      // resolved from the country profile, never chosen on the landing page.
      familiarTrafficSide: getCountryProfile(nextCountryId).trafficSide,
      steeringPreference: "auto",
      camera,
      assistance: assistanceFromProgress(progress),
    };
    // Fail fast if a UI regression ever pairs a scenario with a destination
    // whose jurisdiction does not match.
    resolveSessionConfig(session);
    const committedProgress: PlayerProgressV2 = {
      ...progress,
      lastCountryId: nextCountryId,
      lastDestinationId: nextDestinationId,
      preferredCamera: camera,
      updatedAt: new Date().toISOString(),
    };
    setProgress(committedProgress);
    saveProgress(committedProgress);
    setDestinationId(nextDestinationId);
    setActiveSession(session);
    setDriveFuel(committedProgress.fuelByCountry[nextCountryId]);
    lastPoseRef.current = null;
    const nextFreeDrive = getFreeDrive(scenarioId);
    gigSeedRef.current = nextFreeDrive.trafficSeed;
    paidGigRef.current = null;
    setGig(
      nextGigFor(
        getMapPack(nextFreeDrive.mapId),
        getCountryProfile(nextCountryId),
        gigSeedRef.current,
      ),
    );
    setHud(null);
    setPaused(false);
    carConditionRef.current = FULL_CONDITION_PCT;
    setCarCondition(FULL_CONDITION_PCT);
    towingRef.current = false;
    setTowing(false);
    clearCutscene();
    setView("driving");
  };

  const exitDrive = () => {
    // Persist the current tank level back to the country's saved fuel.
    const persisted = setFuel(progress, driveCountry.id, driveFuel);
    setProgress(persisted);
    saveProgress(persisted);
    setGig(null);
    setPaused(false);
    setActiveSession(null);
    clearCutscene();
    music.stop();
    // Parked, not closed — the player will almost certainly start another drive,
    // and a closed context can never be reopened.
    suspendAudioContext();
    setView("launcher");
  };

  const saveSettings = (next: PlayerProgressV2) => {
    setProgress(next);
    setDestinationId(next.lastDestinationId);
    setCamera(next.preferredCamera);
    saveProgress(next);
  };

  // Economy state for the active drive: wallet, fuel gauge, and whether the car
  // is stopped at a gas station (so the refuel prompt can appear).
  const walletHere = progress.walletByCountry[driveCountry.id];
  const fuelFraction = driveFuel / TANK_CAPACITY_L;
  // Measured to the pumps, not to the lane anchor: the station model is set
  // back ~16-19m from its anchor, so an anchor-radius check offered fuel to a
  // car stopped on the carriageway while refusing it at the pumps themselves.
  const activeGasStation =
    view === "driving" && hud && hud.speed <= 1
      ? (runtimeMap.geometry.servicePoints ?? []).find(
          (service) =>
            distanceToNearestPump(
              runtimeMap.laneGraph.lanes,
              service,
              hud.playerX,
              hud.playerZ,
            ) <= FUEL_PUMP_REACH_M,
        ) ?? null
      : null;
  const litresNeeded = Math.max(0, TANK_CAPACITY_L - driveFuel);
  const refuelCost =
    Math.round(
      litresNeeded * FUEL_PRICE_PER_LITRE_BY_COUNTRY[driveCountry.id] * 100,
    ) / 100;
  const canRefuel = litresNeeded > 0.5 && walletHere >= refuelCost;
  // Pressing Refuel now stages the pump cutscene; the wallet debit and the
  // fill land when the scene reports the nozzle is in (its `pump` event).
  const refuel = () => {
    if (!canRefuel || cutscene || towing) return;
    beginCutscene(
      "refuel",
      undefined,
      undefined,
      litresNeeded / TANK_CAPACITY_L,
    );
  };

  // Pin the pumps rather than the lane anchor. The anchor sits on the
  // carriageway ~19m short of the forecourt, and now that fuel is only offered
  // at the pumps a pin out on the road would send the player to a dead spot.
  const gasPins =
    view === "driving"
      ? (runtimeMap.geometry.servicePoints ?? []).flatMap((service) => {
          const pumps = gasStationPumpPositions(
            runtimeMap.laneGraph.lanes,
            service,
          );
          if (!pumps.length) return [];
          return [
            {
              x: pumps.reduce((total, pump) => total + pump.x, 0) / pumps.length,
              z: pumps.reduce((total, pump) => total + pump.z, 0) / pumps.length,
              color: "#5bbf6a",
            },
          ];
        })
      : [];
  const gigTargetVenue = gig ? gigTarget(gig) : null;
  const minimapPins = gigTargetVenue
    ? [
        ...gasPins,
        {
          x: gigTargetVenue.x,
          z: gigTargetVenue.z,
          color: gig?.state === "carrying" ? "#f2c658" : "#e0533f",
        },
      ]
    : gasPins;
  // A waiting rider mesh only makes sense while heading to a passenger pickup.
  const riderVenueId =
    gig && gig.kind === "passenger" && gig.state === "enroute_pickup"
      ? gig.pickup.id
      : null;
  // Within arrival range but still rolling: nudge the player to stop, since
  // stopping is what starts the pickup/drop-off scene now.
  const nearGigStop = Boolean(
    hud &&
      gig &&
      gig.state !== "delivered" &&
      gigTargetVenue &&
      Math.hypot(
        hud.playerX - gigTargetVenue.x,
        hud.playerZ - gigTargetVenue.z,
      ) <= GIG_ARRIVAL_RADIUS_M,
  );
  const cutsceneCaption = cutscene
    ? cutscene.kind === "refuel"
      ? "Refueling…"
      : cutscene.kind === "board"
        ? "Your rider is getting in…"
        : cutscene.kind === "exit"
          ? "Dropping off your rider…"
          : cutscene.kind === "food_pickup"
            ? "Picking up the order…"
            : "Delivering the order…"
    : null;
  // A street address is a spot outside a row of buildings that look like every
  // other row, so the stop you are heading for gets a lit kerbside beacon.
  const gigStopId = gigTargetVenue?.id ?? null;
  const gigStopCarrying = gig?.state === "carrying";

  if (!hydrated) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-road" aria-hidden="true" />
        <p>Preparing Curbside Rush…</p>
      </main>
    );
  }

  if (view === "driving") {
    return (
      <main className="game-page" style={themeStyle}>
        <GameCanvas
          key={`${driveDestination.id}-${runtimeLesson.id}-${activeSteeringSide}`}
          className="game-canvas"
          trafficSide={runtimeLesson.trafficSide}
          steeringSide={activeSteeringSide}
          lesson={runtimeLesson}
          mapPack={runtimeMap}
          cameraMode={toCanvasCamera(camera)}
          speedUnit={driveCountry.speedUnit === "kmh" ? "km/h" : "mph"}
          paused={paused}
          showBuiltInHud={false}
          reducedMotion={progress.accessibility.reducedMotion}
          steeringSensitivity={progress.accessibility.steeringSensitivity}
          fieldOfView={(progress.accessibility.fieldOfView * Math.PI) / 180}
          masterVolume={progress.accessibility.masterVolume}
          effectsVolume={progress.accessibility.effectsVolume}
          cameraShake={progress.accessibility.cameraShake}
          headBob={progress.accessibility.headBob}
          visualHonkIndicator={progress.accessibility.visualHonkIndicator}
          outOfFuel={driveFuel <= 0}
          carConditionPct={carCondition}
          resetNonce={towResetNonce}
          riderVenueId={riderVenueId}
          gigStopId={gigStopId}
          gigStopCarrying={gigStopCarrying}
          cutscene={cutscene}
          onHudUpdate={handleHud}
          onEvent={handleGameEvent}
          onPauseChange={setPaused}
          onCameraChange={(mode) => setCamera(fromCanvasCamera(mode))}
          onExit={exitDrive}
        />
        {gig && gig.state !== "delivered" && (
          <div
            style={{
              position: "absolute",
              left: "1rem",
              top: "1rem",
              maxWidth: "16rem",
              padding: "0.7rem 0.9rem",
              borderRadius: "0.9rem",
              background: "rgba(15, 18, 22, 0.72)",
              backdropFilter: "blur(10px)",
              color: "#f4f6f8",
              font: "600 0.9rem/1.3 system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                top: "0.9rem",
                bottom: "0.9rem",
                width: "4px",
                borderRadius: "0 4px 4px 0",
                background: gig.state === "carrying" ? "#f2c658" : "#e0533f",
              }}
            />
            <div
              style={{
                fontSize: "0.66rem",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                opacity: 0.6,
                marginBottom: "0.15rem",
              }}
            >
              {gig.kind === "passenger"
                ? gig.state === "carrying"
                  ? "🧑 Drop off rider"
                  : "🧑 Pick up rider"
                : gig.state === "carrying"
                  ? "📦 Deliver to"
                  : "📦 Pick up at"}
            </div>
            <strong style={{ fontSize: "1.02rem" }}>
              {gig.state === "carrying" ? gig.dropoff.name : gig.pickup.name}
            </strong>
            <div
              style={{
                marginTop: "0.4rem",
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                fontSize: "0.78rem",
                opacity: 0.82,
              }}
            >
              <span>
                {gig.state === "carrying"
                  ? `from ${gig.pickup.name}`
                  : `then ${gig.dropoff.name}`}
              </span>
              <strong>{formatMoney(gig.reward, driveCountry)}</strong>
            </div>
            {nearGigStop && !cutscene && hud && hud.speed > 1 && (
              <div
                style={{
                  marginTop: "0.4rem",
                  fontSize: "0.78rem",
                  color: "#f2c658",
                }}
              >
                Stop the car to{" "}
                {gig.state === "carrying" ? "drop off" : "pick up"}.
              </div>
            )}
          </div>
        )}
        {cutsceneCaption && (
          <div
            role="status"
            style={{
              position: "absolute",
              left: "50%",
              bottom: "1.4rem",
              transform: "translateX(-50%)",
              padding: "0.55rem 1.2rem",
              borderRadius: "999px",
              background: "rgba(15, 18, 22, 0.78)",
              backdropFilter: "blur(10px)",
              color: "#f4f6f8",
              font: "600 0.95rem/1.2 system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: 6,
            }}
          >
            {cutsceneCaption}
          </div>
        )}
        {fineToast && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: "1.25rem",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "0.6rem 1.1rem",
              borderRadius: "999px",
              background: "rgba(150, 24, 28, 0.92)",
              color: "#fff",
              font: "700 0.95rem/1.2 system-ui, sans-serif",
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
              zIndex: 6,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span aria-hidden="true">🚓</span>
            <span>
              Fined {formatMoney(fineToast.amount, driveCountry)} for{" "}
              {fineToast.reason}
            </span>
          </div>
        )}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "1rem",
            bottom: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.55rem",
            minWidth: "10rem",
            padding: "0.7rem 0.9rem",
            borderRadius: "0.9rem",
            background: "rgba(15, 18, 22, 0.62)",
            backdropFilter: "blur(10px)",
            color: "#f4f6f8",
            font: "600 0.95rem/1.1 system-ui, sans-serif",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <span style={{ opacity: 0.65 }}>Wallet</span>
            <strong>{formatMoney(walletHere, driveCountry)}</strong>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.72rem",
                opacity: 0.65,
                marginBottom: "0.25rem",
              }}
            >
              <span>Fuel</span>
              <span>
                {driveFuel <= 0 ? "EMPTY" : `${Math.round(fuelFraction * 100)}%`}
              </span>
            </div>
            <div
              style={{
                height: "0.5rem",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.16)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(100, fuelFraction * 100))}%`,
                  background: fuelFraction < 0.2 ? "#e0533f" : "#5bbf6a",
                  // While the pump scene runs, the bar pours across the whole
                  // fill window instead of snapping full.
                  transition:
                    fuelFillMs > 0
                      ? `width ${fuelFillMs}ms linear`
                      : "width 0.2s ease",
                }}
              />
            </div>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.72rem",
                opacity: 0.65,
                marginBottom: "0.25rem",
              }}
            >
              <span>Car</span>
              <span>
                {carCondition <= 0
                  ? "WRECKED"
                  : `${Math.round(carCondition)}%`}
              </span>
            </div>
            <div
              style={{
                height: "0.5rem",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.16)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(100, carCondition))}%`,
                  background:
                    carCondition <= 25
                      ? "#e0533f"
                      : carCondition <= 55
                        ? "#f2c658"
                        : "#5bbf6a",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        </div>
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            background: "#0c0e11",
            color: "#f4f6f8",
            textAlign: "center",
            font: "700 1.25rem/1.35 system-ui, sans-serif",
            zIndex: 9,
            opacity: towing ? 1 : 0,
            pointerEvents: "none",
            transition: progress.accessibility.reducedMotion
              ? "none"
              : "opacity 0.4s ease",
          }}
        >
          {towing && (
            <>
              <span aria-hidden="true" style={{ fontSize: "2rem" }}>
                🚧
              </span>
              <span>Your car&apos;s a write-off.</span>
              <span style={{ fontSize: "0.95rem", opacity: 0.75 }}>
                Towed &amp; repaired —{" "}
                {formatMoney(REPAIR_FEE_BY_COUNTRY[driveCountry.id], driveCountry)}
              </span>
            </>
          )}
        </div>
        {activeGasStation && !cutscene && !towing && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: "1.4rem",
              transform: "translateX(-50%)",
              zIndex: 6,
            }}
          >
            <button
              type="button"
              onClick={refuel}
              disabled={!canRefuel}
              style={{
                padding: "0.65rem 1.3rem",
                borderRadius: "999px",
                border: "none",
                cursor: canRefuel ? "pointer" : "not-allowed",
                background: canRefuel ? "#f2c658" : "rgba(60,64,70,0.85)",
                color: canRefuel ? "#1a1c1f" : "#f4f6f8",
                font: "700 1rem/1 system-ui, sans-serif",
                backdropFilter: "blur(10px)",
              }}
            >
              {litresNeeded <= 0.5
                ? `${activeGasStation.label} · Tank full`
                : canRefuel
                  ? `Refuel — ${formatMoney(refuelCost, driveCountry)}`
                  : `Need ${formatMoney(refuelCost, driveCountry)} to fill up`}
            </button>
          </div>
        )}
        {hud && (
          <Minimap
            worldSize={runtimeMap.geometry.worldSize}
            roadSurfaces={runtimeMap.geometry.roadSurfaces}
            playerX={hud.playerX}
            playerZ={hud.playerZ}
            heading={hud.heading}
            pins={minimapPins}
          />
        )}
        {hud && (
          <div
            className="drive-speed"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "1rem",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "baseline",
              gap: "0.35rem",
              padding: "0.45rem 0.9rem",
              borderRadius: "999px",
              background: "rgba(15, 18, 22, 0.6)",
              backdropFilter: "blur(10px)",
              color: "#f4f6f8",
              font: "700 1.4rem/1 system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <strong>{hud.speed}</strong>
            <span style={{ fontSize: "0.7rem", opacity: 0.7, fontWeight: 500 }}>
              {hud.speedUnit}
            </span>
            <em style={{ fontSize: "0.8rem", opacity: 0.8, fontStyle: "normal" }}>
              {hud.gear}
            </em>
          </div>
        )}
        <button
          type="button"
          onClick={toggleMusicMuted}
          aria-pressed={musicMuted}
          aria-label={musicMuted ? "Unmute music" : "Mute music"}
          title={musicMuted ? "Unmute music" : "Mute music"}
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            width: "2.6rem",
            height: "2.6rem",
            display: "grid",
            placeItems: "center",
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            background: "rgba(15, 18, 22, 0.6)",
            backdropFilter: "blur(10px)",
            color: musicMuted ? "rgba(244, 246, 248, 0.45)" : "#f4f6f8",
            font: "500 1.1rem/1 system-ui, sans-serif",
            zIndex: 6,
          }}
        >
          <span aria-hidden="true">{musicMuted ? "🔇" : "🎵"}</span>
        </button>
        {hud && (
          <div className="sr-only" aria-live="polite">
            Speed {hud.speed} {hud.speedUnit}, gear {hud.gear}.
          </div>
        )}
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${view === "launcher" ? "launcher-shell" : ""}`}
      style={themeStyle}
    >
      <header className="app-header">
        <button
          className="brand-button"
          type="button"
          onClick={() => setView("launcher")}
          aria-label="Curbside Rush home"
        >
          <span className="brand-mark">C</span>
          <span className="brand-copy">
            <strong>CURBSIDE</strong>
            <small>RUSH</small>
          </span>
        </button>
        <nav className="header-actions" aria-label="Main navigation">
          <button
            className={view === "settings" ? "active" : ""}
            type="button"
            onClick={() => setView("settings")}
          >
            Settings
          </button>
          <button
            className={view === "credits" ? "active" : ""}
            type="button"
            onClick={() => setView("credits")}
          >
            Sources
          </button>
        </nav>
        <div className="mobile-menu">
          <button
            className="mobile-menu-trigger"
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu-panel"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            Menu
          </button>
          {mobileMenuOpen && (
            <nav id="mobile-menu-panel" aria-label="Mobile navigation">
              <button type="button" onClick={() => { setView("settings"); setMobileMenuOpen(false); }}>Settings & accessibility</button>
              <button type="button" onClick={() => { setView("credits"); setMobileMenuOpen(false); }}>Sources & credits</button>
            </nav>
          )}
        </div>
      </header>

      {view === "settings" && (
        <SettingsView
          progress={progress}
          onSave={saveSettings}
          onReset={() => {
            const reset = resetProgress();
            setProgress(reset);
            setDestinationId(reset.lastDestinationId);
            setCamera(reset.preferredCamera);
            setView("launcher");
          }}
          onBack={() => setView("launcher")}
        />
      )}
      {view === "credits" && (
        <CreditsView onBack={() => setView("launcher")} />
      )}

      {view === "launcher" && (
        <section className="launcher-page">
          <div className="launcher-copy">
            <p className="eyebrow">READY TO EARN</p>
            <h1 aria-label="Rise and Grind">
              <>Rise and <em>Grind</em></>
            </h1>

            <p className="launcher-pick-label">Choose a city</p>
            <div
              className="launcher-destinations"
              role="group"
              aria-label="Destination"
            >
              {DESTINATION_PROFILES.map((item) => {
                const itemCountry = getCountryProfile(item.countryId);
                return (
                <button
                  key={item.id}
                  ref={(node) => {
                    if (node) destinationRefs.current.set(item.id, node);
                    else destinationRefs.current.delete(item.id);
                  }}
                  type="button"
                  className={`${destinationId === item.id ? "active" : ""} ${item.promotion}`}
                  aria-label={`${item.destinationName}. ${item.destinationSubtitle}`}
                  aria-pressed={destinationId === item.id}
                  onClick={() => chooseDestination(item.id)}
                >
                  <span>{itemCountry.flagEmoji}</span>
                  <strong>{item.destinationName}</strong>
                  <small>{item.destinationSubtitle}</small>
                </button>
                );
              })}
            </div>

            <div className="launcher-actions">
              <button
                className="primary-button launcher-primary"
                type="button"
                aria-label={`Start driving in ${destination.destinationName}`}
                onClick={() => beginDrive(destination.freeDriveId, destination.id)}
              >
                Start driving
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          <div
            className="launcher-road-visual"
            aria-label={`${destination.destinationName} training preview`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static preview art in /public; next/image adds no value for a fixed, non-critical hero */}
            <img
              className="launcher-photo"
              src={DESTINATION_PREVIEW_IMAGES[destination.id]}
              style={{ objectPosition: DESTINATION_PREVIEW_FOCUS[destination.id] }}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <div className="launcher-place">
              <span>{country.flagEmoji} {country.countryName}</span>
              <strong>{destination.destinationName}</strong>
              <em>{destination.destinationSubtitle}</em>
              <small>Traffic keeps {country.trafficSide} · {country.speedUnit === "kmh" ? "km/h" : "mph"}</small>
            </div>
          </div>
          <p className="launcher-legal">Familiarisation only—not legal advice or driver instruction. Map data © OpenStreetMap contributors.</p>
        </section>
      )}

      {view !== "launcher" && (
        <footer className="app-footer">
          <span>Curbside Rush is familiarisation, not legal advice or driver instruction.</span>
          <span>Map data © OpenStreetMap contributors · ODbL</span>
        </footer>
      )}
    </main>
  );
}

function OptionPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <fieldset className="choice-control">
      <legend>{label}</legend>
      <div className={`choice-control-options columns-${options.length}`}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              className="choice-control-option"
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              <span className="choice-control-symbol" aria-hidden="true">{option.symbol}</span>
              <span className="choice-control-copy">
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </button>
          );
        })}
      </div>
      {hint && <p className="choice-control-hint">{hint}</p>}
    </fieldset>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  ariaValueText,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  ariaValueText: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const progress = clamp(((value - min) / (max - min)) * 100, 0, 100);
  return (
    <label className="range-control">
      <span><strong>{label}</strong><output>{formatValue(value)}</output></span>
      <input
        aria-label={label}
        aria-valuetext={ariaValueText(value)}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-progress": `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SettingsView({ progress, onSave, onReset, onBack }: { progress: PlayerProgressV2; onSave: (value: PlayerProgressV2) => void; onReset: () => void; onBack: () => void }) {
  const [draft, setDraft] = useState(progress);
  const updateAccessibility = (patch: Partial<PlayerProgressV2["accessibility"]>) => setDraft((current) => ({ ...current, accessibility: { ...current.accessibility, ...patch } }));
  return (
    <section className="subpage settings-page">
      <div className="subpage-heading">
        <button className="secondary-button" type="button" onClick={onBack} style={{ marginLeft: "auto" }}>Back to Homepage</button>
      </div>
      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="driving-preferences-title">
          <div className="settings-card-head">
            <h2 id="driving-preferences-title"><span className="settings-card-dot dot-yellow" aria-hidden="true" />Driving preferences</h2>
            <p className="settings-card-sub">How the car handles and frames the road.</p>
          </div>
          <OptionPicker<CameraMode>
            label="Default camera"
            value={draft.preferredCamera}
            options={CAMERA_CHOICES}
            onChange={(preferredCamera) => setDraft((current) => ({ ...current, preferredCamera }))}
          />
          <div className="settings-toggle-stack">
            <Toggle label="Camera shake" checked={draft.accessibility.cameraShake} onChange={(checked) => updateAccessibility({ cameraShake: checked })} />
            <Toggle label="First-person head bob" checked={draft.accessibility.headBob} onChange={(checked) => updateAccessibility({ headBob: checked })} />
          </div>
        </section>
        <section className="settings-card" aria-labelledby="accessibility-audio-title">
          <div className="settings-card-head">
            <h2 id="accessibility-audio-title"><span className="settings-card-dot dot-sage" aria-hidden="true" />Accessibility &amp; audio</h2>
            <p className="settings-card-sub">Readability cues and sound.</p>
          </div>
          <div className="settings-toggle-stack">
            <Toggle label="Subtitles" checked={draft.accessibility.subtitles} onChange={(checked) => updateAccessibility({ subtitles: checked })} />
            <Toggle label="Visual honk cue" checked={draft.accessibility.visualHonkIndicator} onChange={(checked) => updateAccessibility({ visualHonkIndicator: checked })} />
            <Toggle label="Reduced motion" checked={draft.accessibility.reducedMotion} onChange={(checked) => updateAccessibility({ reducedMotion: checked })} />
          </div>
          <div className="settings-range-stack">
            <RangeControl label="Steering sensitivity" value={draft.accessibility.steeringSensitivity} min={0.5} max={2} step={0.1} formatValue={(value) => `${value.toFixed(1)}×`} ariaValueText={(value) => `${value.toFixed(1)} times`} onChange={(steeringSensitivity) => updateAccessibility({ steeringSensitivity })} />
            <RangeControl label="Field of view" value={draft.accessibility.fieldOfView} min={55} max={100} step={1} formatValue={(value) => `${value}°`} ariaValueText={(value) => `${value} degrees`} onChange={(fieldOfView) => updateAccessibility({ fieldOfView })} />
            <RangeControl label="Master volume" value={draft.accessibility.masterVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(masterVolume) => updateAccessibility({ masterVolume })} />
            <RangeControl label="Effects volume" value={draft.accessibility.effectsVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(effectsVolume) => updateAccessibility({ effectsVolume })} />
            <RangeControl label="Music volume" value={draft.accessibility.musicVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(musicVolume) => updateAccessibility({ musicVolume })} />
          </div>
        </section>
      </div>
      <div className="settings-actions">
        <button type="button" className="danger-button" onClick={onReset}>Reset local progress</button>
        <button type="button" className="primary-button" onClick={() => { onSave({ ...draft, updatedAt: new Date().toISOString() }); onBack(); }}>Save settings</button>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><strong>{label}</strong><input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function CreditsView({ onBack }: { onBack: () => void }) {
  const references = Array.from(new Map(COUNTRY_PROFILES.flatMap((country) => country.officialReferences).map((reference) => [reference.id, reference])).values());
  const extracts = [
    ["New York", "nyc-upper-west.json"],
    ["London — South Kensington", "uk-london-south-kensington.json"],
    ["Milton Keynes", "uk-milton-keynes.json"],
    ["Calais / Coquelles", "fr-calais-coquelles.json"],
    ["Tokyo Setagaya", "jp-setagaya.json"],
  ] as const;
  return (
    <section className="subpage credits-page">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">SOURCES &amp; CREDITS</p>
          <h1>Rules should have receipts.</h1>
          <p>Every assessed rule is tied to an official source and review date. OpenStreetMap supplies geography only.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to Homepage</button>
      </div>
      <article className="license-card">
        <h3 className="credits-section-title"><span className="settings-card-dot dot-sage" aria-hidden="true" />Map data — frozen, credited, separate from the law</h3>
        <p>Curbside Rush includes compact snapshots for Upper West Side, South Kensington, Milton Keynes, Calais/Coquelles and Setagaya. Each extract records its bounds, freeze timestamp, source and content checksums, and importer version. The game makes no runtime map requests.</p>
        <div className="map-downloads" aria-label="Download frozen map extracts">
          {extracts.map(([label, filename]) => (
            <a key={filename} href={`/map-data/${filename}`} download>
              <span className="map-glyph" aria-hidden="true">{"{ }"}</span>
              <span className="map-copy"><strong>{label}</strong><small>JSON · importer v2</small></span>
            </a>
          ))}
        </div>
        <a className="osm-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors · ODbL 1.0 ↗</a>
      </article>
      <h3 className="credits-section-title with-count">
        <span className="settings-card-dot dot-yellow" aria-hidden="true" />Rule sources
        <span className="credits-count">· {references.length} official references</span>
      </h3>
      <div className="source-groups">
        {COUNTRY_PROFILES.map((country) => (
          <section className="source-group" key={country.id}>
            <div className="source-group-head"><span className="flag">{country.flagEmoji}</span> {country.countryName}</div>
            {country.officialReferences.map((reference) => (
              <a className="source-row" key={reference.id} href={reference.url} target="_blank" rel="noreferrer">
                <span className="source-row-copy">
                  <span className="source-juris">{reference.jurisdiction}</span>
                  <strong>{reference.title}</strong>
                  <small>{reference.authority} · reviewed {reference.reviewedOn}</small>
                </span>
                <b className="source-arrow" aria-hidden="true">↗</b>
              </a>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
