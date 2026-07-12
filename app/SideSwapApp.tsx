"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
import type {
  GameCanvasLesson,
  GameHudSnapshot,
  GameRuntimeEvent,
} from "./game/GameCanvas";
import {
  COUNTRY_PROFILES,
  DESTINATION_PROFILES,
  SCORING_CONFIG,
  getCountryProfile,
  getDestinationProfile,
  getFreeDrive,
  getFreeDriveForDestination,
  getLesson,
  getLessonsForDestination,
  getMapPack,
  getOrientationForTrafficSide,
  resolveSessionConfig,
  resolveSteeringSide,
} from "./game/content";
import {
  createDefaultProgress,
  getRecommendedDrive,
  isFreeDriveUnlocked,
  isLessonUnlocked,
  loadProgress,
  resetProgress,
  saveProgress,
  updateLessonProgress,
} from "./game/progress";
import type {
  CameraMode,
  CountryId,
  DestinationId,
  FreeDriveId,
  GameSessionConfig,
  InputFamily,
  LessonDefinition,
  LessonId,
  LessonScore,
  PlayerProgressV1,
  ScenarioId,
  SteeringSide,
  TrafficSide,
} from "./game/types";

type View =
  | "launcher"
  | "training"
  | "driving"
  | "results"
  | "passport"
  | "settings"
  | "credits";

const GameCanvas = dynamic(() => import("./game/GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="game-loading" role="status">
      Building roads, traffic and your cockpit…
    </div>
  ),
});

const BADGE_LABELS: Record<string, string> = {
  right_side_ready: "Right-side ready",
  left_side_ready: "Left-side ready",
  signal_scholar: "Signal scholar",
  roundabout_ready: "Roundabout ready",
  lane_courtesy: "Lane courtesy",
  vulnerable_road_guardian: "Road guardian",
  rail_crossing_ready: "Rail-crossing ready",
  side_swap_traveler: "SideSwap traveler",
  first_person_mastery: "Cockpit mastery",
  london_city_ready: "London city ready",
};

const COUNTRY_MARKS: Record<CountryId, string> = {
  us: "NYC",
  uk: "UK",
  fr: "CAL",
  jp: "世田谷",
};

const inputLabels: Record<InputFamily, string> = {
  keyboard: "Keyboard",
  gamepad: "Gamepad",
  touch: "Touch",
};

const cameraLabels: Record<CameraMode, string> = {
  first_person: "First person",
  third_person: "Third person",
};

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

const INPUT_CHOICES: readonly ChoiceOption<InputFamily>[] = [
  { value: "keyboard", symbol: "KEYS", label: "Keyboard", hint: "WASD + shortcuts" },
  { value: "gamepad", symbol: "PAD", label: "Gamepad", hint: "Controller layout" },
  { value: "touch", symbol: "TAP", label: "Touch", hint: "On-screen layout" },
];

const TRAFFIC_SIDE_CHOICES: readonly ChoiceOption<TrafficSide>[] = [
  { value: "right", symbol: "R", label: "Traffic keeps right", hint: "US, France & more" },
  { value: "left", symbol: "L", label: "Traffic keeps left", hint: "UK, Japan & more" },
];

const toCanvasCamera = (camera: CameraMode): "first" | "third" =>
  camera === "first_person" ? "first" : "third";

const fromCanvasCamera = (camera: "first" | "third"): CameraMode =>
  camera === "first" ? "first_person" : "third_person";

const formatMinutes = (lesson: LessonDefinition) =>
  `${lesson.estimatedMinutes[0]}–${lesson.estimatedMinutes[1]} min`;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function initialSelectedDestination(side: TrafficSide): DestinationId {
  return side === "right" ? "uk-london" : "us-nyc";
}

function defaultWheelForDestination(destinationId: DestinationId): SteeringSide {
  return getCountryProfile(
    getDestinationProfile(destinationId).countryId,
  ).defaultSteeringSide;
}

function DestinationPreviewScenery({
  destinationId,
}: {
  destinationId: DestinationId;
}) {
  if (destinationId === "uk-london") {
    return (
      <div className="launcher-cityscape london-cityscape">
        <div className="london-museum">
          <span className="museum-wing museum-wing-left"><i /><i /><i /></span>
          <span className="museum-centre"><i /><b /></span>
          <span className="museum-wing museum-wing-right"><i /><i /><i /></span>
        </div>
        <span className="london-lamp london-lamp-left" />
        <span className="london-lamp london-lamp-right" />
        <span className="london-bus"><i /><i /><i /></span>
        <span className="london-cab"><i /></span>
      </div>
    );
  }

  if (destinationId === "us-nyc") {
    return (
      <div className="launcher-cityscape nyc-cityscape">
        <div className="nyc-skyline">
          <span /><span /><span /><span /><span /><span />
        </div>
        <div className="nyc-brownstones">
          <span><i /><i /><i /></span>
          <span><i /><i /><i /></span>
          <span><i /><i /><i /></span>
        </div>
        <span className="nyc-water-tower"><i /></span>
        <span className="nyc-street-sign">W 72 ST</span>
      </div>
    );
  }

  if (destinationId === "uk-milton-keynes") {
    return (
      <div className="launcher-cityscape mk-cityscape">
        <div className="mk-tree-line">
          <span /><span /><span /><span /><span /><span /><span />
        </div>
        <span className="mk-building"><i /><i /><i /></span>
        <span className="mk-roundabout"><i /><i /><i /></span>
        <span className="mk-direction-sign"><b>Central MK</b><i>A5</i></span>
      </div>
    );
  }

  if (destinationId === "fr-calais") {
    return (
      <div className="launcher-cityscape calais-cityscape">
        <span className="calais-ferry"><i /><i /><i /><i /></span>
        <span className="calais-lighthouse"><i /></span>
        <span className="calais-terminal"><i /><i /><i /></span>
        <span className="calais-sign"><b>CALAIS</b><i>COQUELLES</i></span>
      </div>
    );
  }

  return (
    <div className="launcher-cityscape tokyo-cityscape">
      <div className="tokyo-houses">
        <span><i /><i /></span>
        <span><i /><i /></span>
        <span><i /><i /></span>
      </div>
      <span className="tokyo-torii"><i /></span>
      <span className="tokyo-crossing"><i /><b /><em /></span>
      <span className="tokyo-train"><i /><i /><i /></span>
    </div>
  );
}

