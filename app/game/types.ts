export type TrafficSide = "left" | "right";
export type SteeringSide = TrafficSide;
export type SteeringPreference = "auto" | SteeringSide;
export type SpeedUnit = "mph" | "kmh";
export type CameraMode = "first_person" | "third_person";
export type InputFamily = "keyboard" | "gamepad" | "touch";
export type Gear = "drive" | "reverse";

export type CountryId = "us" | "uk" | "fr" | "jp";

export type DestinationId =
  | "us-nyc"
  | "uk-london"
  | "uk-milton-keynes"
  | "fr-calais"
  | "jp-tokyo";

export type MapId =
  | "orientation-yard"
  | "nyc-upper-west-side"
  | "london-south-kensington"
  | "milton-keynes-oldbrook"
  | "calais-coquelles"
  | "tokyo-setagaya"
  | "folkestone-coquelles";

export type LessonId =
  | "orientation-right"
  | "orientation-left"
  | "us-one-way-grid"
  | "us-signals-crosswalks"
  | "us-lane-choice"
  | "uk-left-side-basics"
  | "uk-roundabouts"
  | "uk-dual-carriageway"
  | "uk-london-left-side-basics"
  | "uk-london-museum-traffic"
  | "uk-london-exhibition-road"
  | "fr-right-side-basics"
  | "fr-priority-roundabouts"
  | "fr-speed-merging"
  | "jp-left-side-basics"
  | "jp-vulnerable-road-users"
  | "jp-railway-crossings"
  | "uk-fr-side-swap";

export type FreeDriveId =
  | "free-us"
  | "free-uk"
  | "free-uk-london"
  | "free-fr"
  | "free-jp";

export type ScenarioId = LessonId | FreeDriveId;

export type RuleCode =
  | "collision"
  | "wrong_way"
  | "red_light"
  | "out_of_bounds"
  | "speeding"
  | "incomplete_stop"
  | "missing_indicator"
  | "unsafe_gap"
  | "following_distance"
  | "lane_misuse"
  | "box_junction"
  | "restricted_lane"
  | "one_way"
  | "roundabout_yield"
  | "merge"
  | "pedestrian_priority"
  | "cyclist_clearance"
  | "railway_crossing"
  | "priority_to_right"
  | "observation"
  | "border_transition";

export type RuleSeverity = "coach" | "minor" | "critical";

export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

export interface WorldPose {
  readonly position: WorldPoint;
  readonly headingDeg: number;
}

export interface GeographicBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface OfficialRuleReference {
  readonly id: string;
  readonly title: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly url: string;
  readonly reviewedOn: string;
  readonly appliesTo: readonly RuleCode[];
}

export interface LanePolicy {
  readonly keepSide: TrafficSide;
  readonly passingSide: TrafficSide;
  readonly slowLaneSide: TrafficSide;
  readonly turnOnRed: "permitted_after_stop_unless_signed" | "prohibited";
}

export interface RoundaboutPolicy {
  readonly circulation: "clockwise" | "counterclockwise";
  readonly yieldToTrafficFrom: TrafficSide;
  readonly entrySide: TrafficSide;
}

export interface CountryVisualTheme {
  readonly sky: string;
  readonly ground: string;
  readonly road: string;
  readonly laneMarking: string;
  readonly accent: string;
  readonly architecture: string;
  readonly roadsideDetails: readonly string[];
}

export interface CountryProfile {
  readonly id: CountryId;
  readonly countryCode: string;
  readonly countryName: string;
  readonly flagEmoji: string;
  readonly trafficSide: TrafficSide;
  readonly defaultSteeringSide: SteeringSide;
  readonly speedUnit: SpeedUnit;
  readonly lanePolicy: LanePolicy;
  readonly roundaboutPolicy: RoundaboutPolicy;
  readonly priorityPolicy: string;
  readonly officialReferences: readonly OfficialRuleReference[];
  readonly reviewedOn: string;
}

export type DestinationPromotion = "featured" | "standard" | "specialist";

export interface DestinationProfile {
  readonly id: DestinationId;
  readonly countryId: CountryId;
  readonly destinationName: string;
  readonly destinationSubtitle: string;
  readonly mapId: MapId;
  readonly lessonIds: readonly LessonId[];
  readonly freeDriveId: FreeDriveId;
  readonly promotion: DestinationPromotion;
  readonly cityMark: string;
  readonly visualTheme: CountryVisualTheme;
}

export type LaneRole =
  | "travel"
  | "passing"
  | "entry"
  | "exit"
  | "roundabout"
  | "one_way"
  | "rail_crossing"
  | "terminal";

export interface LaneNode {
  readonly id: string;
  readonly position: WorldPoint;
}

