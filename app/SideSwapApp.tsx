"use client";

import { useEffect, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import type {
  GameCanvasLesson,
  GameHudSnapshot,
  GameRuntimeEvent,
} from "./game/GameCanvas";
import {
  COUNTRY_PROFILES,
  SCORING_CONFIG,
  getCountryProfile,
  getFreeDrive,
  getLesson,
  getLessonsForCountry,
  getMapPack,
  getOrientationForTrafficSide,
  resolveSteeringSide,
} from "./game/content";
import {
  createDefaultProgress,
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
  InputFamily,
  LessonDefinition,
  LessonId,
  LessonScore,
  PlayerProgressV1,
  SteeringPreference,
  TrafficSide,
} from "./game/types";

type View = "setup" | "driving" | "results" | "passport" | "settings" | "credits";

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
};

const COUNTRY_MARKS: Record<CountryId, string> = {
  us: "NYC",
  uk: "MK",
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

const toCanvasCamera = (camera: CameraMode): "first" | "third" =>
  camera === "first_person" ? "first" : "third";

const fromCanvasCamera = (camera: "first" | "third"): CameraMode =>
  camera === "first" ? "first_person" : "third_person";

const formatMinutes = (lesson: LessonDefinition) =>
  `${lesson.estimatedMinutes[0]}–${lesson.estimatedMinutes[1]} min`;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function initialSelectedCountry(side: TrafficSide): CountryId {
  return side === "right" ? "uk" : "us";
}

export default function SideSwapApp() {
  const [progress, setProgress] = useState<PlayerProgressV1>(() =>
    createDefaultProgress(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("setup");
  const [familiarSide, setFamiliarSide] = useState<TrafficSide>("right");
  const [countryId, setCountryId] = useState<CountryId>("uk");
  const [wheelPreference, setWheelPreference] =
    useState<SteeringPreference>("auto");
  const [camera, setCamera] = useState<CameraMode>("third_person");
  const [input, setInput] = useState<InputFamily>("keyboard");
  const [selectedLessonId, setSelectedLessonId] =
    useState<LessonId>("orientation-left");
  const [practiceMode, setPracticeMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<GameHudSnapshot | null>(null);
  const [events, setEvents] = useState<GameRuntimeEvent[]>([]);
  const [lastScore, setLastScore] = useState<LessonScore | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadProgress();
      setProgress(loaded);
      setFamiliarSide(loaded.familiarTrafficSide);
      setCountryId(initialSelectedCountry(loaded.familiarTrafficSide));
      setCamera(loaded.preferredCamera);
      setInput(loaded.preferredInput);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const country = getCountryProfile(countryId);
  const countryLessons = getLessonsForCountry(countryId);
  const orientation = getOrientationForTrafficSide(country.trafficSide);
  const trainingPath = [orientation, ...countryLessons];
  const selectedLesson = getLesson(selectedLessonId);
  const activeLesson = isLessonUnlocked(progress, selectedLesson.id)
    ? selectedLesson
    : orientation;
  const steeringSide = resolveSteeringSide(wheelPreference, country);
  const completedCount = progress.completedLessonIds.length;
  const masteryCount = Object.values(progress.lessonScores).filter(
    (score) => score?.mastered,
  ).length;
  const freeDriveUnlocked = isFreeDriveUnlocked(
    progress,
    `free-${countryId}`,
  );
  const runtimeMap = getMapPack(activeLesson.mapId);
  const runtimeLesson: GameCanvasLesson = practiceMode
    ? (() => {
        const freeDrive = getFreeDrive(`free-${countryId}`);
        const routeTemplate = countryLessons[0] ?? orientation;
        return {
          id: freeDrive.id,
          title: freeDrive.title,
          kind: "free_drive",
          trafficSide: country.trafficSide,
          route: routeTemplate.route,
          objectives: [
            {
              id: `${freeDrive.id}-explore`,
              label: "Explore safely with no fixed finish",
            },
          ],
          trafficSeed: freeDrive.trafficSeed,
          trafficDensity: "moderate",
          vulnerableRoadUsers: routeTemplate.vulnerableRoadUsers,
          checkpoints: runtimeMap.laneGraph.checkpoints.map(
            (checkpoint) => checkpoint.id,
          ),
          coachPrompts: [
            {
              id: `${freeDrive.id}-start`,
              trigger: { type: "start" },
              message:
                "Free drive has no finish line. Explore the map and practise the local road habits at your own pace.",
            },
          ],
        };
      })()
    : activeLesson;

  const themeStyle = {
    "--destination-accent": country.visualTheme.accent,
    "--destination-sky": country.visualTheme.sky,
    "--destination-ground": country.visualTheme.ground,
  } as CSSProperties;

  const chooseFamiliarSide = (side: TrafficSide) => {
    setFamiliarSide(side);
    setCountryId(initialSelectedCountry(side));
    setWheelPreference("auto");
    const nextCountry = getCountryProfile(initialSelectedCountry(side));
    setSelectedLessonId(getOrientationForTrafficSide(nextCountry.trafficSide).id);
  };

  const chooseCountry = (id: CountryId) => {
    const next = getCountryProfile(id);
    setCountryId(id);
    setWheelPreference("auto");
    const firstCountryLesson = getLessonsForCountry(id)[0];
    setSelectedLessonId(
      firstCountryLesson && isLessonUnlocked(progress, firstCountryLesson.id)
        ? firstCountryLesson.id
        : getOrientationForTrafficSide(next.trafficSide).id,
    );
    setPracticeMode(false);
  };

  const beginDrive = (practice = false) => {
    const lesson = practice ? countryLessons[0] ?? orientation : activeLesson;
    setSelectedLessonId(lesson.id);
    setPracticeMode(practice);
    setEvents([]);
    setHud(null);
    setPaused(false);
    setStartedAt(Date.now());
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
    if (!practiceMode) {
      const updated = updateLessonProgress(progress, {
        score,
        cameraUsed: camera,
      });
      const withPreferences: PlayerProgressV1 = {
        ...updated,
        familiarTrafficSide: familiarSide,
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
          key={`${country.id}-${runtimeLesson.id}-${steeringSide}`}
          className="game-canvas"
          trafficSide={runtimeLesson.trafficSide}
          steeringSide={steeringSide}
          lesson={runtimeLesson}
          mapPack={runtimeMap}
          cameraMode={toCanvasCamera(camera)}
          inputFamily={input}
          speedUnit={country.speedUnit === "kmh" ? "km/h" : "mph"}
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
          onComplete={finishDrive}
        />
        <div className="game-brand" aria-hidden="true">
          <span className="brand-mark small">S</span>
          <span>SIDESWAP</span>
        </div>
        <div className="game-context">
          <span>{country.flagEmoji}</span>
          <div>
            <strong>{practiceMode ? "Free drive" : activeLesson.title}</strong>
            <small>
              {country.destinationName} · traffic keeps {activeLesson.trafficSide}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="game-exit"
          onClick={() => {
            setPaused(false);
            setView("setup");
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
    return (
      <main className="results-page" style={themeStyle}>
        <div className="results-card">
          <div className="result-seal" aria-hidden="true">
            {lastScore.mastered ? "✓" : lastScore.total}
          </div>
          <p className="eyebrow">DRIVE DEBRIEF</p>
          <h1>{lastScore.mastered ? "Instincts switched." : "Good practice run."}</h1>
          <p className="result-lead">
            {practiceMode
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
            <button className="secondary-button" type="button" onClick={() => beginDrive(practiceMode)}>
              Drive again
            </button>
            <button className="primary-button" type="button" onClick={() => setView("setup")}>
              Continue training <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell" style={themeStyle}>
      <header className="app-header">
        <button className="brand-button" type="button" onClick={() => setView("setup")}>
          <span className="brand-mark">S</span>
          <span className="brand-copy">
            <strong>SIDESWAP</strong>
            <small>DRIVE THE OTHER SIDE</small>
          </span>
        </button>
        <nav className="header-actions" aria-label="Main navigation">
          <button className={view === "passport" ? "active" : ""} type="button" onClick={() => setView("passport")}>
            Passport <span>{progress.passportStamps.length}/4</span>
          </button>
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => setView("settings")}>
            Settings
          </button>
          <button className={view === "credits" ? "active" : ""} type="button" onClick={() => setView("credits")}>
            Sources
          </button>
        </nav>
      </header>

      {view === "passport" && (
        <PassportView progress={progress} onBack={() => setView("setup")} />
      )}
      {view === "settings" && (
        <SettingsView
          progress={progress}
          onSave={saveSettings}
          onReset={() => {
            const reset = resetProgress();
            setProgress(reset);
            setFamiliarSide(reset.familiarTrafficSide);
            setCamera(reset.preferredCamera);
            setInput(reset.preferredInput);
          }}
          onBack={() => setView("setup")}
        />
      )}
      {view === "credits" && (
        <CreditsView onBack={() => setView("setup")} />
      )}

      {view === "setup" && (
        <>
          <section className="hero-section">
            <div className="hero-copy">
              <p className="eyebrow">A ROAD-FAMILIARISATION GAME</p>
              <h1>
                Build the right instincts
                <br />
                <em>when the road feels backwards.</em>
              </h1>
              <p className="hero-lead">
                Practice lane position, turns, signals, roundabouts and local road habits before your next trip—without racing the clock.
              </p>
              <div className="hero-stats" aria-label="Your SideSwap progress">
                <div><strong>{completedCount}</strong><span>lessons complete</span></div>
                <div><strong>{masteryCount}</strong><span>mastered</span></div>
                <div><strong>{progress.badges.length}</strong><span>skill badges</span></div>
              </div>
            </div>
            <div className="route-preview" aria-label={`${country.destinationName} route preview`}>
              <div className="preview-sky" />
              <div className="preview-city">
                {Array.from({ length: 10 }, (_, index) => (
                  <span key={index} style={{ "--i": index } as CSSProperties} />
                ))}
              </div>
              <div className="preview-road vertical"><i /><i /><i /><i /></div>
              <div className="preview-road horizontal"><i /><i /><i /></div>
              <div className={`preview-car ${country.trafficSide}`}><b /></div>
              <div className="preview-sign">KEEP<br /><strong>{country.trafficSide.toUpperCase()}</strong></div>
              <div className="preview-label">
                <span>{country.flagEmoji} LIVE TRAINING AREA</span>
                <strong>{country.destinationName}</strong>
                <small>{country.destinationSubtitle}</small>
              </div>
            </div>
          </section>

          <section className="setup-section" aria-labelledby="setup-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PRE-DRIVE CHECK</p>
                <h2 id="setup-title">Set up your training car</h2>
              </div>
              <span className="step-pill">About 30 seconds</span>
            </div>

            <div className="setup-layout">
              <div className="setup-controls">
                <fieldset className="field-group">
                  <legend><span>01</span> Where do you normally drive?</legend>
                  <p>We use this only to tailor the coaching language.</p>
                  <div className="segmented two">
                    {(["right", "left"] as const).map((side) => (
                      <button key={side} type="button" className={familiarSide === side ? "active" : ""} onClick={() => chooseFamiliarSide(side)}>
                        <span className={`lane-icon ${side}`} aria-hidden="true"><i /></span>
                        Traffic keeps {side}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="field-group destination-field">
                  <legend><span>02</span> Choose a destination</legend>
                  <p>Real road patterns, simplified into compact training routes.</p>
                  <div className="country-grid">
                    {COUNTRY_PROFILES.map((item) => (
                      <button key={item.id} type="button" className={`country-card ${countryId === item.id ? "active" : ""}`} onClick={() => chooseCountry(item.id)}>
                        <span className="country-top"><span>{item.flagEmoji}</span><b>{COUNTRY_MARKS[item.id]}</b></span>
                        <strong>{item.destinationName}</strong>
                        <small>{item.countryName} · keep {item.trafficSide}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="choice-grid">
                  <fieldset className="field-group compact-field">
                    <legend><span>03</span> Wheel position</legend>
                    <p>Traffic rules never change with the wheel.</p>
                    <div className="segmented three compact">
                      {(["auto", "left", "right"] as const).map((side) => (
                        <button key={side} type="button" className={wheelPreference === side ? "active" : ""} onClick={() => setWheelPreference(side)}>
                          {side === "auto" ? `Local · ${country.defaultSteeringSide}` : side}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="field-group compact-field">
                    <legend><span>04</span> Camera & controls</legend>
                    <div className="inline-selects">
                      <label>
                        <span>Camera</span>
                        <select value={camera} onChange={(event) => setCamera(event.target.value as CameraMode)}>
                          {Object.entries(cameraLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Controls</span>
                        <select value={input} onChange={(event) => setInput(event.target.value as InputFamily)}>
                          {Object.entries(inputLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                    </div>
                  </fieldset>
                </div>
              </div>

              <aside className="car-summary">
                <div className="summary-header">
                  <span className="summary-flag">{country.flagEmoji}</span>
                  <div><small>YOUR TRAINING CAR</small><strong>{country.destinationName}</strong></div>
                </div>
                <div className="car-diagram" aria-label={`Traffic keeps ${country.trafficSide}; wheel is on the ${steeringSide}`}>
                  <div className={`diagram-road ${country.trafficSide}`}><i /><i /><i /></div>
                  <div className={`diagram-car wheel-${steeringSide}`}><span>●</span><b /></div>
                </div>
                <dl className="car-facts">
                  <div><dt>Traffic side</dt><dd>{country.trafficSide}</dd></div>
                  <div><dt>Wheel side</dt><dd>{steeringSide}{wheelPreference === "auto" && " · local"}</dd></div>
                  <div><dt>Units</dt><dd>{country.speedUnit === "kmh" ? "km/h" : "mph"}</dd></div>
                  <div><dt>Passing side</dt><dd>{country.lanePolicy.passingSide}</dd></div>
                </dl>
                <p className="car-note">The wheel position changes your cockpit and sight lines. It never changes which side of the road you use.</p>
                <details className="control-help">
                  <summary>{inputLabels[input]} controls</summary>
                  {input === "keyboard" && (
                    <p><kbd>WASD</kbd> drive · <kbd>Q/E</kbd> indicators · <kbd>C</kbd> camera · <kbd>Z/X/V</kbd> look · <kbd>G</kbd> D/R · <kbd>H</kbd> horn · <kbd>Esc</kbd> pause</p>
                  )}
                  {input === "gamepad" && (
                    <p>Left stick steers · triggers accelerate/brake · face buttons control horn, camera and indicators · Menu pauses.</p>
                  )}
                  {input === "touch" && (
                    <p>Left thumb steers · right pedals accelerate/brake · swipe the road to look · on-screen buttons control D/R, indicators, camera, horn and pause.</p>
                  )}
                </details>
              </aside>
            </div>
          </section>

          <section className="training-section" aria-labelledby="training-title">
            <div className="section-heading">
              <div><p className="eyebrow">YOUR ROUTE</p><h2 id="training-title">Start simple. Add one challenge at a time.</h2></div>
              <span className="source-date">Rules reviewed 10 Jul 2026</span>
            </div>
            <div className="lesson-path">
              {trainingPath.map((lesson, index) => {
                const unlocked = isLessonUnlocked(progress, lesson.id);
                const complete = progress.completedLessonIds.includes(lesson.id);
                const score = progress.lessonScores[lesson.id];
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    disabled={!unlocked}
                    className={`lesson-card ${selectedLessonId === lesson.id ? "active" : ""} ${complete ? "complete" : ""}`}
                    onClick={() => { setSelectedLessonId(lesson.id); setPracticeMode(false); }}
                  >
                    <span className="lesson-index">{complete ? "✓" : unlocked ? String(index + 1).padStart(2, "0") : "—"}</span>
                    <span className="lesson-copy"><small>{lesson.kind === "orientation" ? "ORIENTATION" : `LEVEL ${lesson.difficulty}`} · {formatMinutes(lesson)}</small><strong>{lesson.title}</strong><em>{lesson.summary}</em></span>
                    <span className="lesson-score">{score ? `${score.total}` : unlocked ? "GO" : "LOCKED"}</span>
                  </button>
                );
              })}
            </div>

            <div className="launch-bar">
              <div className="launch-copy">
                <span className="launch-icon" aria-hidden="true">↗</span>
                <div><small>{activeLesson.kind.toUpperCase()} · {formatMinutes(activeLesson)}</small><strong>{activeLesson.title}</strong><p>{activeLesson.objectives.map((objective) => objective.label).join(" · ")}</p></div>
              </div>
              <div className="launch-actions">
                <button type="button" className="secondary-button" disabled={!freeDriveUnlocked} onClick={() => beginDrive(true)}>
                  {freeDriveUnlocked ? "Free drive" : "Free drive unlocks after lesson 1"}
                </button>
                <button type="button" className="primary-button large" onClick={() => beginDrive(false)}>
                  Start {activeLesson.kind === "orientation" ? "orientation" : "lesson"} <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </section>

          <section className="side-swap-banner">
            <div className="swap-graphic" aria-hidden="true"><span>UK</span><i /><b>FR</b></div>
            <div><p className="eyebrow">FINAL CAPSTONE</p><h2>Keep the same car. Swap the road.</h2><p>Enter at Folkestone, travel by shuttle, and leave Coquelles on the right. The game never pretends there is a continuous road border.</p></div>
            <button
              type="button"
              className="secondary-button light"
              disabled={!isLessonUnlocked(progress, "uk-fr-side-swap")}
              onClick={() => { setCountryId("uk"); setSelectedLessonId("uk-fr-side-swap"); setPracticeMode(false); }}
            >
              {isLessonUnlocked(progress, "uk-fr-side-swap") ? "Select capstone" : "Complete all four paths"}
            </button>
          </section>
        </>
      )}

      <footer className="app-footer">
        <span>SideSwap is familiarisation, not legal advice or driver instruction.</span>
        <span>Map data © OpenStreetMap contributors · ODbL</span>
      </footer>
    </main>
  );
}

function Score({ label, value, weight }: { label: string; value: number; weight: string }) {
  return <div className="score-card"><div className="score-ring" style={{ "--score": `${value * 3.6}deg` } as CSSProperties}><span>{value}</span></div><strong>{label}</strong><small>{weight} of total</small></div>;
}

function PassportView({ progress, onBack }: { progress: PlayerProgressV1; onBack: () => void }) {
  return <section className="subpage"><div className="subpage-heading"><div><p className="eyebrow">DRIVING PASSPORT</p><h1>Your practised road habits</h1><p>Stamps celebrate completed country lessons; badges recognise specific safe-driving skills.</p></div><button className="secondary-button" type="button" onClick={onBack}>Back to training</button></div><div className="passport-grid">{COUNTRY_PROFILES.map((country) => { const earned = progress.passportStamps.includes(country.id); const completed = getLessonsForCountry(country.id).filter((lesson) => progress.completedLessonIds.includes(lesson.id)).length; return <article className={`passport-stamp ${earned ? "earned" : ""}`} key={country.id}><span className="stamp-flag">{country.flagEmoji}</span><span className="stamp-ring"><b>{COUNTRY_MARKS[country.id]}</b><small>{earned ? "PRACTISED" : "NOT YET"}</small></span><h2>{country.destinationName}</h2><p>{completed}/3 lessons complete · traffic keeps {country.trafficSide}</p></article>; })}</div><div className="badge-section"><div className="section-heading compact"><div><p className="eyebrow">SKILL BADGES</p><h2>{progress.badges.length ? "Habits you’ve earned" : "Your first badge is one clean drive away"}</h2></div></div><div className="badge-grid">{Object.entries(BADGE_LABELS).map(([id, label]) => <div key={id} className={`badge-chip ${progress.badges.includes(id as never) ? "earned" : ""}`}><span aria-hidden="true">◆</span>{label}</div>)}</div></div></section>;
}

function SettingsView({ progress, onSave, onReset, onBack }: { progress: PlayerProgressV1; onSave: (value: PlayerProgressV1) => void; onReset: () => void; onBack: () => void }) {
  const [draft, setDraft] = useState(progress);
  const updateAccessibility = (patch: Partial<PlayerProgressV1["accessibility"]>) => setDraft((current) => ({ ...current, accessibility: { ...current.accessibility, ...patch } }));
  return <section className="subpage settings-page"><div className="subpage-heading"><div><p className="eyebrow">SETTINGS</p><h1>Make the road comfortable to read</h1><p>Visual and audio coaching remain independent of the score.</p></div><button className="secondary-button" type="button" onClick={onBack}>Back to training</button></div><div className="settings-grid"><fieldset className="settings-card"><legend>Driving preferences</legend><label><span>Familiar traffic side</span><select value={draft.familiarTrafficSide} onChange={(event) => setDraft({ ...draft, familiarTrafficSide: event.target.value as TrafficSide })}><option value="right">Traffic keeps right</option><option value="left">Traffic keeps left</option></select></label><label><span>Default camera</span><select value={draft.preferredCamera} onChange={(event) => setDraft({ ...draft, preferredCamera: event.target.value as CameraMode })}><option value="third_person">Third person</option><option value="first_person">First person</option></select></label><label><span>Default controls</span><select value={draft.preferredInput} onChange={(event) => setDraft({ ...draft, preferredInput: event.target.value as InputFamily })}><option value="keyboard">Keyboard</option><option value="gamepad">Gamepad</option><option value="touch">Touch</option></select></label><Toggle label="Camera shake" checked={draft.accessibility.cameraShake} onChange={(checked) => updateAccessibility({ cameraShake: checked })} /><Toggle label="First-person head bob" checked={draft.accessibility.headBob} onChange={(checked) => updateAccessibility({ headBob: checked })} /></fieldset><fieldset className="settings-card"><legend>Accessibility & audio</legend><Toggle label="Subtitles" checked={draft.accessibility.subtitles} onChange={(checked) => updateAccessibility({ subtitles: checked })} /><Toggle label="Visual honk cue" checked={draft.accessibility.visualHonkIndicator} onChange={(checked) => updateAccessibility({ visualHonkIndicator: checked })} /><Toggle label="Reduced motion" checked={draft.accessibility.reducedMotion} onChange={(checked) => updateAccessibility({ reducedMotion: checked })} /><label><span>Steering sensitivity <b>{draft.accessibility.steeringSensitivity.toFixed(1)}×</b></span><input aria-label="Steering sensitivity" type="range" min="0.5" max="2" step="0.1" value={draft.accessibility.steeringSensitivity} onChange={(event) => updateAccessibility({ steeringSensitivity: Number(event.target.value) })} /></label><label><span>Field of view <b>{draft.accessibility.fieldOfView}°</b></span><input aria-label="Field of view" type="range" min="55" max="100" step="1" value={draft.accessibility.fieldOfView} onChange={(event) => updateAccessibility({ fieldOfView: Number(event.target.value) })} /></label><label><span>Master volume <b>{Math.round(draft.accessibility.masterVolume * 100)}%</b></span><input aria-label="Master volume" type="range" min="0" max="1" step="0.05" value={draft.accessibility.masterVolume} onChange={(event) => updateAccessibility({ masterVolume: Number(event.target.value) })} /></label><label><span>Effects volume <b>{Math.round(draft.accessibility.effectsVolume * 100)}%</b></span><input aria-label="Effects volume" type="range" min="0" max="1" step="0.05" value={draft.accessibility.effectsVolume} onChange={(event) => updateAccessibility({ effectsVolume: Number(event.target.value) })} /></label><label><span>Coach volume <b>{Math.round(draft.accessibility.coachVolume * 100)}%</b></span><input aria-label="Coach volume" type="range" min="0" max="1" step="0.05" value={draft.accessibility.coachVolume} onChange={(event) => updateAccessibility({ coachVolume: Number(event.target.value) })} /></label></fieldset></div><div className="settings-actions"><button type="button" className="danger-button" onClick={onReset}>Reset local progress</button><button type="button" className="primary-button" onClick={() => { onSave({ ...draft, updatedAt: new Date().toISOString() }); onBack(); }}>Save settings</button></div></section>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function CreditsView({ onBack }: { onBack: () => void }) {
  const references = Array.from(new Map(COUNTRY_PROFILES.flatMap((country) => country.officialReferences).map((reference) => [reference.id, reference])).values());
  const extracts = [
    ["New York", "nyc-upper-west.json"],
    ["Milton Keynes", "uk-milton-keynes.json"],
    ["Calais / Coquelles", "fr-calais-coquelles.json"],
    ["Tokyo Setagaya", "jp-setagaya.json"],
  ] as const;
  return <section className="subpage"><div className="subpage-heading"><div><p className="eyebrow">SOURCES & CREDITS</p><h1>Rules should have receipts.</h1><p>Every assessed rule is tied to an official source and review date. OpenStreetMap supplies geography only.</p></div><button className="secondary-button" type="button" onClick={onBack}>Back to training</button></div><div className="source-list">{references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer"><span>{reference.jurisdiction}</span><strong>{reference.title}</strong><small>{reference.authority} · reviewed {reference.reviewedOn}</small><b aria-hidden="true">↗</b></a>)}</div><article className="license-card"><p className="eyebrow">MAP DATA</p><h2>Frozen, credited, and separate from the law</h2><p>SideSwap includes compact snapshots for Upper West Side, Milton Keynes, Calais/Coquelles and Setagaya. Each extract records its bounds, freeze timestamp, source and content checksums, and importer version. The game makes no runtime map requests.</p><div className="map-downloads" aria-label="Download frozen map extracts">{extracts.map(([label, filename]) => <a key={filename} href={`/map-data/${filename}`} download><span>{label}</span><small>JSON · importer v2</small></a>)}</div><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data © OpenStreetMap contributors · ODbL 1.0 ↗</a></article></section>;
}