const isFreeDriveScenario = (scenarioId: ScenarioId): scenarioId is FreeDriveId =>
  scenarioId.startsWith("free-");

const scenarioTitle = (scenarioId: ScenarioId) =>
  isFreeDriveScenario(scenarioId)
    ? getFreeDrive(scenarioId).title
    : getLesson(scenarioId).title;

const assistanceFromProgress = (
  progress: PlayerProgressV1,
): GameSessionConfig["assistance"] => ({
  coachPrompts: true,
  subtitles: progress.accessibility.subtitles,
  wrongSideWarnings: true,
  autoResetAfterCriticalError: true,
  reducedMotion: progress.accessibility.reducedMotion,
});

export default function SideSwapApp() {
  const [progress, setProgress] = useState<PlayerProgressV1>(() =>
    createDefaultProgress(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("launcher");
  const [familiarSide, setFamiliarSide] = useState<TrafficSide | null>(null);
  const [destinationId, setDestinationId] =
    useState<DestinationId>("uk-london");
  const [destinationChosenManually, setDestinationChosenManually] =
    useState(false);
  const [wheelPreference, setWheelPreference] =
    useState<SteeringSide>("right");
  const [camera, setCamera] = useState<CameraMode>("third_person");
  const [input, setInput] = useState<InputFamily>("keyboard");
  const [activeSession, setActiveSession] = useState<GameSessionConfig | null>(
    null,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeTriggerRef = useRef<HTMLButtonElement>(null);
  const destinationRefs = useRef(
    new Map<DestinationId, HTMLButtonElement>(),
  );
  const closeCustomize = useCallback(() => setCustomizeOpen(false), []);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<GameHudSnapshot | null>(null);
  const [events, setEvents] = useState<GameRuntimeEvent[]>([]);
  const [lastScore, setLastScore] = useState<LessonScore | null>(null);
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadProgress();
      const firstVisit = !loaded.familiarSideConfirmed;
      const defaultInput = window.matchMedia("(pointer: coarse)").matches
        ? "touch"
        : "keyboard";
      setProgress(loaded);
      setFamiliarSide(firstVisit ? null : loaded.familiarTrafficSide);
      setDestinationId(loaded.lastDestinationId);
      setWheelPreference(defaultWheelForDestination(loaded.lastDestinationId));
      setCamera(loaded.preferredCamera);
      setInput(firstVisit ? defaultInput : loaded.preferredInput);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const destination = getDestinationProfile(destinationId);
  const country = getCountryProfile(destination.countryId);
  const destinationLessons = getLessonsForDestination(destinationId);
  const orientation = getOrientationForTrafficSide(country.trafficSide);
  const trainingPath = [orientation, ...destinationLessons];
  const steeringSide = resolveSteeringSide(wheelPreference, country);
  const completedCount = progress.completedLessonIds.length;
  const masteryCount = Object.values(progress.lessonScores).filter(
    (score) => score?.mastered,
  ).length;
  const recommendation = useMemo(
    () => getRecommendedDrive(progress, destinationId),
    [destinationId, progress],
  );
  const driveDestination = getDestinationProfile(
    activeSession?.destinationId ?? destinationId,
  );
  const driveCountry = getCountryProfile(driveDestination.countryId);
  const activeSteeringSide = resolveSteeringSide(
    activeSession?.steeringPreference ?? wheelPreference,
    driveCountry,
  );
  const activeScenarioId = activeSession?.scenarioId ?? orientation.id;
  const activeIsFreeDrive = isFreeDriveScenario(activeScenarioId);
  const activeFreeDrive = activeIsFreeDrive
    ? getFreeDrive(activeScenarioId)
    : null;
  const activeLesson = activeIsFreeDrive
    ? getLessonsForDestination(driveDestination.id)[0] ??
      getOrientationForTrafficSide(driveCountry.trafficSide)
    : getLesson(activeScenarioId as LessonId);
  const runtimeMap = getMapPack(activeFreeDrive?.mapId ?? activeLesson.mapId);
  const runtimeLesson: GameCanvasLesson = activeFreeDrive
    ? {
        id: activeFreeDrive.id,
        title: activeFreeDrive.title,
        kind: "free_drive",
        trafficSide: driveCountry.trafficSide,
        route: activeLesson.route,
        objectives: [
          {
            id: `${activeFreeDrive.id}-explore`,
            label: "Explore safely with no fixed finish",
          },
        ],
        trafficSeed: activeFreeDrive.trafficSeed,
        trafficDensity: "moderate",
        vulnerableRoadUsers: activeLesson.vulnerableRoadUsers,
        checkpoints: runtimeMap.laneGraph.checkpoints.map(
          (checkpoint) => checkpoint.id,
        ),
        coachPrompts: [
          {
            id: `${activeFreeDrive.id}-start`,
            trigger: { type: "start" },
            message:
              "Free drive has no finish line. Explore the map and practise the local road habits at your own pace.",
          },
        ],
        assessedRules: Array.from(
          new Set(
            getLessonsForDestination(driveDestination.id).flatMap(
              (lesson) => lesson.assessedRules,
            ),
          ),
        ),
        scenarioClock: activeFreeDrive.scenarioClock,
      }
    : activeLesson;

  const themeDestination =
    view === "driving" || view === "results" ? driveDestination : destination;
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

  const chooseFamiliarSide = (side: TrafficSide) => {
    setFamiliarSide(side);
    if (!destinationChosenManually) {
      const suggestedDestination = initialSelectedDestination(side);
      setDestinationId(suggestedDestination);
      setWheelPreference(defaultWheelForDestination(suggestedDestination));
    }
  };

  const chooseDestination = (id: DestinationId) => {
    setDestinationId(id);
    setDestinationChosenManually(true);
    setWheelPreference(defaultWheelForDestination(id));
  };

  const beginDrive = (
    scenarioId: ScenarioId,
    nextDestinationId = destinationId,
  ) => {
    if (!familiarSide) return;
    const nextDestination = getDestinationProfile(nextDestinationId);
    const nextCountryId = nextDestination.countryId;
    const nextWheelPreference =
      nextDestinationId === destinationId
        ? wheelPreference
        : defaultWheelForDestination(nextDestinationId);
    const session: GameSessionConfig = {
      countryId: nextCountryId,
      destinationId: nextDestinationId,
      scenarioId,
      familiarTrafficSide: familiarSide,
      steeringPreference: nextWheelPreference,
      camera,
      inputFamily: input,
      assistance: assistanceFromProgress(progress),
    };
    // Fail fast if a UI regression ever pairs a jurisdiction-specific
    // scenario with the wrong destination profile.
    resolveSessionConfig(session);
    const committedProgress: PlayerProgressV1 = {
      ...progress,
      familiarSideConfirmed: true,
      familiarTrafficSide: familiarSide,
      lastCountryId: nextCountryId,
      lastDestinationId: nextDestinationId,
      preferredCamera: camera,
      preferredInput: input,
      updatedAt: new Date().toISOString(),
    };
    setProgress(committedProgress);
    saveProgress(committedProgress);
    setDestinationId(nextDestinationId);
    if (nextDestinationId !== destinationId) {
      setWheelPreference(nextWheelPreference);
    }
    setActiveSession(session);
    setEvents([]);
    setHud(null);
    setPaused(false);
    setStartedAt(new Date().getTime());
    setView("driving");
  };

  const finishDrive = (total: number) => {
    const criticalErrors = events.filter(
      (event) => event.severity === "critical",
    ).length;
    const controlResets = events.filter(
      (event) => event.type === "reset" || event.type === "incident",
    ).length;
    const safety = clamp(100 - criticalErrors * 25, 0, 100);
    const ruleUse = clamp(Math.round(total), 0, 100);
    const vehicleControl = clamp(
      100 - controlResets * 6 - criticalErrors * 4,
      0,
      100,
    );
    const weightedTotal = Math.round(
      safety * SCORING_CONFIG.weights.safety +
        ruleUse * SCORING_CONFIG.weights.ruleUse +
        vehicleControl * SCORING_CONFIG.weights.vehicleControl,
    );
    const completedAt = new Date();
    const score: LessonScore = {
      lessonId: activeLesson.id,
      total: weightedTotal,
      safety,
      ruleUse,
      vehicleControl,
      criticalErrors,
      mastered:
        weightedTotal >= SCORING_CONFIG.masteryThreshold && criticalErrors === 0,
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt),
    };
    setLastScore(score);
    if (!activeIsFreeDrive && activeSession) {
      const updated = updateLessonProgress(progress, {
        score,
        cameraUsed: camera,
      });
      const withPreferences: PlayerProgressV1 = {
        ...updated,
        familiarSideConfirmed: true,
        familiarTrafficSide: activeSession.familiarTrafficSide,
        lastCountryId: activeSession.countryId,
        lastDestinationId: activeSession.destinationId,
        preferredCamera: camera,
        preferredInput: input,
      };
      setProgress(withPreferences);
      saveProgress(withPreferences);
    }
    setView("results");
  };

  const recordEvent = (event: GameRuntimeEvent) => {
    if (event.type === "ready" || event.type === "camera") return;
    setEvents((current) => [...current, event].slice(-80));
  };

  const saveSettings = (next: PlayerProgressV1) => {
    setProgress(next);
    setFamiliarSide(next.familiarTrafficSide);
    setDestinationId(
      !next.familiarSideConfirmed && !destinationChosenManually
        ? initialSelectedDestination(next.familiarTrafficSide)
        : next.lastDestinationId,
    );
    setCamera(next.preferredCamera);
    setInput(next.preferredInput);
    saveProgress(next);
  };

  if (!hydrated) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-road" aria-hidden="true" />
        <p>Preparing SideSwap…</p>
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
          inputFamily={input}
          speedUnit={driveCountry.speedUnit === "kmh" ? "km/h" : "mph"}
          paused={paused}
          reducedMotion={progress.accessibility.reducedMotion}
          steeringSensitivity={progress.accessibility.steeringSensitivity}
          fieldOfView={(progress.accessibility.fieldOfView * Math.PI) / 180}
          masterVolume={progress.accessibility.masterVolume}
          effectsVolume={progress.accessibility.effectsVolume}
          coachVolume={progress.accessibility.coachVolume}
          cameraShake={progress.accessibility.cameraShake}
          headBob={progress.accessibility.headBob}
          visualHonkIndicator={progress.accessibility.visualHonkIndicator}
          onHudUpdate={setHud}
          onEvent={recordEvent}
          onPauseChange={setPaused}
          onCameraChange={(mode) => setCamera(fromCanvasCamera(mode))}
          onInputFamilyChange={setInput}
          onComplete={finishDrive}
        />
        <div className="game-brand" aria-hidden="true">
          <span className="brand-mark small">S</span>
          <span>SIDESWAP</span>
        </div>
        <div className="game-context">
          <span>{driveCountry.flagEmoji}</span>
          <div>
            <strong>{activeIsFreeDrive ? "Free drive" : activeLesson.title}</strong>
            <small>
              {driveDestination.destinationName} · traffic keeps {runtimeLesson.trafficSide}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="game-exit"
          onClick={() => {
            setPaused(false);
            setView("launcher");
          }}
        >
          Exit lesson
        </button>
        {hud && (
          <div className="sr-only" aria-live="polite">
            Speed {hud.speed} {hud.speedUnit}. Score {hud.score}. {hud.instruction}
          </div>
        )}
      </main>
    );
  }

  if (view === "results" && lastScore) {
    const nextDrive = getRecommendedDrive(
      progress,
      activeSession?.destinationId ?? destinationId,
    );
    return (
      <main className="results-page" style={themeStyle}>
        <div className="results-card">
          <div className="result-seal" aria-hidden="true">
            {lastScore.mastered ? "✓" : lastScore.total}
          </div>
          <p className="eyebrow">DRIVE DEBRIEF</p>
          <h1>{lastScore.mastered ? "Instincts switched." : "Good practice run."}</h1>
          <p className="result-lead">
            {activeIsFreeDrive
              ? "Free drive results are not saved, so you can experiment without pressure."
              : lastScore.mastered
                ? "You completed this route without a critical safety error."
                : "Review the moments below, then run it again when you’re ready."}
          </p>
          <div className="score-grid">
            <Score label="Safety" value={lastScore.safety} weight="50%" />
            <Score label="Rule use" value={lastScore.ruleUse} weight="35%" />
            <Score label="Control" value={lastScore.vehicleControl} weight="15%" />
          </div>
          <section className="incident-timeline" aria-labelledby="timeline-title">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">MIRROR MOMENTS</p>
                <h2 id="timeline-title">What happened, and why</h2>
              </div>
              <span>{events.length || 1} notes</span>
            </div>
            {events.length ? (
              events.map((event, index) => (
                <div className={`timeline-item ${event.severity ?? "info"}`} key={`${event.timestamp}-${index}`}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{event.type === "incident" ? "Critical safety reset" : event.type === "reset" ? "Checkpoint recovery" : "Coach note"}</strong>
                    <dl className="incident-explanation">
                      <div><dt>What happened</dt><dd>{event.message}</dd></div>
                      <div><dt>What to do</dt><dd>{event.type === "incident" ? "Pause, re-check the road position and retry from the safe checkpoint." : "Apply the coach note on the next approach."}</dd></div>
                      <div><dt>Why</dt><dd>{event.type === "incident" ? "Critical conflicts are reset so the lesson reinforces a safe response instead of crash recovery." : "The habit is assessed because it changes risk and predictability for other road users."}</dd></div>
                    </dl>
                  </div>
                </div>
              ))
            ) : (
              <div className="timeline-item info">
                <span className="timeline-dot" />
                <div>
                  <strong>Clean run</strong>
                  <p>No coaching incidents were recorded on this drive.</p>
                </div>
              </div>
            )}
          </section>
          <div className="results-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setView("training")}
            >
              Training Hub
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                beginDrive(
                  activeSession?.scenarioId ?? nextDrive.scenarioId,
                  activeSession?.destinationId ?? nextDrive.destinationId,
                )
              }
            >
              Retry
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                beginDrive(nextDrive.scenarioId, nextDrive.destinationId)
              }
            >
              Next — {scenarioTitle(nextDrive.scenarioId)} <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  const configured = progress.familiarSideConfirmed;
  const launcherScenarioId = configured ? recommendation.scenarioId : orientation.id;

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
          aria-label="SideSwap home"
        >
          <span className="brand-mark">S</span>
          <span className="brand-copy">
            <strong>SIDESWAP</strong>
            <small>DRIVE THE OTHER SIDE</small>
          </span>
        </button>
        <nav className="header-actions" aria-label="Main navigation">
          <button
            className={view === "training" ? "active" : ""}
            type="button"
            onClick={() => setView("training")}
          >
            Training
          </button>
          <button
            className={view === "passport" ? "active" : ""}
            type="button"
            onClick={() => setView("passport")}
          >
            Passport <span>{progress.passportStamps.length}/4</span>
          </button>
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
              <button type="button" onClick={() => { setView("training"); setMobileMenuOpen(false); }}>Training Hub</button>
              <button type="button" onClick={() => { setView("passport"); setMobileMenuOpen(false); }}>Passport <span>{progress.passportStamps.length}/4</span></button>
              <button type="button" onClick={() => { setView("settings"); setMobileMenuOpen(false); }}>Settings & accessibility</button>
              <button type="button" onClick={() => { setView("credits"); setMobileMenuOpen(false); }}>Sources & credits</button>
            </nav>
          )}
        </div>
      </header>

      {view === "passport" && (
        <PassportView progress={progress} onBack={() => setView("launcher")} />
      )}
      {view === "settings" && (
        <SettingsView
          progress={progress}
          onSave={saveSettings}
          onReset={() => {
            const reset = resetProgress();
            setProgress(reset);
            setFamiliarSide(null);
            setDestinationId(reset.lastDestinationId);
            setDestinationChosenManually(false);
            setWheelPreference(defaultWheelForDestination(reset.lastDestinationId));
            setCamera(reset.preferredCamera);
            setInput(
              window.matchMedia("(pointer: coarse)").matches
                ? "touch"
                : "keyboard",
            );
            setView("launcher");
          }}
          onBack={() => setView("launcher")}
        />
      )}
      {view === "credits" && (
        <CreditsView onBack={() => setView("launcher")} />
      )}

      {view === "launcher" && (
        <section className={`launcher-page ${configured ? "returning" : "first-run"}`}>
          <div className="launcher-copy">
            <p className="eyebrow">
              {configured ? "READY FOR YOUR NEXT DRIVE" : "A ROAD-FAMILIARISATION GAME"}
            </p>
            <h1
              aria-label={
                configured
                  ? "Swap your instincts. Start driving."
                  : "Which side feels normal to you?"
              }
            >
              {configured ? (
                <>Swap your instincts.<br /><em>Start driving.</em></>
              ) : (
                <>Which side feels<br /><em>normal to you?</em></>
              )}
            </h1>
            <p className="launcher-lead">
              {configured
                ? `Continue in ${destination.destinationName}, or choose a different training route.`
                : "Tell us where you normally drive. We’ll suggest the opposite side and put you straight into orientation."}
            </p>

            {!configured && (
              <fieldset className="launcher-familiar">
                <legend>Where do you normally drive?</legend>
                <div className="segmented two">
                  {(["right", "left"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={familiarSide === side ? "active" : ""}
                      aria-pressed={familiarSide === side}
                      onClick={() => chooseFamiliarSide(side)}
                    >
                      <span className={`lane-icon ${side}`} aria-hidden="true"><i /></span>
                      Traffic keeps {side}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

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

            <div className="launcher-setup-summary" aria-label="Current car setup">
              <button type="button" onClick={() => setCustomizeOpen(true)}>
                <small>Wheel</small><strong>{steeringSide}</strong>
              </button>
              <button type="button" onClick={() => setCustomizeOpen(true)}>
                <small>Camera</small><strong>{cameraLabels[camera]}</strong>
              </button>
              <button type="button" onClick={() => setCustomizeOpen(true)}>
                <small>Controls</small><strong>{inputLabels[input]}</strong>
              </button>
            </div>

            {destination.id === "uk-london" && (
              <p className="london-charge-note">
                London has driving charges that vary by journey and vehicle. Check the current{" "}
                <a
                  href="https://tfl.gov.uk/modes/driving/pay-to-drive-in-london"
                  target="_blank"
                  rel="noreferrer"
                >
                  Transport for London guidance ↗
                </a>
                . This note is not scored.
              </p>
            )}

            <div className="launcher-actions">
              <button
                className="primary-button launcher-primary"
                type="button"
                disabled={!familiarSide}
                onClick={() =>
                  beginDrive(
                    launcherScenarioId,
                    configured ? recommendation.destinationId : destinationId,
                  )
                }
              >
                {configured
                  ? `Continue — ${scenarioTitle(recommendation.scenarioId)}`
                  : familiarSide
                    ? `Start ${destination.destinationName} orientation`
                    : "Choose your usual traffic side"}
                <span aria-hidden="true">→</span>
              </button>
              {configured && (
                <button className="secondary-button" type="button" onClick={() => setView("training")}>Choose a drive</button>
              )}
              <button
                ref={customizeTriggerRef}
                className="text-button"
                type="button"
                onClick={() => setCustomizeOpen(true)}
              >
                Change setup
              </button>
            </div>
          </div>

          <div
            className={`launcher-road-visual launcher-scene-${destination.id}`}
            aria-label={`${destination.destinationName} training preview`}
          >
            <div className="launcher-sky" aria-hidden="true">
              <span className="launcher-sun" />
              <span className="launcher-cloud launcher-cloud-one" />
              <span className="launcher-cloud launcher-cloud-two" />
            </div>
            <div className="launcher-ground" aria-hidden="true" />
            <div aria-hidden="true">
              <DestinationPreviewScenery destinationId={destination.id} />
            </div>
            <div className="launcher-road"><i /><i /><i /><i /></div>
            <div className={`launcher-car ${country.trafficSide}`} aria-hidden="true">
              <span className="launcher-car-body">
                <b className="launcher-car-cabin" />
              </span>
            </div>
            <div className="launcher-place">
              <span>{country.flagEmoji} {country.countryName}</span>
              <strong>{destination.destinationName}</strong>
              <em>{destination.destinationSubtitle}</em>
              <small>Traffic keeps {country.trafficSide} · {country.speedUnit === "kmh" ? "km/h" : "mph"}</small>
            </div>
            {configured && (
              <div className="launcher-progress" aria-label="Your progress">
                <div><strong>{completedCount}</strong><span>complete</span></div>
                <div><strong>{masteryCount}</strong><span>mastered</span></div>
                <div><strong>{progress.badges.length}</strong><span>badges</span></div>
              </div>
            )}
          </div>
          <p className="launcher-legal">Familiarisation only—not legal advice or driver instruction. Map data © OpenStreetMap contributors.</p>
        </section>
      )}

      {view === "training" && (
        <section className="training-hub subpage" aria-labelledby="training-title">
          <div className="subpage-heading training-hub-heading">
            <div>
              <p className="eyebrow">TRAINING HUB</p>
              <h1 id="training-title">Choose your next drive.</h1>
              <p>Start directly from any unlocked lesson. Progress is based on safety and rule use, never speed.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setView("launcher")}>Back to launcher</button>
          </div>
          <div className="hub-country-tabs" role="group" aria-label="Choose destination">
            {(["uk", "us", "fr", "jp"] as const).map((groupCountryId) => {
              const groupCountry = getCountryProfile(groupCountryId);
              const groupDestinations = DESTINATION_PROFILES.filter(
                (item) => item.countryId === groupCountryId,
              );
              return (
                <div className="hub-destination-group" key={groupCountryId}>
                  <small>{groupCountry.flagEmoji} {groupCountry.countryName}</small>
                  <div>
                    {groupDestinations.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={destinationId === item.id ? "active" : ""}
                        aria-pressed={destinationId === item.id}
                        onClick={() => chooseDestination(item.id)}
                      >
                        <span>{item.cityMark}</span>
                        <b>{item.destinationName}</b>
                        {item.promotion === "specialist" && <em>Roundabout Academy · specialist</em>}
                        {item.promotion === "featured" && <em>Featured</em>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hub-destination-heading">
            <div><span>{country.flagEmoji}</span><div><small>{country.countryName}</small><h2>{destination.destinationName}</h2><em>{destination.destinationSubtitle}</em></div></div>
            <p>Traffic keeps <strong>{country.trafficSide}</strong> · wheel defaults <strong>{country.defaultSteeringSide}</strong></p>
          </div>
          {destination.id === "uk-london" && (
            <p className="hub-charge-note">
              Before driving in London, check current{" "}
              <a href="https://tfl.gov.uk/modes/driving/pay-to-drive-in-london" target="_blank" rel="noreferrer">
                Transport for London charge guidance ↗
              </a>
              . Charges are informational and never affect your score.
            </p>
          )}
          <div className="lesson-path hub-lessons">
            {trainingPath.map((lesson, index) => {
              const unlocked = isLessonUnlocked(progress, lesson.id);
              const complete = progress.completedLessonIds.includes(lesson.id);
              const score = progress.lessonScores[lesson.id];
              return (
                <article className={`lesson-card ${complete ? "complete" : ""}`} key={lesson.id}>
                  <span className="lesson-index">{complete ? "✓" : unlocked ? String(index + 1).padStart(2, "0") : "—"}</span>
                  <span className="lesson-copy">
                    <small>{lesson.kind === "orientation" ? "ORIENTATION" : `LEVEL ${lesson.difficulty}`} · {formatMinutes(lesson)}</small>
                    <strong>{lesson.title}</strong>
                    <em>{lesson.summary}</em>
                  </span>
                  <button
                    type="button"
                    className="lesson-start"
                    disabled={!unlocked || !familiarSide}
                    onClick={() => beginDrive(lesson.id, destinationId)}
                  >
                    {score ? `${score.total} · Drive again` : unlocked ? "Start" : "Locked"}
                  </button>
                </article>
              );
            })}
            <article className={`lesson-card free-drive-card ${isFreeDriveUnlocked(progress, destination.freeDriveId) ? "" : "locked"}`}>
              <span className="lesson-index">∞</span>
              <span className="lesson-copy"><small>OPEN PRACTICE</small><strong>{getFreeDriveForDestination(destinationId).title}</strong><em>Explore the map with local traffic and no fixed finish.</em></span>
              <button
                type="button"
                className="lesson-start"
                disabled={!isFreeDriveUnlocked(progress, destination.freeDriveId) || !familiarSide}
                onClick={() => beginDrive(destination.freeDriveId, destinationId)}
              >
                {isFreeDriveUnlocked(progress, destination.freeDriveId) ? "Start free drive" : "Complete lesson 1"}
              </button>
            </article>
          </div>
          <article className="hub-capstone">
            <div className="swap-graphic" aria-hidden="true"><span>UK</span><i /><b>FR</b></div>
            <div><p className="eyebrow">FINAL CAPSTONE</p><h2>Keep the same car. Swap the road.</h2><p>Travel from Folkestone to Coquelles, then leave the terminal driving on the opposite side.</p></div>
            <button
              type="button"
              className="secondary-button light"
              disabled={!isLessonUnlocked(progress, "uk-fr-side-swap") || !familiarSide}
              onClick={() =>
                beginDrive(
                  "uk-fr-side-swap",
                  country.id === "uk" ? destinationId : "uk-london",
                )
              }
            >
              {isLessonUnlocked(progress, "uk-fr-side-swap") ? "Start capstone" : "Complete NYC, France, Japan and either UK path"}
            </button>
          </article>
        </section>
      )}

      {view !== "launcher" && (
        <footer className="app-footer">
          <span>SideSwap is familiarisation, not legal advice or driver instruction.</span>
          <span>Map data © OpenStreetMap contributors · ODbL</span>
        </footer>
      )}

      {customizeOpen && (
        <SetupSheet
          country={country}
          destination={destination}
          wheelPreference={wheelPreference}
          camera={camera}
          input={input}
          onWheelChange={setWheelPreference}
          onCameraChange={setCamera}
          onInputChange={setInput}
          onClose={closeCustomize}
          returnFocusRef={customizeTriggerRef}
        />
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

function SetupSheet({
  country,
  destination,
  wheelPreference,
  camera,
  input,
  onWheelChange,
  onCameraChange,
  onInputChange,
  onClose,
  returnFocusRef,
}: {
  country: ReturnType<typeof getCountryProfile>;
  destination: ReturnType<typeof getDestinationProfile>;
  wheelPreference: SteeringSide;
  camera: CameraMode;
  input: InputFamily;
  onWheelChange: (value: SteeringSide) => void;
  onCameraChange: (value: CameraMode) => void;
  onInputChange: (value: InputFamily) => void;
  onClose: () => void;
  returnFocusRef: { readonly current: HTMLButtonElement | null };
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose, returnFocusRef]);

  const resolvedWheel = resolveSteeringSide(wheelPreference, country);

  return (
    <div
      className="setup-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="setup-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-sheet-title"
      >
        <div className="setup-sheet-heading">
          <div>
            <p className="eyebrow">CAR SETUP</p>
            <h2 id="setup-sheet-title">Ready your drive</h2>
          </div>
          <button className="sheet-close" type="button" onClick={onClose} aria-label="Close car setup">×</button>
        </div>
        <p className="setup-sheet-intro">
          {country.flagEmoji} {destination.destinationName} traffic keeps <strong>{country.trafficSide}</strong>. Your wheel choice changes only the cockpit and sight lines.
        </p>
        <div className="setup-choice-stack">
          <OptionPicker<SteeringSide>
            label="Wheel position"
            value={wheelPreference}
            options={[
              { value: "left", symbol: "L", label: "Left", hint: "Wheel on the left" },
              { value: "right", symbol: "R", label: "Right", hint: "Wheel on the right" },
            ]}
            onChange={onWheelChange}
            hint={`Selected cockpit: wheel on the ${resolvedWheel}. Destination defaults are applied when you switch cities.`}
          />
          <OptionPicker<CameraMode>
            label="Starting camera"
            value={camera}
            options={CAMERA_CHOICES}
            onChange={onCameraChange}
          />
          <OptionPicker<InputFamily>
            label="Control prompts"
            value={input}
            options={INPUT_CHOICES}
            onChange={onInputChange}
            hint="Every input remains active; this choice sets the prompts you see first."
          />
        </div>
        <details className="control-help">
          <summary>{inputLabels[input]} controls</summary>
          {input === "keyboard" && <p><kbd>WASD</kbd> drive · <kbd>Q/E</kbd> indicators · <kbd>C</kbd> camera · <kbd>Z/X/V</kbd> look · <kbd>G</kbd> D/R · <kbd>H</kbd> horn · <kbd>Esc</kbd> pause</p>}
          {input === "gamepad" && <p>Left stick steers · triggers accelerate and brake · face buttons control horn, camera and indicators · Menu pauses.</p>}
          {input === "touch" && <p>Left thumb steers · right pedals accelerate and brake · swipe the road to look · on-screen buttons manage D/R, indicators, camera, horn and pause.</p>}
        </details>
        <button className="primary-button sheet-done" type="button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function Score({ label, value, weight }: { label: string; value: number; weight: string }) {
  return <div className="score-card"><div className="score-ring" style={{ "--score": `${value * 3.6}deg` } as CSSProperties}><span>{value}</span></div><strong>{label}</strong><small>{weight} of total</small></div>;
}

function PassportView({ progress, onBack }: { progress: PlayerProgressV1; onBack: () => void }) {
  return (
    <section className="subpage">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">DRIVING PASSPORT</p>
          <h1>Your practised road habits</h1>
          <p>Stamps celebrate completed country lessons; badges recognise specific safe-driving skills.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to training</button>
      </div>
      <div className="passport-grid">
        {COUNTRY_PROFILES.map((country) => {
          const earned = progress.passportStamps.includes(country.id);
          const countryDestinations = DESTINATION_PROFILES.filter(
            (item) => item.countryId === country.id,
          );
          return (
            <article className={`passport-stamp ${earned ? "earned" : ""}`} key={country.id}>
              <span className="stamp-flag">{country.flagEmoji}</span>
              <span className="stamp-ring">
                <b>{COUNTRY_MARKS[country.id]}</b>
                <small>{earned ? "PRACTISED" : "NOT YET"}</small>
              </span>
              <h2>{country.countryName}</h2>
              <div className="passport-destination-progress">
                {countryDestinations.map((item) => {
                  const lessons = getLessonsForDestination(item.id);
                  const completed = lessons.filter((lesson) =>
                    progress.completedLessonIds.includes(lesson.id),
                  ).length;
                  return (
                    <p key={item.id}>
                      <strong>{item.destinationName}</strong>
                      <span>{completed}/{lessons.length} lessons</span>
                    </p>
                  );
                })}
              </div>
              <p>Traffic keeps {country.trafficSide}</p>
            </article>
          );
        })}
      </div>
      <div className="badge-section">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">SKILL BADGES</p>
            <h2>{progress.badges.length ? "Habits you’ve earned" : "Your first badge is one clean drive away"}</h2>
          </div>
        </div>
        <div className="badge-grid">
          {Object.entries(BADGE_LABELS).map(([id, label]) => (
            <div key={id} className={`badge-chip ${progress.badges.includes(id as never) ? "earned" : ""}`}>
              <span aria-hidden="true">◆</span>{label}
            </div>
          ))}
        </div>
      </div>
    </section>
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

function SettingsView({ progress, onSave, onReset, onBack }: { progress: PlayerProgressV1; onSave: (value: PlayerProgressV1) => void; onReset: () => void; onBack: () => void }) {
  const [draft, setDraft] = useState(progress);
  const updateAccessibility = (patch: Partial<PlayerProgressV1["accessibility"]>) => setDraft((current) => ({ ...current, accessibility: { ...current.accessibility, ...patch } }));
  return (
    <section className="subpage settings-page">
      <div className="subpage-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>Make the road comfortable to read</h1>
          <p>Visual and audio coaching remain independent of the score.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to training</button>
      </div>
      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="driving-preferences-title">
          <h2 id="driving-preferences-title">Driving preferences</h2>
          <OptionPicker<TrafficSide>
            label="Familiar traffic side"
            value={draft.familiarTrafficSide}
            options={TRAFFIC_SIDE_CHOICES}
            onChange={(familiarTrafficSide) => setDraft((current) => ({ ...current, familiarTrafficSide }))}
            hint="This changes recommendations only; each destination keeps its local road rules."
          />
          <OptionPicker<CameraMode>
            label="Default camera"
            value={draft.preferredCamera}
            options={CAMERA_CHOICES}
            onChange={(preferredCamera) => setDraft((current) => ({ ...current, preferredCamera }))}
          />
          <OptionPicker<InputFamily>
            label="Control prompts"
            value={draft.preferredInput}
            options={INPUT_CHOICES}
            onChange={(preferredInput) => setDraft((current) => ({ ...current, preferredInput }))}
            hint="SideSwap still listens to keyboard, gamepad and touch at the same time."
          />
          <div className="settings-toggle-stack">
            <Toggle label="Camera shake" checked={draft.accessibility.cameraShake} onChange={(checked) => updateAccessibility({ cameraShake: checked })} />
            <Toggle label="First-person head bob" checked={draft.accessibility.headBob} onChange={(checked) => updateAccessibility({ headBob: checked })} />
          </div>
        </section>
        <section className="settings-card" aria-labelledby="accessibility-audio-title">
          <h2 id="accessibility-audio-title">Accessibility & audio</h2>
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
            <RangeControl label="Coach volume" value={draft.accessibility.coachVolume} min={0} max={1} step={0.05} formatValue={(value) => `${Math.round(value * 100)}%`} ariaValueText={(value) => `${Math.round(value * 100)} percent`} onChange={(coachVolume) => updateAccessibility({ coachVolume })} />
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
  return <section className="subpage"><div className="subpage-heading"><div><p className="eyebrow">SOURCES & CREDITS</p><h1>Rules should have receipts.</h1><p>Every assessed rule is tied to an official source and review date. OpenStreetMap supplies geography only.</p></div><button className="secondary-button" type="button" onClick={onBack}>Back to training</button></div><div className="source-list">{references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer"><span>{reference.jurisdiction}</span><strong>{reference.title}</strong><small>{reference.authority} · reviewed {reference.reviewedOn}</small><b aria-hidden="true">↗</b></a>)}</div><article className="license-card"><p className="eyebrow">MAP DATA</p><h2>Frozen, credited, and separate from the law</h2><p>SideSwap includes compact snapshots for Upper West Side, South Kensington, Milton Keynes, Calais/Coquelles and Setagaya. Each extract records its bounds, freeze timestamp, source and content checksums, and importer version. The game makes no runtime map requests.</p><div className="map-downloads" aria-label="Download frozen map extracts">{extracts.map(([label, filename]) => <a key={filename} href={`/map-data/${filename}`} download><span>{label}</span><small>JSON · importer v2</small></a>)}</div><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors · ODbL 1.0 ↗</a></article></section>;
}
