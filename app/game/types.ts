export type TrafficSide = "left" | "right";
export type SteeringSide = TrafficSide;
export type SteeringPreference = "auto" | SteeringSide;
export type SpeedUnit = "mph" | "kmh";
export type CameraMode = "first_person" | "third_person";
export type Gear = "drive" | "reverse";

export type CountryId = "us" | "uk" | "fr" | "jp";

export type DestinationId =
  | "us-nyc"
  | "uk-london"
  | "uk-milton-keynes"
  | "fr-calais"
  | "jp-tokyo";

export type MapId =
  | "nyc-upper-west-side"
  | "london-south-kensington"
  | "milton-keynes-oldbrook"
  | "calais-coquelles"
  | "tokyo-setagaya";

export type FreeDriveId =
  | "free-us"
  | "free-uk"
  | "free-uk-london"
  | "free-fr"
  | "free-jp";

export type ScenarioId = FreeDriveId;

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
  readonly normalTravelLaneSide: TrafficSide;
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

export interface CurrencyProfile {
  /** ISO 4217 code, e.g. "GBP". */
  readonly code: string;
  readonly symbol: string;
  /** Fraction digits for display/rounding — 2 for GBP/USD/EUR, 0 for JPY. */
  readonly minorUnits: number;
}

export interface CountryProfile {
  readonly id: CountryId;
  readonly countryCode: string;
  readonly countryName: string;
  readonly flagEmoji: string;
  readonly trafficSide: TrafficSide;
  readonly defaultSteeringSide: SteeringSide;
  readonly speedUnit: SpeedUnit;
  readonly currency: CurrencyProfile;
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
  | "connector"
  | "roundabout"
  | "one_way"
  | "rail_crossing"
  | "terminal";

export interface LaneNode {
  readonly id: string;
  readonly position: WorldPoint;
}

/** A stable location measured along a directed legal lane. */
export interface LaneAnchor {
  readonly laneId: string;
  readonly distanceAlongM: number;
}

/**
 * A short junction transition inside an otherwise established running lane.
 * Guidance and spawn/checkpoint validation treat this range as connector
 * geometry rather than as a legal settled-lane position.
 */
export interface LaneConnectorRange {
  readonly startDistanceAlongM: number;
  readonly endDistanceAlongM: number;
  readonly conflictZoneId?: string;
}

export type RoadSurfaceType =
  | "standard"
  | "roundabout"
  | "shared_space"
  | "terminal"
  | "orientation";

export type RoadMarkingStyle =
  | "centre_dashed"
  | "centre_solid"
  | "lane_dashed"
  | "lane_solid"
  | "edge_solid"
  | "give_way"
  | "box_junction";

/** A physical road marking independent from the carriageway centreline. */
export interface RoadMarkingPath {
  readonly id: string;
  readonly style: RoadMarkingStyle;
  readonly points: readonly WorldPoint[];
  readonly color?: "white" | "yellow";
}

/** Visual carriageway geometry kept separate from legal lane centrelines. */
export interface RoadSurface {
  readonly id: string;
  readonly centerline: readonly WorldPoint[];
  readonly widthM: number;
  readonly laneIds: readonly string[];
  readonly surfaceType: RoadSurfaceType;
  readonly markings: readonly RoadMarkingPath[];
}

export interface LaneSegment {
  readonly id: string;
  readonly roadId: string;
  readonly widthM: number;
  readonly from: string;
  readonly to: string;
  readonly centerline: readonly WorldPoint[];
  readonly role: LaneRole;
  readonly trafficSide: TrafficSide;
  readonly speedLimit: number;
  /** Unit used by this lane's authored speed limit when it differs from the launch profile. */
  readonly localSpeedUnit?: SpeedUnit;
  readonly successors: readonly string[];
  readonly adjacentLaneIds?: readonly string[];
  readonly connectorRanges?: readonly LaneConnectorRange[];
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
  readonly approaches: readonly TrafficControlApproach[];
  readonly installations: readonly TrafficControlInstallation[];
}

export interface TrafficControlApproach {
  readonly id: string;
  readonly laneIds: readonly string[];
  readonly stopLine: LaneAnchor;
  readonly conflictZoneIds?: readonly string[];
  readonly phaseGroup: string;
}

export type TrafficControlMounting =
  | "roadside_pole"
  | "mast_arm"
  | "secondary_pole"
  | "railway_crossing"
  | "road_marking"
  | "terminal_portal";

export type TrafficControlVisualStyle =
  | "nyc_signal"
  | "uk_signal"
  | "stop_sign"
  | "yield_sign"
  | "restricted_lane"
  | "crosswalk"
  | "box_junction"
  | "japan_railway"
  | "side_swap_gate";

export interface TrafficControlInstallation {
  readonly id: string;
  readonly position: WorldPoint;
  /** Direction of travel for the approach this head faces. */
  readonly headingDeg: number;
  /** Direction from a curbside support toward an over-road mast head. */
  readonly armHeadingDeg?: number;
  readonly mounting: TrafficControlMounting;
  readonly style: TrafficControlVisualStyle;
  readonly role: "primary" | "secondary" | "companion" | "warning" | "marking";
  /** Signal approaches whose phase this physical head displays. */
  readonly approachIds?: readonly string[];
}

export interface ConflictZone {
  readonly id: string;
  readonly laneIds: readonly string[];
  readonly polygon: readonly WorldPoint[];
}

export interface AnchoredMapSpawnPoint {
  readonly id: string;
  readonly kind: "player" | "vehicle";
  readonly anchor: LaneAnchor;
}

export interface FreeMapSpawnPoint {
  readonly id: string;
  readonly kind: "pedestrian" | "cyclist";
  readonly pose: WorldPose;
  readonly laneId?: string;
}

export type MapSpawnPoint = AnchoredMapSpawnPoint | FreeMapSpawnPoint;

export interface MapCheckpoint {
  readonly id: string;
  readonly label: string;
  readonly anchor: LaneAnchor;
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

/** An interactive roadside service the player can pull up to (gas, etc.). */
export interface ServicePoint {
  readonly id: string;
  readonly kind: "gas_station";
  /** Curbside pose on the drivable lane graph the car pulls up to. */
  readonly anchor: LaneAnchor;
  /** Footprint (metres) for the rendered building/pumps. */
  readonly footprint: WorldPoint;
  readonly label: string;
}

export type GigVenueKind =
  | "residence"
  | "restaurant"
  | "shop"
  | "office"
  | "depot";

/** A named place gig pickups and drop-offs happen at, on the lane graph. */
export interface GigVenue {
  readonly id: string;
  readonly kind: GigVenueKind;
  readonly anchor: LaneAnchor;
  readonly footprint: WorldPoint;
  readonly name: string;
}

export interface ProceduralMapGeometry {
  readonly worldSize: WorldPoint;
  readonly roadWidth: number;
  readonly shoulderWidth: number;
  readonly roadSurfaces: readonly RoadSurface[];
  readonly blocks: readonly ProceduralBlock[];
  readonly landmarks: readonly ProceduralLandmark[];
  readonly servicePoints?: readonly ServicePoint[];
  readonly gigVenues?: readonly GigVenue[];
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

export type ManeuverPhase =
  | "approach"
  | "observe"
  | "pass"
  | "establish_clearance"
  | "return"
  | "complete";

export interface OvertakeExercise {
  readonly id: string;
  readonly kind: "overtake";
  readonly normalLaneId: string;
  readonly passingLaneId: string;
  readonly corridorStart: LaneAnchor;
  readonly corridorEnd: LaneAnchor;
  readonly leadVehicleStart: LaneAnchor;
  readonly leadVehicleSpeedFactor: number;
  readonly phaseAnchors: Readonly<{
    approach: LaneAnchor;
    observe: LaneAnchor;
    pass: LaneAnchor;
    return: LaneAnchor;
    complete: LaneAnchor;
  }>;
  readonly predictedClearSeconds: number;
  readonly returnStandstillGapM: number;
  readonly returnHeadwaySeconds: number;
  readonly sourceReferenceIds: readonly string[];
}

export interface FreeDriveDefinition {
  readonly id: FreeDriveId;
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  readonly mapId: MapId;
  readonly title: string;
  readonly description: string;
  readonly startSpawnId: string;
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

export interface PlayerProgressV2 {
  readonly version: 2;
  /** Money on hand per country, in that country's own currency units. */
  readonly walletByCountry: Readonly<Record<CountryId, number>>;
  /** Litres of fuel in the car, tracked per country. */
  readonly fuelByCountry: Readonly<Record<CountryId, number>>;
  /** Lifetime gig earnings per country (a running stat, never spent). */
  readonly lifetimeEarnings: Readonly<Record<CountryId, number>>;
  readonly completedGigCount: number;
  readonly lastCountryId: CountryId;
  readonly lastDestinationId: DestinationId;
  readonly preferredCamera: CameraMode;
  readonly accessibility: AccessibilityPreferences;
  readonly updatedAt: string;
}