export interface LaneSegment {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly centerline: readonly WorldPoint[];
  readonly role: LaneRole;
  readonly trafficSide: TrafficSide;
  readonly speedLimit: number;
  readonly successors: readonly string[];
  readonly adjacentLaneIds?: readonly string[];
}

export type TrafficControlType =
  | "stop"
  | "yield"
  | "signal"
  | "crosswalk"
  | "railway_signal"
  | "box_junction"
  | "restricted_lane"
  | "side_swap_gate";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface ScenarioClock {
  readonly weekday: Weekday;
  readonly minutesAfterMidnight: number;
  readonly label: string;
}

export interface RestrictionWindow {
  readonly weekdays: readonly Weekday[];
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface LaneRestriction {
  readonly id: string;
  readonly laneId: string;
  readonly ruleCode: "restricted_lane";
  readonly activeWindows: readonly RestrictionWindow[];
  readonly sourceReferenceId: string;
  readonly message: string;
}

export interface TrafficControl {
  readonly id: string;
  readonly type: TrafficControlType;
  readonly position: WorldPoint;
  readonly headingDeg: number;
  readonly laneIds: readonly string[];
  readonly conflictZoneIds?: readonly string[];
}

export interface ConflictZone {
  readonly id: string;
  readonly laneIds: readonly string[];
  readonly polygon: readonly WorldPoint[];
}

export interface MapSpawnPoint {
  readonly id: string;
  readonly kind: "player" | "vehicle" | "pedestrian" | "cyclist";
  readonly pose: WorldPose;
  readonly laneId?: string;
}

export interface MapCheckpoint {
  readonly id: string;
  readonly label: string;
  readonly pose: WorldPose;
  readonly laneId: string;
}

export interface LaneGraph {
  readonly nodes: readonly LaneNode[];
  readonly lanes: readonly LaneSegment[];
  readonly controls: readonly TrafficControl[];
  readonly conflictZones: readonly ConflictZone[];
  readonly spawnPoints: readonly MapSpawnPoint[];
  readonly checkpoints: readonly MapCheckpoint[];
  readonly restrictions?: readonly LaneRestriction[];
}

export interface FrozenMapSource {
  readonly boundingBox: GeographicBounds;
  readonly additionalBoundingBoxes?: readonly GeographicBounds[];
  readonly capturedOn: string;
  readonly sourceUrl: string;
  readonly checksum: string;
  readonly importerVersion: string;
  readonly attribution: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
}

export interface ProceduralBlock {
  readonly id: string;
  readonly center: WorldPoint;
  readonly size: WorldPoint;
  readonly heightRange: readonly [number, number];
  readonly density: number;
  readonly material: string;
}

export interface ProceduralLandmark {
  readonly id: string;
  readonly kind:
    | "park"
    | "station"
    | "terminal"
    | "railway"
    | "tower"
    | "shops";
  readonly center: WorldPoint;
  readonly size: WorldPoint;
  readonly color: string;
}

export interface ProceduralMapGeometry {
  readonly worldSize: WorldPoint;
  readonly roadWidth: number;
  readonly shoulderWidth: number;
  readonly blocks: readonly ProceduralBlock[];
  readonly landmarks: readonly ProceduralLandmark[];
}

export interface MapPack {
  readonly id: MapId;
  readonly name: string;
  readonly areaLabel: string;
  readonly countryIds: readonly CountryId[];
  readonly source: FrozenMapSource;
  readonly geometry: ProceduralMapGeometry;
  readonly laneGraph: LaneGraph;
}

export interface LessonObjective {
  readonly id: string;
  readonly label: string;
  readonly ruleCode?: RuleCode;
}

export type CoachTrigger =
  | { readonly type: "start" }
  | { readonly type: "route_progress"; readonly value: number }
  | { readonly type: "checkpoint"; readonly checkpointId: string }
  | { readonly type: "rule_event"; readonly ruleCode: RuleCode };

export interface CoachPrompt {
  readonly id: string;
  readonly trigger: CoachTrigger;
  readonly message: string;
  readonly sourceReferenceId?: string;
}

export interface ProfileTransition {
  readonly checkpointId: string;
  readonly fromCountryId: CountryId;
  readonly toCountryId: CountryId;
  readonly message: string;
}

export interface LessonUnlocks {
  readonly lessonIds: readonly LessonId[];
  readonly freeDriveIds: readonly FreeDriveId[];
}

export interface LessonDefinition {
  readonly id: LessonId;
  readonly kind: "orientation" | "guided" | "transition";
  readonly title: string;
  readonly summary: string;
  readonly mapId: MapId;
  readonly countryId?: CountryId;
  readonly destinationId?: DestinationId;
  readonly trafficSide: TrafficSide;
  readonly difficulty: 1 | 2 | 3 | 4;
  readonly estimatedMinutes: readonly [number, number];
  readonly route: readonly string[];
  readonly objectives: readonly LessonObjective[];
  readonly trafficSeed: number;
  readonly trafficDensity: "none" | "light" | "moderate" | "busy";
  readonly vulnerableRoadUsers: Readonly<{
    pedestrians: number;
    cyclists: number;
  }>;
  readonly checkpoints: readonly string[];
  readonly coachPrompts: readonly CoachPrompt[];
  readonly assessedRules: readonly RuleCode[];
  readonly sourceReferenceIds: readonly string[];
  readonly prerequisites: readonly LessonId[];
  readonly unlocks: LessonUnlocks;
  readonly profileTransitions?: readonly ProfileTransition[];
  readonly scenarioClock?: ScenarioClock;
}

export interface FreeDriveDefinition {
  readonly id: FreeDriveId;
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  readonly mapId: MapId;
  readonly title: string;
  readonly description: string;
  readonly unlockAfter: LessonId;
  readonly trafficSeed: number;
  readonly scenarioClock?: ScenarioClock;
}

export interface AssistanceSettings {
  readonly coachPrompts: boolean;
  readonly subtitles: boolean;
  readonly wrongSideWarnings: boolean;
  readonly autoResetAfterCriticalError: boolean;
  readonly reducedMotion: boolean;
}

export interface GameSessionConfig {
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  readonly scenarioId: ScenarioId;
  readonly familiarTrafficSide: TrafficSide;
  readonly steeringPreference: SteeringPreference;
  readonly camera: CameraMode;
  readonly inputFamily: InputFamily;
  readonly assistance: AssistanceSettings;
}

export interface ResolvedGameSessionConfig extends GameSessionConfig {
  readonly countryId: CountryId;
  readonly trafficSide: TrafficSide;
  readonly steeringSide: SteeringSide;
  readonly speedUnit: SpeedUnit;
}

export interface RuleEvent {
  readonly id: string;
  readonly code: RuleCode;
  readonly severity: RuleSeverity;
  readonly timestampMs: number;
  readonly message: string;
  readonly correction: string;
  readonly penalty: number;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
  readonly checkpointId?: string;
}

export interface ScoringConfig {
  readonly weights: Readonly<{
    safety: number;
    ruleUse: number;
    vehicleControl: number;
  }>;
  readonly masteryThreshold: number;
  readonly masteryAllowsCriticalErrors: boolean;
  readonly criticalRuleCodes: readonly RuleCode[];
  readonly penalties: Readonly<Partial<Record<RuleCode, number>>>;
}

export interface LessonScore {
  readonly lessonId: LessonId;
  readonly total: number;
  readonly safety: number;
  readonly ruleUse: number;
  readonly vehicleControl: number;
  readonly criticalErrors: number;
  readonly mastered: boolean;
  readonly completedAt: string;
  readonly durationMs: number;
}

export type BadgeId =
  | "right_side_ready"
  | "left_side_ready"
  | "signal_scholar"
  | "roundabout_ready"
  | "lane_courtesy"
  | "vulnerable_road_guardian"
  | "rail_crossing_ready"
  | "side_swap_traveler"
  | "first_person_mastery"
  | "london_city_ready";

export interface AccessibilityPreferences {
  readonly subtitles: boolean;
  readonly visualHonkIndicator: boolean;
  readonly reducedMotion: boolean;
  readonly cameraShake: boolean;
  readonly headBob: boolean;
  readonly steeringSensitivity: number;
  readonly fieldOfView: number;
  readonly masterVolume: number;
  readonly effectsVolume: number;
  readonly coachVolume: number;
}

export interface PlayerProgressV1 {
  readonly version: 1;
  readonly completedLessonIds: readonly LessonId[];
  readonly lessonScores: Readonly<Partial<Record<LessonId, LessonScore>>>;
  readonly badges: readonly BadgeId[];
  readonly passportStamps: readonly CountryId[];
  readonly familiarTrafficSide: TrafficSide;
  readonly familiarSideConfirmed: boolean;
  readonly lastCountryId: CountryId;
  readonly lastDestinationId: DestinationId;
  readonly preferredCamera: CameraMode;
  readonly preferredInput: InputFamily;
  readonly accessibility: AccessibilityPreferences;
  readonly updatedAt: string;
}

export interface RecommendedDrive {
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  readonly scenarioId: ScenarioId;
  readonly kind: "orientation" | "lesson" | "capstone" | "free_drive";
  readonly ctaLabel: string;
}

export interface LessonProgressUpdate {
  readonly score: LessonScore;
  readonly cameraUsed: CameraMode;
}
