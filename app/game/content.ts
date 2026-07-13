import type {
  CoachPrompt,
  CountryId,
  CountryProfile,
  CountryVisualTheme,
  DestinationId,
  DestinationProfile,
  FreeDriveDefinition,
  FreeDriveId,
  FrozenMapSource,
  GameSessionConfig,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  LessonDefinition,
  LessonId,
  MapCheckpoint,
  MapId,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  ResolvedGameSessionConfig,
  RuleCode,
  RoadSurface,
  ScenarioId,
  ScoringConfig,
  SpeedUnit,
  SteeringPreference,
  SteeringSide,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  TrafficSide,
  WorldPoint,
} from "./types";
import {
  LONDON_FREE_DRIVE,
  LONDON_LESSONS,
  LONDON_MAP_PACK,
  LONDON_RULE_REFERENCES,
} from "./londonContent";

export const CONTENT_REVIEWED_ON = "2026-07-10";

const NYC_THEME: CountryVisualTheme = {
  sky: "#9ed7ef",
  ground: "#6e8a5b",
  road: "#323840",
  laneMarking: "#f5d760",
  accent: "#f36a3d",
  architecture: "warm brick apartment blocks and broad avenues",
  roadsideDetails: ["yellow taxis", "fire hydrants", "street trees"],
};

const LONDON_THEME: CountryVisualTheme = {
  sky: "#b9d3dc",
  ground: "#668a58",
  road: "#393d43",
  laneMarking: "#f3f0dd",
  accent: "#d83b3f",
  architecture: "sandstone museums, stucco terraces and broad civic avenues",
  roadsideDetails: ["red buses", "black cabs", "Belisha beacons"],
};

const MILTON_KEYNES_THEME: CountryVisualTheme = {
  sky: "#a9c9d3",
  ground: "#5f8d50",
  road: "#3a3d42",
  laneMarking: "#f0f0e8",
  accent: "#e5484d",
  architecture: "low modern estates, hedges and grid-road landscaping",
  roadsideDetails: ["mini roundabouts", "chevron boards", "red buses"],
};

const CALAIS_THEME: CountryVisualTheme = {
  sky: "#a8d8eb",
  ground: "#84a65d",
  road: "#3d4145",
  laneMarking: "#f4f1e8",
  accent: "#2456a6",
  architecture: "pale coastal buildings, retail roads and terminal fencing",
  roadsideDetails: ["blue direction signs", "bollards", "channel grassland"],
};

const TOKYO_THEME: CountryVisualTheme = {
  sky: "#acd9e9",
  ground: "#769b69",
  road: "#44494c",
  laneMarking: "#f7f3df",
  accent: "#e64f52",
  architecture: "compact homes, utility poles and small station-front shops",
  roadsideDetails: ["rail crossings", "bicycles", "vending machines"],
};

const point = (x: number, z: number): WorldPoint => ({ x, z });

const node = (id: string, x: number, z: number): LaneNode => ({
  id,
  position: point(x, z),
});

const roadIdForLane = (id: string): string => {
  if (id.startsWith("yard-r-")) return "yard-right-loop";
  if (id.startsWith("yard-l-")) return "yard-left-loop";
  if (id.startsWith("nyc-72-")) return "nyc-west-72";
  if (id.startsWith("nyc-79-")) return "nyc-west-79";
  if (id.startsWith("nyc-bway-")) return "nyc-broadway";
  if (id.startsWith("nyc-columbus-")) return "nyc-columbus";
  if (id.startsWith("nyc-west-end-")) return "nyc-west-end";
  if (id.startsWith("uk-rb-")) return "uk-roundabout";
  if (id.includes("entry-north") || id.includes("exit-north")) return id.startsWith("fr-") ? "fr-north-approach" : "uk-north-approach";
  if (id.includes("entry-east") || id.includes("exit-east")) return id.startsWith("fr-") ? "fr-east-approach" : "uk-east-approach";
  if (id.includes("entry-south") || id.includes("exit-south")) return id.startsWith("fr-") ? "fr-south-approach" : "uk-south-approach";
  if (id.includes("entry-west") || id.includes("exit-west")) return id.startsWith("fr-") ? "fr-west-approach" : "uk-west-approach";
  if (id.startsWith("uk-dual-n-east")) return "uk-dual-carriageway";
  if (id.startsWith("uk-east-north")) return "uk-east-link";
  if (id.startsWith("uk-south-west") || id.startsWith("uk-west-south")) return "uk-oldbrook-loop";
  if (id.startsWith("fr-rb-")) return "fr-roundabout";
  if (id.startsWith("fr-south-east")) return "fr-south-east-road";
  if (id.startsWith("fr-east-south")) return "fr-east-south-road";
  if (id.startsWith("fr-north-west")) return "fr-north-west-road";
  if (id.startsWith("jp-south-east")) return "jp-south-road";
  if (id.startsWith("jp-curve")) return "jp-east-curve";
  if (id.startsWith("jp-center-west")) return "jp-center-road";
  if (id.startsWith("jp-west-north")) return "jp-west-road";
  if (id.startsWith("jp-north-east")) return "jp-north-road";
  if (id.startsWith("jp-junction-south")) return "jp-junction-road";
  if (id.startsWith("jp-narrow-north")) return "jp-narrow-road";
  if (id.startsWith("xf-uk-approach")) return "xf-uk-road";
  if (id.startsWith("xf-uk-terminal")) return "xf-uk-terminal-road";
  if (id.startsWith("xf-shuttle")) return "xf-shuttle-road";
  if (id.startsWith("xf-fr-terminal") || id.startsWith("xf-fr-exit")) return "xf-fr-terminal-road";
  if (id.startsWith("xf-fr-road")) return "xf-fr-road-surface";
  return id;
};

const laneWidthForLane = (id: string): number => {
  if (id.startsWith("jp-")) return id.includes("narrow") ? 2.7 : 3.0;
  if (id.startsWith("uk-dual") || id.startsWith("fr-south-east") || id.startsWith("xf-")) return 3.5;
  if (id.startsWith("nyc-")) return 3.4;
  return 3.2;
};

const lane = (
  id: string,
  from: LaneNode,
  to: LaneNode,
  trafficSide: TrafficSide,
  speedLimit: number,
  successors: readonly string[],
  role: LaneRole = "travel",
  via: readonly WorldPoint[] = [],
  adjacentLaneIds?: readonly string[],
  roadId: string = roadIdForLane(id),
  widthM = laneWidthForLane(id),
  localSpeedUnit?: SpeedUnit,
): LaneSegment => ({
  id,
  roadId,
  widthM,
  from: from.id,
  to: to.id,
  centerline: [from.position, ...via, to.position],
  role,
  trafficSide,
  speedLimit,
  ...(localSpeedUnit ? { localSpeedUnit } : {}),
  successors,
  ...(adjacentLaneIds ? { adjacentLaneIds } : {}),
});

const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

const roadSurface = (
  id: string,
  centerline: readonly WorldPoint[],
  widthM: number,
  laneIds: readonly string[],
  marking: RoadSurface["marking"] = "center_line",
): RoadSurface => ({ id, centerline, widthM, laneIds, marking });

const checkpoint = (
  id: string,
  label: string,
  laneId: string,
  distanceAlongM: number,
): MapCheckpoint => ({
  id,
  label,
  anchor: anchor(laneId, distanceAlongM),
});

const anchoredSpawn = (
  id: string,
  kind: "player" | "vehicle",
  laneId: string,
  distanceAlongM: number,
): MapSpawnPoint => ({
  id,
  kind,
  anchor: anchor(laneId, distanceAlongM),
});

const freeSpawn = (
  id: string,
  kind: "pedestrian" | "cyclist",
  x: number,
  z: number,
  headingDeg: number,
  laneId?: string,
): MapSpawnPoint => ({
  id,
  kind,
  pose: { position: point(x, z), headingDeg },
  ...(laneId ? { laneId } : {}),
});

const approach = (
  id: string,
  laneId: string,
  distanceAlongM: number,
  phaseGroup: string,
  conflictZoneIds?: readonly string[],
): TrafficControlApproach => ({
  id,
  laneIds: [laneId],
  stopLine: anchor(laneId, distanceAlongM),
  phaseGroup,
  ...(conflictZoneIds ? { conflictZoneIds } : {}),
});

const installation = (
  id: string,
  x: number,
  z: number,
  headingDeg: number,
  mounting: TrafficControlInstallation["mounting"],
  style: TrafficControlInstallation["style"],
  role: TrafficControlInstallation["role"],
  approachIds?: readonly string[],
  armHeadingDeg?: number,
): TrafficControlInstallation => ({
  id,
  position: point(x, z),
  headingDeg,
  mounting,
  style,
  role,
  ...(approachIds ? { approachIds } : {}),
  ...(armHeadingDeg === undefined ? {} : { armHeadingDeg }),
});

const control = (
  id: string,
  type: TrafficControl["type"],
  x: number,
  z: number,
  headingDeg: number,
  laneIds: readonly string[],
  conflictZoneIds?: readonly string[],
  approaches: readonly TrafficControlApproach[] = [],
  installations: readonly TrafficControlInstallation[] = [],
): TrafficControl => ({
  id,
  type,
  position: point(x, z),
  headingDeg,
  laneIds,
  ...(conflictZoneIds ? { conflictZoneIds } : {}),
  approaches,
  installations,
});

const graph = (
  nodes: readonly LaneNode[],
  lanes: readonly LaneSegment[],
  controls: LaneGraph["controls"],
  conflictZones: LaneGraph["conflictZones"],
  spawnPoints: LaneGraph["spawnPoints"],
  checkpoints: LaneGraph["checkpoints"],
): LaneGraph => ({
  nodes,
  lanes,
  controls,
  conflictZones,
  spawnPoints,
  checkpoints,
});

const osmSource = (
  boundingBox: FrozenMapSource["boundingBox"],
  sourceUrl: string,
  checksum: string,
  additionalBoundingBoxes?: readonly FrozenMapSource["boundingBox"][],
): FrozenMapSource => ({
  boundingBox,
  ...(additionalBoundingBoxes ? { additionalBoundingBoxes } : {}),
  capturedOn: CONTENT_REVIEWED_ON,
  sourceUrl,
  checksum,
  importerVersion: "sideswap-procedural-1.0.0",
  attribution: "© OpenStreetMap contributors",
  licenseName: "Open Data Commons Open Database License 1.0",
  licenseUrl: "https://www.openstreetmap.org/copyright",
});

const US_RULES: readonly OfficialRuleReference[] = [
  {
    id: "us-ny-dmv-passing",
    title: "New York State Driver's Manual — Passing",
    authority: "New York State Department of Motor Vehicles",
    jurisdiction: "New York, United States",
    url: "https://dmv.ny.gov/new-york-state-drivers-manual-and-practice-tests/chapter-6-passing",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "lane_misuse",
      "merge",
      "unsafe_gap",
      "following_distance",
      "observation",
    ],
  },
  {
    id: "us-nyc-traffic-rules",
    title: "Traffic Rules of the City of New York",
    authority: "New York City Department of Transportation",
    jurisdiction: "New York City, United States",
    url: "https://www.nyc.gov/html/dot/downloads/pdf/trafrule.pdf",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "one_way",
      "pedestrian_priority",
      "cyclist_clearance",
    ],
  },
];

const UK_RULES: readonly OfficialRuleReference[] = [
  {
    id: "uk-highway-code-road",
    title: "The Highway Code — Using the road",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "speeding",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "roundabout_yield",
      "merge",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
];

const FR_RULES: readonly OfficialRuleReference[] = [
  {
    id: "fr-eu-road-rules",
    title: "Road rules and safety — France",
    authority: "European Commission, Your Europe",
    jurisdiction: "France",
    url: "https://europa.eu/youreurope/citizens/travel/driving-abroad/road-rules-and-safety/france/index_en.htm",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "unsafe_gap",
      "lane_misuse",
      "roundabout_yield",
      "merge",
      "pedestrian_priority",
      "cyclist_clearance",
      "priority_to_right",
      "observation",
      "border_transition",
    ],
  },
];

const JP_RULES: readonly OfficialRuleReference[] = [
  {
    id: "jp-jaf-traffic-rules",
    title: "Traffic rules in Japan",
    authority: "Japan Automobile Federation",
    jurisdiction: "Japan",
    url: "https://english.jaf.or.jp/driving-in-japan/traffic-rules",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "speeding",
      "incomplete_stop",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "pedestrian_priority",
      "cyclist_clearance",
      "railway_crossing",
      "observation",
    ],
  },
];

export const COUNTRY_PROFILES: readonly CountryProfile[] = [
  {
    id: "us",
    countryCode: "US",
    countryName: "United States",
    flagEmoji: "🇺🇸",
    trafficSide: "right",
    defaultSteeringSide: "left",
    speedUnit: "mph",
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      slowLaneSide: "right",
      turnOnRed: "permitted_after_stop_unless_signed",
    },
    roundaboutPolicy: {
      circulation: "counterclockwise",
      yieldToTrafficFrom: "left",
      entrySide: "right",
    },
    priorityPolicy:
      "Obey signals and signs; yield to pedestrians and traffic already in a junction.",
    officialReferences: US_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "uk",
    countryCode: "GB",
    countryName: "United Kingdom",
    flagEmoji: "🇬🇧",
    trafficSide: "left",
    defaultSteeringSide: "right",
    speedUnit: "mph",
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      slowLaneSide: "left",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "clockwise",
      yieldToTrafficFrom: "right",
      entrySide: "left",
    },
    priorityPolicy:
      "Give way according to signs and markings; at roundabouts, give priority to traffic from the right unless directed otherwise.",
    officialReferences: [...UK_RULES, ...LONDON_RULE_REFERENCES],
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "fr",
    countryCode: "FR",
    countryName: "France",
    flagEmoji: "🇫🇷",
    trafficSide: "right",
    defaultSteeringSide: "left",
    speedUnit: "kmh",
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      slowLaneSide: "right",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "counterclockwise",
      yieldToTrafficFrom: "left",
      entrySide: "right",
    },
    priorityPolicy:
      "Priority to the right applies at unsigned junctions; signs and road markings can replace that default.",
    officialReferences: FR_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
  {
    id: "jp",
    countryCode: "JP",
    countryName: "Japan",
    flagEmoji: "🇯🇵",
    trafficSide: "left",
    defaultSteeringSide: "right",
    speedUnit: "kmh",
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      slowLaneSide: "left",
      turnOnRed: "prohibited",
    },
    roundaboutPolicy: {
      circulation: "clockwise",
      yieldToTrafficFrom: "right",
      entrySide: "left",
    },
    priorityPolicy:
      "Follow signals, stop markings and local priority signs; slow for narrow, shared neighbourhood streets.",
    officialReferences: JP_RULES,
    reviewedOn: CONTENT_REVIEWED_ON,
  },
];

export const DESTINATION_PROFILES: readonly DestinationProfile[] = [
  {
    id: "uk-london",
    countryId: "uk",
    destinationName: "London",
    destinationSubtitle: "South Kensington Museum Quarter",
    mapId: "london-south-kensington",
    lessonIds: [
      "uk-london-left-side-basics",
      "uk-london-museum-traffic",
      "uk-london-exhibition-road",
    ],
    freeDriveId: "free-uk-london",
    promotion: "featured",
    cityMark: "LDN",
    visualTheme: LONDON_THEME,
  },
  {
    id: "us-nyc",
    countryId: "us",
    destinationName: "New York City",
    destinationSubtitle: "Upper West Side · Broadway & West 72nd Street",
    mapId: "nyc-upper-west-side",
    lessonIds: ["us-one-way-grid", "us-signals-crosswalks", "us-lane-choice"],
    freeDriveId: "free-us",
    promotion: "standard",
    cityMark: "NYC",
    visualTheme: NYC_THEME,
  },
  {
    id: "uk-milton-keynes",
    countryId: "uk",
    destinationName: "Milton Keynes",
    destinationSubtitle: "Roundabout Academy · South Grafton & Oldbrook",
    mapId: "milton-keynes-oldbrook",
    lessonIds: ["uk-left-side-basics", "uk-roundabouts", "uk-dual-carriageway"],
    freeDriveId: "free-uk",
    promotion: "specialist",
    cityMark: "MK",
    visualTheme: MILTON_KEYNES_THEME,
  },
  {
    id: "fr-calais",
    countryId: "fr",
    destinationName: "Calais & Coquelles",
    destinationSubtitle: "Roundabouts, priority rules & terminal roads",
    mapId: "calais-coquelles",
    lessonIds: ["fr-right-side-basics", "fr-priority-roundabouts", "fr-speed-merging"],
    freeDriveId: "free-fr",
    promotion: "standard",
    cityMark: "CAL",
    visualTheme: CALAIS_THEME,
  },
  {
    id: "jp-tokyo",
    countryId: "jp",
    destinationName: "Tokyo — Setagaya",
    destinationSubtitle: "Gotokuji, Miyanosaka & narrow neighbourhood streets",
    mapId: "tokyo-setagaya",
    lessonIds: ["jp-left-side-basics", "jp-vulnerable-road-users", "jp-railway-crossings"],
    freeDriveId: "free-jp",
    promotion: "standard",
    cityMark: "TYO",
    visualTheme: TOKYO_THEME,
  },
];

const orientationNodes = {
  r0: node("yard-r0", -44, 32),
  r1: node("yard-r1", 44, 32),
  r2: node("yard-r2", 44, -32),
  r3: node("yard-r3", -44, -32),
  l0: node("yard-l0", -34, 22),
  l1: node("yard-l1", -34, -22),
  l2: node("yard-l2", 34, -22),
  l3: node("yard-l3", 34, 22),
};

const orientationLanes: readonly LaneSegment[] = [
  lane("yard-r-north", orientationNodes.r0, orientationNodes.r1, "right", 20, ["yard-r-east"]),
  lane("yard-r-east", orientationNodes.r1, orientationNodes.r2, "right", 20, ["yard-r-south"]),
  lane("yard-r-south", orientationNodes.r2, orientationNodes.r3, "right", 20, ["yard-r-west"]),
  lane("yard-r-west", orientationNodes.r3, orientationNodes.r0, "right", 20, ["yard-r-north"]),
  lane("yard-l-west", orientationNodes.l0, orientationNodes.l1, "left", 20, ["yard-l-south"]),
  lane("yard-l-south", orientationNodes.l1, orientationNodes.l2, "left", 20, ["yard-l-east"]),
  lane("yard-l-east", orientationNodes.l2, orientationNodes.l3, "left", 20, ["yard-l-north"]),
  lane("yard-l-north", orientationNodes.l3, orientationNodes.l0, "left", 20, ["yard-l-west"]),
];

const nycNodes = {
  a: node("nyc-a", -105, -72),
  b: node("nyc-b", 0, -72),
  c: node("nyc-c", 105, -72),
  d: node("nyc-d", 105, 0),
  e: node("nyc-e", 0, 0),
  f: node("nyc-f", -105, 0),
  g: node("nyc-g", -105, 72),
  h: node("nyc-h", 0, 72),
  i: node("nyc-i", 105, 72),
};

const nycLanes: readonly LaneSegment[] = [
  lane("nyc-72-east-1", nycNodes.a, nycNodes.b, "right", 25, ["nyc-72-east-2", "nyc-bway-n-1"], "one_way"),
  lane("nyc-72-east-2", nycNodes.b, nycNodes.c, "right", 25, ["nyc-columbus-n-1"], "one_way"),
  lane("nyc-bway-n-1", nycNodes.b, nycNodes.e, "right", 25, ["nyc-bway-n-2"], "travel", [point(3.4, -36)], ["nyc-bway-s-2"]),
  lane("nyc-bway-n-2", nycNodes.e, nycNodes.h, "right", 25, ["nyc-79-west-2", "nyc-bway-s-1"], "travel", [point(3.4, 36)], ["nyc-bway-s-1"]),
  lane("nyc-columbus-n-1", nycNodes.c, nycNodes.d, "right", 25, ["nyc-columbus-n-2"]),
  lane("nyc-columbus-n-2", nycNodes.d, nycNodes.i, "right", 25, ["nyc-79-west-1"]),
  lane("nyc-79-west-1", nycNodes.i, nycNodes.h, "right", 25, ["nyc-79-west-2", "nyc-bway-s-1"], "one_way"),
  lane("nyc-79-west-2", nycNodes.h, nycNodes.g, "right", 25, ["nyc-west-end-s-1"], "one_way"),
  lane("nyc-west-end-s-1", nycNodes.g, nycNodes.f, "right", 25, ["nyc-west-end-s-2"]),
  lane("nyc-west-end-s-2", nycNodes.f, nycNodes.a, "right", 25, ["nyc-72-east-1"]),
  lane("nyc-bway-s-1", nycNodes.h, nycNodes.e, "right", 25, ["nyc-bway-s-2"], "travel", [point(-3.4, 36)], ["nyc-bway-n-2"]),
  lane("nyc-bway-s-2", nycNodes.e, nycNodes.b, "right", 25, ["nyc-72-east-2"], "travel", [point(-3.4, -36)], ["nyc-bway-n-1"]),
];

const ukNodes = {
  n: node("uk-n", 0, 34),
  e: node("uk-e", 34, 0),
  s: node("uk-s", 0, -34),
  w: node("uk-w", -34, 0),
  no: node("uk-no", 0, 118),
  eo: node("uk-eo", 130, 0),
  so: node("uk-so", 0, -118),
  wo: node("uk-wo", -130, 0),
  ne: node("uk-ne", 90, 78),
};

const ukLanes: readonly LaneSegment[] = [
  lane("uk-rb-n-e", ukNodes.n, ukNodes.e, "left", 30, ["uk-rb-e-s", "uk-exit-east"], "roundabout", [point(25, 25)]),
  lane("uk-rb-e-s", ukNodes.e, ukNodes.s, "left", 30, ["uk-rb-s-w", "uk-exit-south"], "roundabout", [point(25, -25)]),
  lane("uk-rb-s-w", ukNodes.s, ukNodes.w, "left", 30, ["uk-rb-w-n", "uk-exit-west"], "roundabout", [point(-25, -25)]),
  lane("uk-rb-w-n", ukNodes.w, ukNodes.n, "left", 30, ["uk-rb-n-e", "uk-exit-north"], "roundabout", [point(-25, 25)]),
  lane("uk-entry-north", ukNodes.no, ukNodes.n, "left", 40, ["uk-rb-n-e"], "entry", [point(1.7, 76)], ["uk-exit-north"]),
  lane("uk-exit-north", ukNodes.n, ukNodes.no, "left", 40, ["uk-dual-n-east"], "exit", [point(-1.7, 76)], ["uk-entry-north"]),
  lane("uk-entry-east", ukNodes.eo, ukNodes.e, "left", 40, ["uk-rb-e-s"], "entry", [point(82, -1.7)], ["uk-exit-east"]),
  lane("uk-exit-east", ukNodes.e, ukNodes.eo, "left", 40, ["uk-entry-east"], "exit", [point(82, 1.7)], ["uk-entry-east"]),
  lane("uk-entry-south", ukNodes.so, ukNodes.s, "left", 40, ["uk-rb-s-w"], "entry", [point(-1.7, -76)], ["uk-exit-south"]),
  lane("uk-exit-south", ukNodes.s, ukNodes.so, "left", 40, ["uk-south-west"], "exit", [point(1.7, -76)], ["uk-entry-south"]),
  lane("uk-entry-west", ukNodes.wo, ukNodes.w, "left", 40, ["uk-rb-w-n"], "entry", [point(-82, 1.7)], ["uk-exit-west"]),
  lane("uk-exit-west", ukNodes.w, ukNodes.wo, "left", 40, ["uk-west-south"], "exit", [point(-82, -1.7)], ["uk-entry-west"]),
  lane("uk-dual-n-east", ukNodes.no, ukNodes.ne, "left", 60, ["uk-east-north"], "travel", [point(48, 98.25)], ["uk-dual-n-east-pass"]),
  lane("uk-dual-n-east-pass", ukNodes.no, ukNodes.ne, "left", 60, ["uk-east-north"], "passing", [point(48, 101.75)], ["uk-dual-n-east"]),
  lane("uk-east-north", ukNodes.ne, ukNodes.eo, "left", 40, ["uk-entry-east"]),
  lane("uk-south-west", ukNodes.so, ukNodes.wo, "left", 40, ["uk-entry-west"], "travel", [point(-65, -104)]),
  lane("uk-west-south", ukNodes.wo, ukNodes.so, "left", 40, ["uk-entry-south"], "travel", [point(-65, -40)]),
];

const frNodes = {
  n: node("fr-n", 0, 34),
  e: node("fr-e", 34, 0),
  s: node("fr-s", 0, -34),
  w: node("fr-w", -34, 0),
  no: node("fr-no", 0, 118),
  eo: node("fr-eo", 138, 0),
  so: node("fr-so", 0, -118),
  wo: node("fr-wo", -138, 0),
  se: node("fr-se", 92, -82),
};

const frLanes: readonly LaneSegment[] = [
  lane("fr-rb-n-w", frNodes.n, frNodes.w, "right", 30, ["fr-rb-w-s", "fr-exit-west"], "roundabout", [point(-25, 25)]),
  lane("fr-rb-w-s", frNodes.w, frNodes.s, "right", 30, ["fr-rb-s-e", "fr-exit-south"], "roundabout", [point(-25, -25)]),
  lane("fr-rb-s-e", frNodes.s, frNodes.e, "right", 30, ["fr-rb-e-n", "fr-exit-east"], "roundabout", [point(25, -25)]),
  lane("fr-rb-e-n", frNodes.e, frNodes.n, "right", 30, ["fr-rb-n-w", "fr-exit-north"], "roundabout", [point(25, 25)]),
  lane("fr-entry-north", frNodes.no, frNodes.n, "right", 50, ["fr-rb-n-w"], "entry", [point(-1.7, 76)], ["fr-exit-north"]),
  lane("fr-exit-north", frNodes.n, frNodes.no, "right", 50, ["fr-north-west"], "exit", [point(1.7, 76)], ["fr-entry-north"]),
  lane("fr-entry-east", frNodes.eo, frNodes.e, "right", 50, ["fr-rb-e-n"], "entry", [point(86, 1.7)], ["fr-exit-east"]),
  lane("fr-exit-east", frNodes.e, frNodes.eo, "right", 50, ["fr-east-south"], "exit", [point(86, -1.7)], ["fr-entry-east"]),
  lane("fr-entry-south", frNodes.so, frNodes.s, "right", 50, ["fr-rb-s-e"], "entry", [point(1.7, -76)], ["fr-exit-south"]),
  lane("fr-exit-south", frNodes.s, frNodes.so, "right", 50, ["fr-south-east"], "exit", [point(-1.7, -76)], ["fr-entry-south"]),
  lane("fr-entry-west", frNodes.wo, frNodes.w, "right", 50, ["fr-rb-w-s"], "entry", [point(-86, -1.7)], ["fr-exit-west"]),
  lane("fr-exit-west", frNodes.w, frNodes.wo, "right", 50, ["fr-entry-west"], "exit", [point(-86, 1.7)], ["fr-entry-west"]),
  lane("fr-south-east", frNodes.so, frNodes.eo, "right", 70, ["fr-entry-east"], "travel", [point(53, -100.7), point(94, -80.7)], ["fr-south-east-pass"]),
  lane("fr-south-east-pass", frNodes.so, frNodes.eo, "right", 70, ["fr-entry-east"], "passing", [point(53, -97.3), point(94, -77.3)], ["fr-south-east"]),
  lane("fr-east-south", frNodes.eo, frNodes.so, "right", 50, ["fr-entry-south"], "travel", [point(92, -82)]),
  lane("fr-north-west", frNodes.no, frNodes.wo, "right", 50, ["fr-entry-west"], "travel", [point(-80, 76)]),
];

const jpNodes = {
  a: node("jp-a", -112, -72),
  b: node("jp-b", -30, -72),
  c: node("jp-c", 72, -72),
  d: node("jp-d", 112, -18),
  e: node("jp-e", 54, 18),
  f: node("jp-f", -30, 18),
  g: node("jp-g", -112, 18),
  h: node("jp-h", -112, 76),
  i: node("jp-i", -30, 76),
  j: node("jp-j", 82, 76),
};

const jpLanes: readonly LaneSegment[] = [
  lane("jp-south-east-1", jpNodes.a, jpNodes.b, "left", 30, ["jp-south-east-2", "jp-narrow-north-1"], "travel", [point(-71, -70.5)], ["jp-south-west-1"]),
  lane("jp-south-east-2", jpNodes.b, jpNodes.c, "left", 30, ["jp-curve-north"], "rail_crossing", [point(21, -70.5)], ["jp-south-west-2"]),
  lane("jp-south-west-1", jpNodes.b, jpNodes.a, "left", 30, [], "travel", [point(-71, -73.5)], ["jp-south-east-1"], "jp-south-road", 3),
  lane("jp-south-west-2", jpNodes.c, jpNodes.b, "left", 30, ["jp-south-west-1"], "rail_crossing", [point(21, -73.5)], ["jp-south-east-2"], "jp-south-road", 3),
  lane("jp-curve-north", jpNodes.c, jpNodes.d, "left", 30, ["jp-center-west-1"], "travel", [point(100.5, -56), point(106.5, -35)], ["jp-curve-south"]),
  lane("jp-curve-south", jpNodes.d, jpNodes.c, "left", 30, ["jp-south-west-2"], "travel", [point(109.5, -35), point(103.5, -56)], ["jp-curve-north"], "jp-east-curve", 3),
  lane("jp-center-west-1", jpNodes.d, jpNodes.e, "left", 30, ["jp-center-west-2"], "travel", [point(82, 16.5)], ["jp-center-east-3"]),
  lane("jp-center-west-2", jpNodes.e, jpNodes.f, "left", 30, ["jp-center-west-3", "jp-narrow-north-2"], "travel", [point(12, 16.5)], ["jp-center-east-2"]),
  lane("jp-center-west-3", jpNodes.f, jpNodes.g, "left", 30, ["jp-west-north"], "travel", [point(-71, 16.5)], ["jp-center-east-1"]),
  lane("jp-center-east-1", jpNodes.g, jpNodes.f, "left", 30, ["jp-center-east-2", "jp-narrow-south-1"], "travel", [point(-71, 19.5)], ["jp-center-west-3"], "jp-center-road", 3),
  lane("jp-center-east-2", jpNodes.f, jpNodes.e, "left", 30, ["jp-center-east-3"], "travel", [point(12, 19.5)], ["jp-center-west-2"], "jp-center-road", 3),
  lane("jp-center-east-3", jpNodes.e, jpNodes.d, "left", 30, ["jp-curve-south"], "travel", [point(82, 19.5)], ["jp-center-west-1"], "jp-center-road", 3),
  lane("jp-west-north", jpNodes.g, jpNodes.h, "left", 30, ["jp-north-east-1"], "travel", [point(-113.5, 47)], ["jp-west-south"]),
  lane("jp-west-south", jpNodes.h, jpNodes.g, "left", 30, ["jp-center-east-1"], "travel", [point(-110.5, 47)], ["jp-west-north"], "jp-west-road", 3),
  lane("jp-north-east-1", jpNodes.h, jpNodes.i, "left", 30, ["jp-north-east-2"], "travel", [point(-71, 77.5)], ["jp-north-west-2"]),
  lane("jp-north-east-2", jpNodes.i, jpNodes.j, "left", 30, ["jp-junction-south"], "travel", [point(26, 77.5)], ["jp-north-west-1"]),
  lane("jp-north-west-1", jpNodes.j, jpNodes.i, "left", 30, ["jp-north-west-2", "jp-narrow-south-2"], "travel", [point(26, 74.5)], ["jp-north-east-2"], "jp-north-road", 3),
  lane("jp-north-west-2", jpNodes.i, jpNodes.h, "left", 30, ["jp-west-south"], "travel", [point(-71, 74.5)], ["jp-north-east-1"], "jp-north-road", 3),
  lane("jp-junction-south", jpNodes.j, jpNodes.e, "left", 30, ["jp-center-west-2"], "travel", [point(83.5, 47)], ["jp-junction-north"]),
  lane("jp-junction-north", jpNodes.e, jpNodes.j, "left", 30, ["jp-north-west-1"], "travel", [point(80.5, 47)], ["jp-junction-south"], "jp-junction-road", 3),
  lane("jp-narrow-north-1", jpNodes.b, jpNodes.f, "left", 20, ["jp-narrow-north-2"], "travel", [point(-31.35, -27)], ["jp-narrow-south-1"]),
  lane("jp-narrow-north-2", jpNodes.f, jpNodes.i, "left", 20, ["jp-north-east-2"], "travel", [point(-31.35, 47)], ["jp-narrow-south-2"]),
  lane("jp-narrow-south-1", jpNodes.f, jpNodes.b, "left", 20, ["jp-south-west-1"], "travel", [point(-28.65, -27)], ["jp-narrow-north-1"], "jp-narrow-road", 2.7),
  lane("jp-narrow-south-2", jpNodes.i, jpNodes.f, "left", 20, ["jp-narrow-south-1"], "travel", [point(-28.65, 47)], ["jp-narrow-north-2"], "jp-narrow-road", 2.7),
];

const transitionNodes = {
  uk0: node("xf-uk0", -144, -34),
  uk1: node("xf-uk1", -76, -34),
  uk2: node("xf-uk2", -24, 0),
  gate: node("xf-gate", 0, 0),
  fr0: node("xf-fr0", 24, 0),
  fr1: node("xf-fr1", 76, 34),
  fr2: node("xf-fr2", 144, 34),
};

const transitionLanes: readonly LaneSegment[] = [
  lane("xf-uk-approach", transitionNodes.uk0, transitionNodes.uk1, "left", 30, ["xf-uk-terminal"], "terminal", [point(-110, -32.25)], ["xf-uk-approach-opposite"]),
  lane("xf-uk-approach-opposite", transitionNodes.uk1, transitionNodes.uk0, "left", 30, [], "terminal", [point(-110, -35.75)], ["xf-uk-approach"], "xf-uk-road", 3.5),
  lane("xf-uk-terminal", transitionNodes.uk1, transitionNodes.uk2, "left", 15, ["xf-shuttle"], "terminal", [point(-48, -20)]),
  lane("xf-shuttle", transitionNodes.uk2, transitionNodes.gate, "left", 10, ["xf-fr-terminal"], "terminal"),
  lane("xf-fr-terminal", transitionNodes.gate, transitionNodes.fr0, "right", 10, ["xf-fr-exit"], "terminal", [], undefined, undefined, undefined, "kmh"),
  lane("xf-fr-exit", transitionNodes.fr0, transitionNodes.fr1, "right", 30, ["xf-fr-road"], "terminal", [point(48, 18)], undefined, undefined, undefined, "kmh"),
  lane("xf-fr-road", transitionNodes.fr1, transitionNodes.fr2, "right", 50, [], "travel", [point(110, 32.25)], ["xf-fr-road-opposite"], undefined, undefined, "kmh"),
  lane("xf-fr-road-opposite", transitionNodes.fr2, transitionNodes.fr1, "right", 50, [], "travel", [point(110, 35.75)], ["xf-fr-road"], "xf-fr-road-surface", 3.5, "kmh"),
];

export const MAP_PACKS: readonly MapPack[] = [
  {
    id: "orientation-yard",
    name: "SideSwap Orientation Yard",
    areaLabel: "Purpose-built training ground",
    countryIds: ["us", "uk", "fr", "jp"],
    source: osmSource(
      { south: 0, west: 0, north: 0, east: 0 },
      "https://www.openstreetmap.org/copyright",
      "manifest-v1:orientation-yard",
    ),
    geometry: {
      worldSize: point(140, 110),
      roadWidth: 8,
      shoulderWidth: 1.5,
      roadSurfaces: [
        roadSurface("yard-right-loop", [orientationNodes.r0.position, orientationNodes.r1.position, orientationNodes.r2.position, orientationNodes.r3.position, orientationNodes.r0.position], 8, ["yard-r-north", "yard-r-east", "yard-r-south", "yard-r-west"]),
        roadSurface("yard-left-loop", [orientationNodes.l0.position, orientationNodes.l1.position, orientationNodes.l2.position, orientationNodes.l3.position, orientationNodes.l0.position], 8, ["yard-l-west", "yard-l-south", "yard-l-east", "yard-l-north"]),
      ],
      blocks: [],
      landmarks: [
        { id: "yard-cones", kind: "station", center: point(0, 0), size: point(18, 12), color: "#f27a32" },
      ],
    },
    laneGraph: graph(
      Object.values(orientationNodes),
      orientationLanes,
      [
        control("yard-r-stop", "stop", 44, -32, 180, ["yard-r-east"], undefined,
          [approach("yard-r-stop-approach", "yard-r-east", 56, "yard-r")],
          [installation("yard-r-stop-sign", 50, -24, 180, "roadside_pole", "stop_sign", "primary")]),
        control("yard-l-stop", "stop", -34, -22, 90, ["yard-l-west"], undefined,
          [approach("yard-l-stop-approach", "yard-l-west", 36, "yard-l")],
          [installation("yard-l-stop-sign", -28, -14, 180, "roadside_pole", "stop_sign", "primary")]),
      ],
      [],
      [
        anchoredSpawn("yard-r-player", "player", "yard-r-north", 10),
        anchoredSpawn("yard-l-player", "player", "yard-l-west", 10),
      ],
      [
        checkpoint("yard-r-start", "Right-side start", "yard-r-north", 10),
        checkpoint("yard-r-turn", "Right-side turn", "yard-r-east", 12),
        checkpoint("yard-l-start", "Left-side start", "yard-l-west", 10),
        checkpoint("yard-l-turn", "Left-side turn", "yard-l-south", 14),
      ],
    ),
  },
  LONDON_MAP_PACK,
  {
    id: "nyc-upper-west-side",
    name: "NYC Upper West Side",
    areaLabel: "Broadway, West 72nd Street & nearby avenues",
    countryIds: ["us"],
    source: osmSource(
      { south: 40.7738, west: -73.9919, north: 40.7836, east: -73.9738 },
      "https://www.openstreetmap.org/export#map=16/40.7787/-73.9829",
      "manifest-v1:nyc-uws-2026-07-10",
    ),
    geometry: {
      worldSize: point(250, 190),
      roadWidth: 11,
      shoulderWidth: 1.5,
      roadSurfaces: [
        roadSurface("nyc-west-72", [nycNodes.a.position, nycNodes.b.position, nycNodes.c.position], 10.2, ["nyc-72-east-1", "nyc-72-east-2"]),
        roadSurface("nyc-west-79", [nycNodes.g.position, nycNodes.h.position, nycNodes.i.position], 10.2, ["nyc-79-west-1", "nyc-79-west-2"]),
        roadSurface("nyc-broadway", [nycNodes.b.position, nycNodes.e.position, nycNodes.h.position], 10.8, ["nyc-bway-n-1", "nyc-bway-n-2", "nyc-bway-s-1", "nyc-bway-s-2"]),
        roadSurface("nyc-columbus", [nycNodes.c.position, nycNodes.d.position, nycNodes.i.position], 7.4, ["nyc-columbus-n-1", "nyc-columbus-n-2"], "lane_divider"),
        roadSurface("nyc-west-end", [nycNodes.a.position, nycNodes.f.position, nycNodes.g.position], 7.4, ["nyc-west-end-s-1", "nyc-west-end-s-2"], "lane_divider"),
      ],
      blocks: [
        { id: "nyc-block-nw", center: point(-52, 36), size: point(82, 48), heightRange: [18, 42], density: 0.8, material: "brick" },
        { id: "nyc-block-ne", center: point(52, 36), size: point(82, 48), heightRange: [22, 48], density: 0.85, material: "sandstone" },
        { id: "nyc-block-sw", center: point(-52, -36), size: point(82, 48), heightRange: [16, 38], density: 0.78, material: "brick" },
        { id: "nyc-block-se", center: point(52, -36), size: point(82, 48), heightRange: [20, 44], density: 0.82, material: "stone" },
      ],
      landmarks: [
        { id: "nyc-verdi-green", kind: "park", center: point(14, 18), size: point(18, 42), color: "#5c8c4b" },
        { id: "nyc-subway", kind: "station", center: point(-8, -6), size: point(8, 5), color: "#2d2f33" },
      ],
    },
    laneGraph: graph(
      Object.values(nycNodes),
      nycLanes,
      [
        control("nyc-signal-72-bway", "signal", 0, -72, 90, ["nyc-72-east-1", "nyc-bway-n-1"], ["nyc-conflict-72-bway"],
          [
            approach("nyc-72-east-approach", "nyc-72-east-1", 97, "nyc-72-east", ["nyc-conflict-72-bway"]),
            approach("nyc-bway-north-approach", "nyc-bway-n-1", 8, "nyc-bway-north", ["nyc-conflict-72-bway"]),
          ],
          [
            installation("nyc-72-bway-mast", 8.5, -80.5, 90, "mast_arm", "nyc_signal", "primary", ["nyc-72-east-approach"], 270),
            installation("nyc-72-bway-companion", -8.5, -63.5, 0, "secondary_pole", "nyc_signal", "companion", ["nyc-bway-north-approach"]),
          ]),
        control("nyc-crosswalk-79", "crosswalk", 0, 72, 270, ["nyc-79-west-1", "nyc-bway-n-2"], ["nyc-conflict-79-bway"],
          [
            approach("nyc-79-west-crosswalk", "nyc-79-west-1", 97, "crosswalk", ["nyc-conflict-79-bway"]),
            approach("nyc-bway-north-crosswalk", "nyc-bway-n-2", 64, "crosswalk", ["nyc-conflict-79-bway"]),
          ],
          [installation("nyc-79-crosswalk-marking", 0, 72, 270, "road_marking", "crosswalk", "marking")]),
        control("nyc-signal-columbus", "signal", 105, 0, 0, ["nyc-columbus-n-1"], ["nyc-conflict-columbus"],
          [approach("nyc-columbus-north-approach", "nyc-columbus-n-1", 64, "nyc-columbus-north", ["nyc-conflict-columbus"])],
          [
            installation("nyc-columbus-mast", 113.5, -8.5, 0, "mast_arm", "nyc_signal", "primary", ["nyc-columbus-north-approach"], 180),
            installation("nyc-columbus-companion", 96.5, 8.5, 0, "secondary_pole", "nyc_signal", "companion", ["nyc-columbus-north-approach"]),
          ]),
      ],
      [
        { id: "nyc-conflict-72-bway", laneIds: ["nyc-72-east-1", "nyc-bway-n-1"], polygon: [point(-8, -80), point(8, -80), point(8, -64), point(-8, -64)] },
        { id: "nyc-conflict-79-bway", laneIds: ["nyc-79-west-1", "nyc-bway-n-2"], polygon: [point(-8, 64), point(8, 64), point(8, 80), point(-8, 80)] },
        { id: "nyc-conflict-columbus", laneIds: ["nyc-columbus-n-1"], polygon: [point(97, -8), point(113, -8), point(113, 8), point(97, 8)] },
      ],
      [
        anchoredSpawn("nyc-player", "player", "nyc-72-east-1", 17),
        anchoredSpawn("nyc-car-1", "vehicle", "nyc-72-east-2", 24),
        anchoredSpawn("nyc-car-2", "vehicle", "nyc-columbus-n-2", 34),
        freeSpawn("nyc-ped-1", "pedestrian", -6, 64, 0),
        freeSpawn("nyc-cyclist-1", "cyclist", -62, 0, 90, "nyc-west-end-s-1"),
      ],
      [
        checkpoint("nyc-start", "West 72nd start", "nyc-72-east-1", 17),
        checkpoint("nyc-broadway", "Broadway signal", "nyc-bway-n-1", 24),
        checkpoint("nyc-79", "West 79th crosswalk", "nyc-79-west-1", 33),
        checkpoint("nyc-finish", "West End finish", "nyc-west-end-s-2", 42),
      ],
    ),
  },
  {
    id: "milton-keynes-oldbrook",
    name: "Milton Keynes — Oldbrook",
    areaLabel: "South Grafton Roundabout and neighbouring grid roads",
    countryIds: ["uk"],
    source: osmSource(
      { south: 52.0254, west: -0.7792, north: 52.0352, east: -0.7595 },
      "https://www.openstreetmap.org/export#map=16/52.0303/-0.7694",
      "manifest-v1:milton-keynes-oldbrook-2026-07-10",
    ),
    geometry: {
      worldSize: point(300, 270),
      roadWidth: 9,
      shoulderWidth: 2,
      roadSurfaces: [
        roadSurface("uk-roundabout", [ukNodes.n.position, point(25, 25), ukNodes.e.position, point(25, -25), ukNodes.s.position, point(-25, -25), ukNodes.w.position, point(-25, 25), ukNodes.n.position], 7.2, ["uk-rb-n-e", "uk-rb-e-s", "uk-rb-s-w", "uk-rb-w-n"], "roundabout"),
        roadSurface("uk-north-approach", [ukNodes.n.position, ukNodes.no.position], 7.2, ["uk-entry-north", "uk-exit-north"]),
        roadSurface("uk-east-approach", [ukNodes.e.position, ukNodes.eo.position], 7.2, ["uk-entry-east", "uk-exit-east"]),
        roadSurface("uk-south-approach", [ukNodes.s.position, ukNodes.so.position], 7.2, ["uk-entry-south", "uk-exit-south"]),
        roadSurface("uk-west-approach", [ukNodes.w.position, ukNodes.wo.position], 7.2, ["uk-entry-west", "uk-exit-west"]),
        roadSurface("uk-dual-carriageway", [ukNodes.no.position, point(48, 100), ukNodes.ne.position], 7.4, ["uk-dual-n-east", "uk-dual-n-east-pass"], "lane_divider"),
        roadSurface("uk-east-link", [ukNodes.ne.position, ukNodes.eo.position], 7.2, ["uk-east-north"]),
        roadSurface("uk-oldbrook-loop", [ukNodes.so.position, point(-65, -104), ukNodes.wo.position, point(-65, -40), ukNodes.so.position], 7.2, ["uk-south-west", "uk-west-south"]),
      ],
      blocks: [
        { id: "uk-oldbrook", center: point(-78, 72), size: point(90, 72), heightRange: [5, 12], density: 0.55, material: "brick" },
        { id: "uk-retail", center: point(84, -72), size: point(96, 70), heightRange: [6, 14], density: 0.4, material: "concrete" },
      ],
      landmarks: [
        { id: "uk-roundabout-green", kind: "park", center: point(0, 0), size: point(50, 50), color: "#608b4e" },
        { id: "uk-station-sign", kind: "station", center: point(82, 82), size: point(15, 8), color: "#d64045" },
      ],
    },
    laneGraph: graph(
      Object.values(ukNodes),
      ukLanes,
      [
        control("uk-yield-south", "yield", 0, -42, 0, ["uk-entry-south"], ["uk-roundabout-conflict"],
          [approach("uk-yield-south-approach", "uk-entry-south", 74, "yield", ["uk-roundabout-conflict"])],
          [installation("uk-yield-south-sign", -7.5, -47, 0, "roadside_pole", "yield_sign", "primary")]),
        control("uk-yield-north", "yield", 0, 42, 180, ["uk-entry-north"], ["uk-roundabout-conflict"],
          [approach("uk-yield-north-approach", "uk-entry-north", 74, "yield", ["uk-roundabout-conflict"])],
          [installation("uk-yield-north-sign", 7.5, 47, 180, "roadside_pole", "yield_sign", "primary")]),
        control("uk-crosswalk-oldbrook", "crosswalk", -102, -102, 45, ["uk-west-south"], undefined,
          [approach("uk-oldbrook-crosswalk-approach", "uk-west-south", 150, "crosswalk")],
          [installation("uk-oldbrook-crosswalk-marking", -102, -102, 45, "road_marking", "crosswalk", "marking")]),
      ],
      [
        { id: "uk-roundabout-conflict", laneIds: ["uk-rb-n-e", "uk-rb-e-s", "uk-rb-s-w", "uk-rb-w-n"], polygon: [point(-40, -40), point(40, -40), point(40, 40), point(-40, 40)] },
      ],
      [
        anchoredSpawn("uk-player", "player", "uk-entry-south", 22),
        anchoredSpawn("uk-car-1", "vehicle", "uk-rb-w-n", 27),
        anchoredSpawn("uk-car-2", "vehicle", "uk-dual-n-east", 50),
        freeSpawn("uk-ped-1", "pedestrian", -104, -92, 0),
      ],
      [
        checkpoint("uk-start", "Oldbrook approach", "uk-entry-south", 22),
        checkpoint("uk-roundabout", "South Grafton Roundabout", "uk-rb-s-w", 13),
        checkpoint("uk-dual", "Dual carriageway", "uk-dual-n-east", 48),
        checkpoint("uk-finish", "Oldbrook return", "uk-west-south", 48),
      ],
    ),
  },
  {
    id: "calais-coquelles",
    name: "Calais & Coquelles",
    areaLabel: "Coastal roads, terminal approaches and roundabouts",
    countryIds: ["fr"],
    source: osmSource(
      { south: 50.9302, west: 1.7765, north: 50.9402, east: 1.7988 },
      "https://www.openstreetmap.org/export#map=16/50.9352/1.7877",
      "manifest-v1:calais-coquelles-2026-07-10",
    ),
    geometry: {
      worldSize: point(310, 270),
      roadWidth: 9,
      shoulderWidth: 2,
      roadSurfaces: [
        roadSurface("fr-roundabout", [frNodes.n.position, point(-25, 25), frNodes.w.position, point(-25, -25), frNodes.s.position, point(25, -25), frNodes.e.position, point(25, 25), frNodes.n.position], 7.2, ["fr-rb-n-w", "fr-rb-w-s", "fr-rb-s-e", "fr-rb-e-n"], "roundabout"),
        roadSurface("fr-north-approach", [frNodes.n.position, frNodes.no.position], 7.2, ["fr-entry-north", "fr-exit-north"]),
        roadSurface("fr-east-approach", [frNodes.e.position, frNodes.eo.position], 7.2, ["fr-entry-east", "fr-exit-east"]),
        roadSurface("fr-south-approach", [frNodes.s.position, frNodes.so.position], 7.2, ["fr-entry-south", "fr-exit-south"]),
        roadSurface("fr-west-approach", [frNodes.w.position, frNodes.wo.position], 7.2, ["fr-entry-west", "fr-exit-west"]),
        roadSurface("fr-south-east-road", [frNodes.so.position, point(53, -99), point(94, -79), frNodes.eo.position], 7.4, ["fr-south-east", "fr-south-east-pass"], "lane_divider"),
        roadSurface("fr-east-south-road", [frNodes.eo.position, point(92, -82), frNodes.so.position], 7.2, ["fr-east-south"]),
        roadSurface("fr-north-west-road", [frNodes.no.position, point(-80, 76), frNodes.wo.position], 7.2, ["fr-north-west"]),
      ],
      blocks: [
        { id: "fr-coquelles", center: point(-82, 70), size: point(100, 72), heightRange: [5, 13], density: 0.45, material: "stucco" },
        { id: "fr-commercial", center: point(88, -70), size: point(104, 76), heightRange: [7, 16], density: 0.38, material: "pale-concrete" },
      ],
      landmarks: [
        { id: "fr-terminal", kind: "terminal", center: point(-96, -82), size: point(54, 32), color: "#28569a" },
        { id: "fr-roundabout-green", kind: "park", center: point(0, 0), size: point(48, 48), color: "#6d914f" },
      ],
    },
    laneGraph: graph(
      Object.values(frNodes),
      frLanes,
      [
        control("fr-yield-south", "yield", 0, -42, 0, ["fr-entry-south"], ["fr-roundabout-conflict"],
          [approach("fr-yield-south-approach", "fr-entry-south", 74, "yield", ["fr-roundabout-conflict"])],
          [installation("fr-yield-south-sign", 8, -48, 0, "roadside_pole", "yield_sign", "primary")]),
        control("fr-yield-east", "yield", 42, 0, 270, ["fr-entry-east"], ["fr-roundabout-conflict"],
          [approach("fr-yield-east-approach", "fr-entry-east", 94, "yield", ["fr-roundabout-conflict"])],
          [installation("fr-yield-east-sign", 48, 8, 270, "roadside_pole", "yield_sign", "primary")]),
        control("fr-priority-right", "yield", -74, 72, 225, ["fr-north-west"], undefined,
          [approach("fr-priority-right-approach", "fr-north-west", 82, "priority")],
          [installation("fr-priority-right-sign", -70, 65, 225, "roadside_pole", "yield_sign", "warning")]),
      ],
      [
        { id: "fr-roundabout-conflict", laneIds: ["fr-rb-n-w", "fr-rb-w-s", "fr-rb-s-e", "fr-rb-e-n"], polygon: [point(-40, -40), point(40, -40), point(40, 40), point(-40, 40)] },
      ],
      [
        anchoredSpawn("fr-player", "player", "fr-entry-south", 22),
        anchoredSpawn("fr-car-1", "vehicle", "fr-rb-s-e", 28),
        anchoredSpawn("fr-car-2", "vehicle", "fr-south-east", 59),
        freeSpawn("fr-cyclist-1", "cyclist", -74, 80, 225, "fr-north-west"),
      ],
      [
        checkpoint("fr-start", "Coquelles start", "fr-entry-south", 22),
        checkpoint("fr-roundabout", "Roundabout entry", "fr-rb-s-e", 13),
        checkpoint("fr-priority", "Priority-to-right junction", "fr-north-west", 82),
        checkpoint("fr-finish", "Terminal road finish", "fr-south-east", 70),
      ],
    ),
  },
  {
    id: "tokyo-setagaya",
    name: "Tokyo — Setagaya",
    areaLabel: "Yamashita, Miyanosaka and Gotokuji",
    countryIds: ["jp"],
    source: osmSource(
      { south: 35.6476, west: 139.6345, north: 35.6568, east: 139.6539 },
      "https://www.openstreetmap.org/export#map=16/35.6522/139.6442",
      "manifest-v1:tokyo-setagaya-2026-07-10",
    ),
    geometry: {
      worldSize: point(270, 190),
      roadWidth: 6.5,
      shoulderWidth: 0.8,
      roadSurfaces: [
        roadSurface("jp-south-road", [jpNodes.a.position, jpNodes.b.position, jpNodes.c.position], 6.4, ["jp-south-east-1", "jp-south-east-2", "jp-south-west-1", "jp-south-west-2"]),
        roadSurface("jp-east-curve", [jpNodes.c.position, point(102, -56), point(108, -35), jpNodes.d.position], 6.4, ["jp-curve-north", "jp-curve-south"]),
        roadSurface("jp-center-road", [jpNodes.d.position, point(82, 18), jpNodes.e.position, jpNodes.f.position, jpNodes.g.position], 6.4, ["jp-center-west-1", "jp-center-west-2", "jp-center-west-3", "jp-center-east-1", "jp-center-east-2", "jp-center-east-3"]),
        roadSurface("jp-west-road", [jpNodes.g.position, jpNodes.h.position], 6.4, ["jp-west-north", "jp-west-south"]),
        roadSurface("jp-north-road", [jpNodes.h.position, jpNodes.i.position, jpNodes.j.position], 6.4, ["jp-north-east-1", "jp-north-east-2", "jp-north-west-1", "jp-north-west-2"]),
        roadSurface("jp-junction-road", [jpNodes.e.position, point(82, 47), jpNodes.j.position], 6.4, ["jp-junction-south", "jp-junction-north"]),
        roadSurface("jp-narrow-road", [jpNodes.b.position, jpNodes.f.position, jpNodes.i.position], 5.8, ["jp-narrow-north-1", "jp-narrow-north-2", "jp-narrow-south-1", "jp-narrow-south-2"], "shared_space"),
      ],
      blocks: [
        { id: "jp-block-west", center: point(-70, 46), size: point(64, 40), heightRange: [5, 14], density: 0.72, material: "plaster" },
        { id: "jp-block-center", center: point(10, 46), size: point(64, 40), heightRange: [6, 18], density: 0.78, material: "tile" },
        { id: "jp-block-south", center: point(-48, -30), size: point(100, 50), heightRange: [5, 13], density: 0.7, material: "wood-plaster" },
      ],
      landmarks: [
        { id: "jp-gotokuji-station", kind: "station", center: point(-22, 12), size: point(20, 9), color: "#e85e59" },
        { id: "jp-setagaya-line", kind: "railway", center: point(10, -62), size: point(220, 5), color: "#656a70" },
        { id: "jp-temple-green", kind: "park", center: point(78, 48), size: point(42, 38), color: "#527b4d" },
      ],
    },
    laneGraph: graph(
      Object.values(jpNodes),
      jpLanes,
      [
        control("jp-rail-signal", "railway_signal", 18, -72, 90, ["jp-south-east-2"], ["jp-rail-conflict"],
          [approach("jp-rail-eastbound-approach", "jp-south-east-2", 42, "railway", ["jp-rail-conflict"])],
          [
            installation("jp-rail-east-crossing", 12, -77, 90, "railway_crossing", "japan_railway", "primary"),
            installation("jp-rail-west-crossing", 24, -67, 270, "railway_crossing", "japan_railway", "secondary"),
          ]),
        control("jp-stop-narrow", "stop", -30, 12, 0, ["jp-narrow-north-1"], undefined,
          [approach("jp-stop-narrow-approach", "jp-narrow-north-1", 84, "stop")],
          [installation("jp-stop-narrow-sign", -36, 10, 0, "roadside_pole", "stop_sign", "primary")]),
        control("jp-crosswalk-station", "crosswalk", -30, 18, 90, ["jp-center-west-2", "jp-narrow-north-2"], ["jp-station-conflict"],
          [
            approach("jp-station-westbound-crosswalk", "jp-center-west-2", 76, "crosswalk", ["jp-station-conflict"]),
            approach("jp-station-northbound-crosswalk", "jp-narrow-north-2", 0, "crosswalk", ["jp-station-conflict"]),
          ],
          [installation("jp-station-crosswalk-marking", -30, 18, 90, "road_marking", "crosswalk", "marking")]),
      ],
      [
        { id: "jp-rail-conflict", laneIds: ["jp-south-east-2"], polygon: [point(12, -80), point(24, -80), point(24, -64), point(12, -64)] },
        { id: "jp-station-conflict", laneIds: ["jp-center-west-2", "jp-narrow-north-2"], polygon: [point(-38, 10), point(-22, 10), point(-22, 26), point(-38, 26)] },
      ],
      [
        anchoredSpawn("jp-player", "player", "jp-south-east-1", 18),
        anchoredSpawn("jp-car-1", "vehicle", "jp-curve-north", 12),
        freeSpawn("jp-ped-1", "pedestrian", -35, 10, 0),
        freeSpawn("jp-cyclist-1", "cyclist", -30, 48, 0, "jp-narrow-north-2"),
      ],
      [
        checkpoint("jp-start", "Setagaya start", "jp-south-east-1", 18),
        checkpoint("jp-rail", "Setagaya Line crossing", "jp-south-east-2", 38),
        checkpoint("jp-station", "Gotokuji station street", "jp-center-west-2", 50),
        checkpoint("jp-finish", "Neighbourhood finish", "jp-north-east-2", 54),
      ],
    ),
  },
  {
    id: "folkestone-coquelles",
    name: "Folkestone to Coquelles",
    areaLabel: "Simplified terminal-to-terminal side-swap transition",
    countryIds: ["uk", "fr"],
    source: osmSource(
      { south: 51.0862, west: 1.1118, north: 51.0962, east: 1.1342 },
      "https://www.openstreetmap.org/export#map=16/51.0912/1.1230",
      "manifest-v1:folkestone-coquelles-2026-07-10",
      [{ south: 50.9287, west: 1.797, north: 50.9387, east: 1.8194 }],
    ),
    geometry: {
      worldSize: point(330, 130),
      roadWidth: 8,
      shoulderWidth: 1.5,
      roadSurfaces: [
        roadSurface("xf-uk-road", [transitionNodes.uk0.position, transitionNodes.uk1.position], 7.4, ["xf-uk-approach", "xf-uk-approach-opposite"]),
        roadSurface("xf-uk-terminal-road", [transitionNodes.uk1.position, point(-48, -20), transitionNodes.uk2.position], 7.2, ["xf-uk-terminal"], "terminal"),
        roadSurface("xf-shuttle-road", [transitionNodes.uk2.position, transitionNodes.gate.position], 6, ["xf-shuttle"], "terminal"),
        roadSurface("xf-fr-terminal-road", [transitionNodes.gate.position, transitionNodes.fr0.position, point(48, 18), transitionNodes.fr1.position], 7.2, ["xf-fr-terminal", "xf-fr-exit"], "terminal"),
        roadSurface("xf-fr-road-surface", [transitionNodes.fr1.position, transitionNodes.fr2.position], 7.4, ["xf-fr-road", "xf-fr-road-opposite"]),
      ],
      blocks: [],
      landmarks: [
        { id: "xf-folkestone-terminal", kind: "terminal", center: point(-92, 26), size: point(76, 42), color: "#1f4f79" },
        { id: "xf-shuttle", kind: "railway", center: point(0, 0), size: point(42, 12), color: "#d6d9dc" },
        { id: "xf-coquelles-terminal", kind: "terminal", center: point(92, -26), size: point(76, 42), color: "#28589b" },
      ],
    },
    laneGraph: graph(
      Object.values(transitionNodes),
      transitionLanes,
      [
        control("xf-side-swap-gate", "side_swap_gate", 0, 0, 90, ["xf-shuttle", "xf-fr-terminal"], undefined,
          [approach("xf-side-swap-approach", "xf-shuttle", 18, "transition")],
          [installation("xf-side-swap-portal", 0, 0, 90, "terminal_portal", "side_swap_gate", "primary")]),
      ],
      [],
      [
        anchoredSpawn("xf-player", "player", "xf-uk-approach", 12),
        anchoredSpawn("xf-car-1", "vehicle", "xf-uk-approach", 56),
        anchoredSpawn("xf-car-2", "vehicle", "xf-fr-road", 22),
      ],
      [
        checkpoint("xf-uk-start", "Folkestone approach", "xf-uk-approach", 12),
        checkpoint("xf-shuttle", "Shuttle transition", "xf-shuttle", 12),
        checkpoint("xf-fr-start", "Coquelles exit", "xf-fr-terminal", 12),
        checkpoint("xf-finish", "French road", "xf-fr-road", 42),
      ],
    ),
  },
];

const prompt = (
  id: string,
  trigger: CoachPrompt["trigger"],
  message: string,
  sourceReferenceId?: string,
): CoachPrompt => ({
  id,
  trigger,
  message,
  ...(sourceReferenceId ? { sourceReferenceId } : {}),
});

export const LESSONS: readonly LessonDefinition[] = [
  {
    id: "orientation-right",
    kind: "orientation",
    title: "Right-Side Orientation",
    summary: "Build the habit of positioning the car on the right before entering real traffic.",
    mapId: "orientation-yard",
    trafficSide: "right",
    difficulty: 1,
    estimatedMinutes: [3, 5],
    startSpawnId: "yard-r-player",
    route: ["yard-r-north", "yard-r-east", "yard-r-south", "yard-r-west"],
    objectives: [
      { id: "right-position", label: "Keep to the right side", ruleCode: "wrong_way" },
      { id: "right-stop", label: "Stop completely at the practice sign", ruleCode: "incomplete_stop" },
      { id: "right-signal", label: "Signal before the final turn", ruleCode: "missing_indicator" },
    ],
    trafficSeed: 101,
    trafficDensity: "none",
    vulnerableRoadUsers: { pedestrians: 0, cyclists: 0 },
    checkpoints: ["yard-r-start", "yard-r-turn"],
    coachPrompts: [
      prompt("right-start", { type: "start" }, "Keep the centre line on your left; your lane belongs on the right.", "us-nyc-traffic-rules"),
      prompt("right-stop", { type: "route_progress", value: 0.25 }, "Brake to a complete stop, check both ways, then continue.", "us-nyc-traffic-rules"),
    ],
    assessedRules: ["wrong_way", "incomplete_stop", "missing_indicator"],
    sourceReferenceIds: ["us-nyc-traffic-rules", "fr-eu-road-rules"],
    prerequisites: [],
    unlocks: { lessonIds: ["us-one-way-grid", "fr-right-side-basics"], freeDriveIds: [] },
  },
  {
    id: "orientation-left",
    kind: "orientation",
    title: "Left-Side Orientation",
    summary: "Build the habit of positioning the car on the left before entering real traffic.",
    mapId: "orientation-yard",
    trafficSide: "left",
    difficulty: 1,
    estimatedMinutes: [3, 5],
    startSpawnId: "yard-l-player",
    route: ["yard-l-west", "yard-l-south", "yard-l-east", "yard-l-north"],
    objectives: [
      { id: "left-position", label: "Keep to the left side", ruleCode: "wrong_way" },
      { id: "left-stop", label: "Stop completely at the practice sign", ruleCode: "incomplete_stop" },
      { id: "left-signal", label: "Signal before the final turn", ruleCode: "missing_indicator" },
    ],
    trafficSeed: 102,
    trafficDensity: "none",
    vulnerableRoadUsers: { pedestrians: 0, cyclists: 0 },
    checkpoints: ["yard-l-start", "yard-l-turn"],
    coachPrompts: [
      prompt("left-start", { type: "start" }, "Keep the centre line on your right; your lane belongs on the left.", "uk-highway-code-road"),
      prompt("left-stop", { type: "route_progress", value: 0.25 }, "Brake to a complete stop and look carefully before moving.", "uk-highway-code-road"),
    ],
    assessedRules: ["wrong_way", "incomplete_stop", "missing_indicator"],
    sourceReferenceIds: ["uk-highway-code-road", "jp-jaf-traffic-rules"],
    prerequisites: [],
    unlocks: { lessonIds: ["uk-left-side-basics", "jp-left-side-basics"], freeDriveIds: [] },
  },
  ...LONDON_LESSONS,
  {
    id: "us-one-way-grid",
    kind: "guided",
    title: "The Manhattan Grid",
    summary: "Enter a right-side city grid, follow one-way arrows and make deliberate turns.",
    mapId: "nyc-upper-west-side",
    countryId: "us",
    destinationId: "us-nyc",
    trafficSide: "right",
    difficulty: 1,
    estimatedMinutes: [5, 7],
    startSpawnId: "nyc-player",
    route: ["nyc-72-east-1", "nyc-72-east-2", "nyc-columbus-n-1", "nyc-columbus-n-2", "nyc-79-west-1", "nyc-79-west-2", "nyc-west-end-s-1", "nyc-west-end-s-2"],
    objectives: [
      { id: "us-correct-side", label: "Stay right on two-way streets", ruleCode: "wrong_way" },
      { id: "us-one-way", label: "Follow one-way street arrows", ruleCode: "one_way" },
      { id: "us-indicate", label: "Signal every turn", ruleCode: "missing_indicator" },
    ],
    trafficSeed: 1101,
    trafficDensity: "light",
    vulnerableRoadUsers: { pedestrians: 6, cyclists: 2 },
    checkpoints: ["nyc-start", "nyc-broadway", "nyc-finish"],
    coachPrompts: [
      prompt("us-grid-start", { type: "start" }, "Use the right lane, and check the one-way arrow before every turn.", "us-nyc-traffic-rules"),
      prompt("us-grid-arrow", { type: "route_progress", value: 0.48 }, "This cross street is one-way. Turn only in the signed direction.", "us-nyc-traffic-rules"),
    ],
    assessedRules: ["wrong_way", "one_way", "missing_indicator", "speeding"],
    sourceReferenceIds: ["us-nyc-traffic-rules"],
    prerequisites: ["orientation-right"],
    unlocks: { lessonIds: ["us-signals-crosswalks"], freeDriveIds: ["free-us"] },
  },
  {
    id: "us-signals-crosswalks",
    kind: "guided",
    title: "Signals & Crosswalks",
    summary: "Read city signals, stop before the conflict zone and yield through busy crossings.",
    mapId: "nyc-upper-west-side",
    countryId: "us",
    destinationId: "us-nyc",
    trafficSide: "right",
    difficulty: 2,
    estimatedMinutes: [6, 8],
    startSpawnId: "nyc-player",
    route: ["nyc-72-east-1", "nyc-72-east-2", "nyc-columbus-n-1", "nyc-columbus-n-2", "nyc-79-west-1", "nyc-79-west-2", "nyc-west-end-s-1", "nyc-west-end-s-2"],
    objectives: [
      { id: "us-red", label: "Stop before a red-light conflict zone", ruleCode: "red_light" },
      { id: "us-crosswalk", label: "Yield to pedestrians in crosswalks", ruleCode: "pedestrian_priority" },
      { id: "us-gap", label: "Choose a safe turning gap", ruleCode: "unsafe_gap" },
    ],
    trafficSeed: 1102,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 10, cyclists: 3 },
    checkpoints: ["nyc-start", "nyc-broadway", "nyc-79", "nyc-finish"],
    coachPrompts: [
      prompt("us-signal", { type: "checkpoint", checkpointId: "nyc-broadway" }, "Stop before the crosswalk on red; green still requires a clear junction.", "us-nyc-traffic-rules"),
      prompt("us-ped", { type: "checkpoint", checkpointId: "nyc-79" }, "Scan both sidewalks and wait until the crosswalk is clear.", "us-nyc-traffic-rules"),
    ],
    assessedRules: ["red_light", "pedestrian_priority", "unsafe_gap", "following_distance"],
    sourceReferenceIds: ["us-nyc-traffic-rules"],
    prerequisites: ["us-one-way-grid"],
    unlocks: { lessonIds: ["us-lane-choice"], freeDriveIds: [] },
  },
  {
    id: "us-lane-choice",
    kind: "guided",
    title: "Lane Choice & Courtesy",
    summary: "Change lanes with observation and avoid holding the passing lane when a safe return is available.",
    mapId: "nyc-upper-west-side",
    countryId: "us",
    destinationId: "us-nyc",
    trafficSide: "right",
    difficulty: 3,
    estimatedMinutes: [6, 8],
    startSpawnId: "nyc-player",
    route: ["nyc-72-east-1", "nyc-72-east-2", "nyc-columbus-n-1", "nyc-columbus-n-2", "nyc-79-west-1", "nyc-79-west-2", "nyc-west-end-s-1", "nyc-west-end-s-2"],
    objectives: [
      { id: "us-observe", label: "Mirror, signal and check before changing lanes", ruleCode: "observation" },
      { id: "us-passing", label: "Return from the passing lane when safe", ruleCode: "lane_misuse" },
      { id: "us-distance", label: "Maintain a safe following gap", ruleCode: "following_distance" },
    ],
    trafficSeed: 1103,
    trafficDensity: "busy",
    vulnerableRoadUsers: { pedestrians: 8, cyclists: 4 },
    checkpoints: ["nyc-start", "nyc-broadway", "nyc-79", "nyc-finish"],
    coachPrompts: [
      prompt("us-lane-check", { type: "route_progress", value: 0.2 }, "Check mirrors and your blind spot, signal, then move only when the gap is safe.", "us-ny-dmv-passing"),
      prompt("us-honk", { type: "rule_event", ruleCode: "lane_misuse" }, "The honk is about lane use, not permission to speed. Return right when it is safe.", "us-ny-dmv-passing"),
    ],
    assessedRules: ["observation", "lane_misuse", "following_distance", "missing_indicator"],
    sourceReferenceIds: ["us-ny-dmv-passing", "us-nyc-traffic-rules"],
    prerequisites: ["us-signals-crosswalks"],
    unlocks: { lessonIds: [], freeDriveIds: [] },
  },
  {
    id: "uk-left-side-basics",
    kind: "guided",
    title: "Keep Left",
    summary: "Settle into left-side positioning on quiet Oldbrook approaches.",
    mapId: "milton-keynes-oldbrook",
    countryId: "uk",
    destinationId: "uk-milton-keynes",
    trafficSide: "left",
    difficulty: 1,
    estimatedMinutes: [5, 7],
    startSpawnId: "uk-player",
    route: ["uk-entry-south", "uk-rb-s-w", "uk-exit-west", "uk-west-south", "uk-entry-south"],
    objectives: [
      { id: "uk-side", label: "Keep left after every turn", ruleCode: "wrong_way" },
      { id: "uk-speed", label: "Match the posted mph limit", ruleCode: "speeding" },
      { id: "uk-signal", label: "Signal before turning", ruleCode: "missing_indicator" },
    ],
    trafficSeed: 1201,
    trafficDensity: "light",
    vulnerableRoadUsers: { pedestrians: 4, cyclists: 2 },
    checkpoints: ["uk-start", "uk-roundabout", "uk-finish"],
    coachPrompts: [
      prompt("uk-start-coach", { type: "start" }, "Keep left and use the centre line as your right-hand reference.", "uk-highway-code-road"),
      prompt("uk-speed-coach", { type: "route_progress", value: 0.5 }, "These signs are in miles per hour; slow before the next junction.", "uk-highway-code-road"),
    ],
    assessedRules: ["wrong_way", "speeding", "missing_indicator"],
    sourceReferenceIds: ["uk-highway-code-road"],
    prerequisites: ["orientation-left"],
    unlocks: { lessonIds: ["uk-roundabouts"], freeDriveIds: ["free-uk"] },
  },
  {
    id: "uk-roundabouts",
    kind: "guided",
    title: "Roundabout Rhythm",
    summary: "Approach in the correct lane, give way to the right and circulate clockwise.",
    mapId: "milton-keynes-oldbrook",
    countryId: "uk",
    destinationId: "uk-milton-keynes",
    trafficSide: "left",
    difficulty: 2,
    estimatedMinutes: [6, 8],
    startSpawnId: "uk-player",
    route: ["uk-entry-south", "uk-rb-s-w", "uk-rb-w-n", "uk-rb-n-e", "uk-exit-east", "uk-entry-east", "uk-rb-e-s", "uk-exit-south"],
    objectives: [
      { id: "uk-yield", label: "Give way to traffic from the right", ruleCode: "roundabout_yield" },
      { id: "uk-clockwise", label: "Circulate clockwise", ruleCode: "wrong_way" },
      { id: "uk-exit", label: "Signal before your exit", ruleCode: "missing_indicator" },
    ],
    trafficSeed: 1202,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 4, cyclists: 2 },
    checkpoints: ["uk-start", "uk-roundabout", "uk-finish"],
    coachPrompts: [
      prompt("uk-rb-approach", { type: "checkpoint", checkpointId: "uk-roundabout" }, "Look right and wait for a safe gap before joining clockwise traffic.", "uk-highway-code-road"),
      prompt("uk-rb-exit", { type: "route_progress", value: 0.55 }, "Signal left after the exit before yours, then leave into the left lane.", "uk-highway-code-road"),
    ],
    assessedRules: ["roundabout_yield", "wrong_way", "missing_indicator", "unsafe_gap"],
    sourceReferenceIds: ["uk-highway-code-road"],
    prerequisites: ["uk-left-side-basics"],
    unlocks: { lessonIds: ["uk-dual-carriageway"], freeDriveIds: [] },
  },
  {
    id: "uk-dual-carriageway",
    kind: "guided",
    title: "Dual Carriageway Courtesy",
    summary: "Merge safely, use the right lane only to overtake and return left when clear.",
    mapId: "milton-keynes-oldbrook",
    countryId: "uk",
    destinationId: "uk-milton-keynes",
    trafficSide: "left",
    difficulty: 3,
    estimatedMinutes: [6, 8],
    startSpawnId: "uk-player",
    route: ["uk-entry-south", "uk-rb-s-w", "uk-rb-w-n", "uk-exit-north", "uk-dual-n-east", "uk-east-north", "uk-entry-east", "uk-rb-e-s", "uk-exit-south"],
    objectives: [
      { id: "uk-merge", label: "Merge into a safe gap", ruleCode: "merge" },
      { id: "uk-passing", label: "Use the right lane for overtaking", ruleCode: "lane_misuse" },
      { id: "uk-return", label: "Return left when safely clear", ruleCode: "observation" },
    ],
    trafficSeed: 1203,
    trafficDensity: "busy",
    vulnerableRoadUsers: { pedestrians: 2, cyclists: 1 },
    checkpoints: ["uk-start", "uk-roundabout", "uk-dual", "uk-finish"],
    coachPrompts: [
      prompt("uk-dual-merge", { type: "checkpoint", checkpointId: "uk-dual" }, "Build speed, check right and merge into a safe gap without forcing traffic to brake.", "uk-highway-code-road"),
      prompt("uk-dual-honk", { type: "rule_event", ruleCode: "lane_misuse" }, "The right lane is for overtaking. A honk does not permit speeding; return left when safe.", "uk-highway-code-road"),
    ],
    assessedRules: ["merge", "lane_misuse", "observation", "following_distance", "speeding"],
    sourceReferenceIds: ["uk-highway-code-road"],
    prerequisites: ["uk-roundabouts"],
    unlocks: { lessonIds: ["uk-fr-side-swap"], freeDriveIds: [] },
  },
  {
    id: "fr-right-side-basics",
    kind: "guided",
    title: "Keep Right in France",
    summary: "Reset to right-side traffic, read km/h signs and make calm first turns.",
    mapId: "calais-coquelles",
    countryId: "fr",
    destinationId: "fr-calais",
    trafficSide: "right",
    difficulty: 1,
    estimatedMinutes: [5, 7],
    startSpawnId: "fr-player",
    route: ["fr-entry-south", "fr-rb-s-e", "fr-exit-east", "fr-east-south", "fr-entry-south"],
    objectives: [
      { id: "fr-side", label: "Keep right after turns", ruleCode: "wrong_way" },
      { id: "fr-kmh", label: "Read speed limits in km/h", ruleCode: "speeding" },
      { id: "fr-signal", label: "Signal every turn", ruleCode: "missing_indicator" },
    ],
    trafficSeed: 1301,
    trafficDensity: "light",
    vulnerableRoadUsers: { pedestrians: 3, cyclists: 3 },
    checkpoints: ["fr-start", "fr-roundabout", "fr-finish"],
    coachPrompts: [
      prompt("fr-start-coach", { type: "start" }, "Keep right. Your speedometer and signs now use kilometres per hour.", "fr-eu-road-rules"),
      prompt("fr-turn-coach", { type: "route_progress", value: 0.5 }, "After the turn, deliberately settle back onto the right side.", "fr-eu-road-rules"),
    ],
    assessedRules: ["wrong_way", "speeding", "missing_indicator"],
    sourceReferenceIds: ["fr-eu-road-rules"],
    prerequisites: ["orientation-right"],
    unlocks: { lessonIds: ["fr-priority-roundabouts"], freeDriveIds: ["free-fr"] },
  },
  {
    id: "fr-priority-roundabouts",
    kind: "guided",
    title: "Priority & Roundabouts",
    summary: "Recognise priority-to-the-right junctions and counterclockwise roundabouts.",
    mapId: "calais-coquelles",
    countryId: "fr",
    destinationId: "fr-calais",
    trafficSide: "right",
    difficulty: 2,
    estimatedMinutes: [6, 8],
    startSpawnId: "fr-player",
    route: ["fr-entry-south", "fr-rb-s-e", "fr-rb-e-n", "fr-exit-north", "fr-north-west", "fr-entry-west", "fr-rb-w-s", "fr-exit-south"],
    objectives: [
      { id: "fr-priority", label: "Yield at an unsigned priority-to-right junction", ruleCode: "priority_to_right" },
      { id: "fr-yield", label: "Yield before entering the roundabout", ruleCode: "roundabout_yield" },
      { id: "fr-circle", label: "Circulate counterclockwise", ruleCode: "wrong_way" },
    ],
    trafficSeed: 1302,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 4, cyclists: 4 },
    checkpoints: ["fr-start", "fr-roundabout", "fr-priority", "fr-finish"],
    coachPrompts: [
      prompt("fr-rb", { type: "checkpoint", checkpointId: "fr-roundabout" }, "Give way to traffic already circulating from your left, then travel counterclockwise.", "fr-eu-road-rules"),
      prompt("fr-priority-coach", { type: "checkpoint", checkpointId: "fr-priority" }, "No sign cancels it here: slow and check for traffic approaching from the right.", "fr-eu-road-rules"),
    ],
    assessedRules: ["priority_to_right", "roundabout_yield", "wrong_way", "unsafe_gap"],
    sourceReferenceIds: ["fr-eu-road-rules"],
    prerequisites: ["fr-right-side-basics"],
    unlocks: { lessonIds: ["fr-speed-merging"], freeDriveIds: [] },
  },
  {
    id: "fr-speed-merging",
    kind: "guided",
    title: "Autoroute Approach",
    summary: "Build speed in km/h, merge with observation and keep right except to pass.",
    mapId: "calais-coquelles",
    countryId: "fr",
    destinationId: "fr-calais",
    trafficSide: "right",
    difficulty: 3,
    estimatedMinutes: [6, 8],
    startSpawnId: "fr-player",
    route: ["fr-entry-south", "fr-rb-s-e", "fr-rb-e-n", "fr-rb-n-w", "fr-rb-w-s", "fr-exit-south", "fr-south-east", "fr-entry-east", "fr-rb-e-n", "fr-exit-north"],
    objectives: [
      { id: "fr-merge", label: "Merge without forcing traffic to brake", ruleCode: "merge" },
      { id: "fr-pass", label: "Use the left lane only to pass", ruleCode: "lane_misuse" },
      { id: "fr-gap", label: "Maintain a safe following gap", ruleCode: "following_distance" },
    ],
    trafficSeed: 1303,
    trafficDensity: "busy",
    vulnerableRoadUsers: { pedestrians: 2, cyclists: 1 },
    checkpoints: ["fr-start", "fr-roundabout", "fr-finish"],
    coachPrompts: [
      prompt("fr-merge-coach", { type: "route_progress", value: 0.45 }, "Use the slip road to match traffic speed, observe left and enter a safe gap.", "fr-eu-road-rules"),
      prompt("fr-pass-coach", { type: "rule_event", ruleCode: "lane_misuse" }, "Keep right when not passing. The left lane is not a fast-lane speed exemption.", "fr-eu-road-rules"),
    ],
    assessedRules: ["merge", "lane_misuse", "following_distance", "observation", "speeding"],
    sourceReferenceIds: ["fr-eu-road-rules"],
    prerequisites: ["fr-priority-roundabouts"],
    unlocks: { lessonIds: ["uk-fr-side-swap"], freeDriveIds: [] },
  },
  {
    id: "jp-left-side-basics",
    kind: "guided",
    title: "Setagaya Left-Side Basics",
    summary: "Keep left on compact neighbourhood streets and slow early for limited visibility.",
    mapId: "tokyo-setagaya",
    countryId: "jp",
    destinationId: "jp-tokyo",
    trafficSide: "left",
    difficulty: 1,
    estimatedMinutes: [5, 7],
    startSpawnId: "jp-player",
    route: ["jp-south-east-1", "jp-narrow-north-1", "jp-narrow-north-2", "jp-north-east-2", "jp-junction-south", "jp-center-west-2", "jp-center-west-3"],
    objectives: [
      { id: "jp-side", label: "Keep left on narrow streets", ruleCode: "wrong_way" },
      { id: "jp-speed", label: "Slow for visibility and km/h limits", ruleCode: "speeding" },
      { id: "jp-stop", label: "Stop at the marked neighbourhood junction", ruleCode: "incomplete_stop" },
    ],
    trafficSeed: 1401,
    trafficDensity: "light",
    vulnerableRoadUsers: { pedestrians: 7, cyclists: 5 },
    checkpoints: ["jp-start", "jp-station", "jp-finish"],
    coachPrompts: [
      prompt("jp-start-coach", { type: "start" }, "Keep left and leave extra space for people emerging from narrow side streets.", "jp-jaf-traffic-rules"),
      prompt("jp-stop-coach", { type: "route_progress", value: 0.38 }, "Stop at the marking even when the street appears quiet.", "jp-jaf-traffic-rules"),
    ],
    assessedRules: ["wrong_way", "speeding", "incomplete_stop", "observation"],
    sourceReferenceIds: ["jp-jaf-traffic-rules"],
    prerequisites: ["orientation-left"],
    unlocks: { lessonIds: ["jp-vulnerable-road-users"], freeDriveIds: ["free-jp"] },
  },
  {
    id: "jp-vulnerable-road-users",
    kind: "guided",
    title: "People, Bicycles & Narrow Streets",
    summary: "Scan around parked vehicles and give pedestrians and cyclists patient space.",
    mapId: "tokyo-setagaya",
    countryId: "jp",
    destinationId: "jp-tokyo",
    trafficSide: "left",
    difficulty: 2,
    estimatedMinutes: [6, 8],
    startSpawnId: "jp-player",
    route: ["jp-south-east-1", "jp-narrow-north-1", "jp-narrow-north-2", "jp-north-east-2", "jp-junction-south", "jp-center-west-2", "jp-center-west-3", "jp-west-north"],
    objectives: [
      { id: "jp-ped", label: "Yield at the station crosswalk", ruleCode: "pedestrian_priority" },
      { id: "jp-bike", label: "Pass cyclists only with safe clearance", ruleCode: "cyclist_clearance" },
      { id: "jp-follow", label: "Keep a patient following distance", ruleCode: "following_distance" },
    ],
    trafficSeed: 1402,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 12, cyclists: 8 },
    checkpoints: ["jp-start", "jp-station", "jp-finish"],
    coachPrompts: [
      prompt("jp-station-ped", { type: "checkpoint", checkpointId: "jp-station" }, "Cover the brake and let people finish crossing before you move.", "jp-jaf-traffic-rules"),
      prompt("jp-cycle-space", { type: "route_progress", value: 0.65 }, "Wait behind the cyclist until there is enough room to pass without crowding them.", "jp-jaf-traffic-rules"),
    ],
    assessedRules: ["pedestrian_priority", "cyclist_clearance", "following_distance", "observation"],
    sourceReferenceIds: ["jp-jaf-traffic-rules"],
    prerequisites: ["jp-left-side-basics"],
    unlocks: { lessonIds: ["jp-railway-crossings"], freeDriveIds: [] },
  },
  {
    id: "jp-railway-crossings",
    kind: "guided",
    title: "Setagaya Line Crossing",
    summary: "Approach a railway crossing slowly, stop, observe and keep the tracks clear.",
    mapId: "tokyo-setagaya",
    countryId: "jp",
    destinationId: "jp-tokyo",
    trafficSide: "left",
    difficulty: 3,
    estimatedMinutes: [6, 8],
    startSpawnId: "jp-player",
    route: ["jp-south-east-1", "jp-south-east-2", "jp-curve-north", "jp-center-west-1", "jp-center-west-2", "jp-center-west-3", "jp-west-north", "jp-north-east-1", "jp-north-east-2"],
    objectives: [
      { id: "jp-rail-stop", label: "Stop and check before the railway", ruleCode: "railway_crossing" },
      { id: "jp-rail-clear", label: "Cross only when the far side is clear", ruleCode: "unsafe_gap" },
      { id: "jp-rail-observe", label: "Look and listen in both directions", ruleCode: "observation" },
    ],
    trafficSeed: 1403,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 9, cyclists: 6 },
    checkpoints: ["jp-start", "jp-rail", "jp-station", "jp-finish"],
    coachPrompts: [
      prompt("jp-rail-coach", { type: "checkpoint", checkpointId: "jp-rail" }, "Stop before the tracks, check both directions and enter only if you can clear the crossing.", "jp-jaf-traffic-rules"),
      prompt("jp-rail-block", { type: "rule_event", ruleCode: "railway_crossing" }, "Never queue on the tracks. Wait before the crossing until your exit is open.", "jp-jaf-traffic-rules"),
    ],
    assessedRules: ["railway_crossing", "unsafe_gap", "observation", "following_distance"],
    sourceReferenceIds: ["jp-jaf-traffic-rules"],
    prerequisites: ["jp-vulnerable-road-users"],
    unlocks: { lessonIds: [], freeDriveIds: [] },
  },
  {
    id: "uk-fr-side-swap",
    kind: "transition",
    title: "The SideSwap Crossing",
    summary: "Enter Folkestone on the left, take a simplified shuttle transition and leave Coquelles on the right.",
    mapId: "folkestone-coquelles",
    trafficSide: "left",
    difficulty: 4,
    estimatedMinutes: [7, 10],
    startSpawnId: "xf-player",
    route: ["xf-uk-approach", "xf-uk-terminal", "xf-shuttle", "xf-fr-terminal", "xf-fr-exit", "xf-fr-road"],
    objectives: [
      { id: "xf-uk-side", label: "Approach the UK terminal on the left", ruleCode: "wrong_way" },
      { id: "xf-switch", label: "Follow the marked side-swap transition", ruleCode: "border_transition" },
      { id: "xf-fr-side", label: "Leave the French terminal on the right", ruleCode: "wrong_way" },
    ],
    trafficSeed: 1501,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 2, cyclists: 0 },
    checkpoints: ["xf-uk-start", "xf-shuttle", "xf-fr-start", "xf-finish"],
    coachPrompts: [
      prompt("xf-start", { type: "start" }, "You are still in the UK: keep left through the Folkestone approach.", "uk-highway-code-road"),
      prompt("xf-swap", { type: "checkpoint", checkpointId: "xf-shuttle" }, "The shuttle is the transition. Follow the lane arrows; French traffic rules begin at the exit.", "fr-eu-road-rules"),
      prompt("xf-fr", { type: "checkpoint", checkpointId: "xf-fr-start" }, "Reset your road position now: keep right, read km/h signs and look left at the first roundabout.", "fr-eu-road-rules"),
    ],
    assessedRules: ["wrong_way", "border_transition", "observation", "speeding"],
    sourceReferenceIds: ["uk-highway-code-road", "fr-eu-road-rules"],
    prerequisites: ["uk-dual-carriageway", "fr-speed-merging"],
    unlocks: { lessonIds: [], freeDriveIds: [] },
    profileTransitions: [
      {
        checkpointId: "xf-fr-start",
        fromCountryId: "uk",
        toCountryId: "fr",
        message: "Side swapped: keep right and use km/h.",
      },
    ],
  },
];

export const FREE_DRIVES: readonly FreeDriveDefinition[] = [
  LONDON_FREE_DRIVE,
  {
    id: "free-us",
    countryId: "us",
    destinationId: "us-nyc",
    mapId: "nyc-upper-west-side",
    title: "Free Drive — New York City",
    description: "Explore the Upper West Side miniature with coaching available but no fixed route.",
    unlockAfter: "us-one-way-grid",
    startSpawnId: "nyc-player",
    trafficSeed: 2101,
  },
  {
    id: "free-uk",
    countryId: "uk",
    destinationId: "uk-milton-keynes",
    mapId: "milton-keynes-oldbrook",
    title: "Free Drive — Milton Keynes",
    description: "Practise left-side roads and roundabout approaches at your own pace.",
    unlockAfter: "uk-left-side-basics",
    startSpawnId: "uk-player",
    trafficSeed: 2201,
  },
  {
    id: "free-fr",
    countryId: "fr",
    destinationId: "fr-calais",
    mapId: "calais-coquelles",
    title: "Free Drive — Calais & Coquelles",
    description: "Explore right-side French roads, roundabouts and priority junctions.",
    unlockAfter: "fr-right-side-basics",
    startSpawnId: "fr-player",
    trafficSeed: 2301,
  },
  {
    id: "free-jp",
    countryId: "jp",
    destinationId: "jp-tokyo",
    mapId: "tokyo-setagaya",
    title: "Free Drive — Tokyo Setagaya",
    description: "Navigate narrow left-side neighbourhood streets with patient local traffic.",
    unlockAfter: "jp-left-side-basics",
    startSpawnId: "jp-player",
    trafficSeed: 2401,
  },
];

export const SCORING_CONFIG: ScoringConfig = {
  weights: {
    safety: 0.5,
    ruleUse: 0.35,
    vehicleControl: 0.15,
  },
  masteryThreshold: 80,
  masteryAllowsCriticalErrors: false,
  criticalRuleCodes: ["collision", "wrong_way", "red_light", "out_of_bounds"],
  penalties: {
    collision: 50,
    wrong_way: 35,
    red_light: 35,
    out_of_bounds: 30,
    speeding: 6,
    incomplete_stop: 8,
    missing_indicator: 4,
    unsafe_gap: 12,
    following_distance: 7,
    lane_misuse: 6,
    one_way: 20,
    roundabout_yield: 12,
    merge: 10,
    pedestrian_priority: 18,
    cyclist_clearance: 12,
    railway_crossing: 20,
    priority_to_right: 10,
    observation: 6,
    border_transition: 15,
    box_junction: 6,
    restricted_lane: 4,
  },
};

const countryById = new Map(COUNTRY_PROFILES.map((profile) => [profile.id, profile]));
const destinationById = new Map(
  DESTINATION_PROFILES.map((profile) => [profile.id, profile]),
);
const mapById = new Map(MAP_PACKS.map((mapPack) => [mapPack.id, mapPack]));
const lessonById = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));
const freeDriveById = new Map(FREE_DRIVES.map((freeDrive) => [freeDrive.id, freeDrive]));

export function getCountryProfile(id: CountryId): CountryProfile {
  const profile = countryById.get(id);
  if (!profile) {
    throw new Error(`Unknown SideSwap country profile: ${id}`);
  }
  return profile;
}

export function getDestinationProfile(id: DestinationId): DestinationProfile {
  const profile = destinationById.get(id);
  if (!profile) {
    throw new Error(`Unknown SideSwap destination profile: ${id}`);
  }
  return profile;
}

export function getMapPack(id: MapId): MapPack {
  const mapPack = mapById.get(id);
  if (!mapPack) {
    throw new Error(`Unknown SideSwap map pack: ${id}`);
  }
  return mapPack;
}

export function getLesson(id: LessonId): LessonDefinition {
  const lesson = lessonById.get(id);
  if (!lesson) {
    throw new Error(`Unknown SideSwap lesson: ${id}`);
  }
  return lesson;
}

export function getFreeDrive(id: FreeDriveId): FreeDriveDefinition {
  const freeDrive = freeDriveById.get(id);
  if (!freeDrive) {
    throw new Error(`Unknown SideSwap free-drive scenario: ${id}`);
  }
  return freeDrive;
}

export function getLessonsForCountry(id: CountryId): readonly LessonDefinition[] {
  return LESSONS.filter((lesson) => lesson.countryId === id);
}

export function getLessonsForDestination(
  id: DestinationId,
): readonly LessonDefinition[] {
  return LESSONS.filter((lesson) => lesson.destinationId === id);
}

export function getFreeDriveForDestination(
  id: DestinationId,
): FreeDriveDefinition {
  const freeDrive = FREE_DRIVES.find((scenario) => scenario.destinationId === id);
  if (!freeDrive) {
    throw new Error(`Missing SideSwap free-drive scenario for destination ${id}`);
  }
  return freeDrive;
}

export function getOrientationForTrafficSide(side: TrafficSide): LessonDefinition {
  return getLesson(side === "right" ? "orientation-right" : "orientation-left");
}

export function getCountryIdForScenario(scenarioId: ScenarioId): CountryId {
  if (freeDriveById.has(scenarioId as FreeDriveId)) {
    return getFreeDrive(scenarioId as FreeDriveId).countryId;
  }

  const lesson = getLesson(scenarioId as LessonId);
  if (lesson.countryId) {
    return lesson.countryId;
  }
  if (lesson.id === "orientation-right") {
    return "us";
  }
  if (lesson.id === "orientation-left") {
    return "uk";
  }
  if (lesson.profileTransitions?.length) {
    return lesson.profileTransitions[0].fromCountryId;
  }
  return "uk";
}

export function getDestinationIdForScenario(
  scenarioId: ScenarioId,
): DestinationId | undefined {
  if (freeDriveById.has(scenarioId as FreeDriveId)) {
    return getFreeDrive(scenarioId as FreeDriveId).destinationId;
  }
  return getLesson(scenarioId as LessonId).destinationId;
}

/**
 * Keeps the launch destination authoritative. Shared orientation lessons may
 * run in either country that follows the same traffic side, while the
 * Folkestone-to-Coquelles capstone must begin with the UK profile.
 */
export function isScenarioCompatibleWithCountry(
  scenarioId: ScenarioId,
  countryId: CountryId,
): boolean {
  const profile = getCountryProfile(countryId);

  if (freeDriveById.has(scenarioId as FreeDriveId)) {
    return getFreeDrive(scenarioId as FreeDriveId).countryId === countryId;
  }

  const lesson = getLesson(scenarioId as LessonId);
  if (lesson.countryId) {
    return lesson.countryId === countryId && lesson.trafficSide === profile.trafficSide;
  }
  if (lesson.kind === "orientation") {
    return lesson.trafficSide === profile.trafficSide;
  }
  if (lesson.kind === "transition") {
    return (
      lesson.profileTransitions?.[0]?.fromCountryId === countryId &&
      lesson.trafficSide === profile.trafficSide
    );
  }
  return false;
}

/**
 * Validates the complete launch tuple, not only the jurisdiction. Destination
 * scenarios must belong to the exact miniature and map selected by the player.
 * Orientations are shared by traffic side, while the capstone can start from
 * either UK destination.
 */
export function isScenarioCompatibleWithDestination(
  scenarioId: ScenarioId,
  destinationId: DestinationId,
): boolean {
  const destination = getDestinationProfile(destinationId);
  const country = getCountryProfile(destination.countryId);

  if (freeDriveById.has(scenarioId as FreeDriveId)) {
    const freeDrive = getFreeDrive(scenarioId as FreeDriveId);
    return (
      freeDrive.destinationId === destinationId &&
      freeDrive.countryId === destination.countryId &&
      freeDrive.mapId === destination.mapId
    );
  }

  const lesson = getLesson(scenarioId as LessonId);
  if (lesson.kind === "orientation") {
    return lesson.trafficSide === country.trafficSide;
  }
  if (lesson.id === "uk-fr-side-swap") {
    return (
      destination.countryId === "uk" &&
      lesson.profileTransitions?.[0]?.fromCountryId === "uk" &&
      lesson.trafficSide === country.trafficSide
    );
  }
  return (
    lesson.destinationId === destinationId &&
    lesson.countryId === destination.countryId &&
    lesson.mapId === destination.mapId &&
    lesson.trafficSide === country.trafficSide
  );
}

export function resolveSteeringSide(
  preference: SteeringPreference,
  profile: CountryProfile,
): SteeringSide {
  return preference === "auto" ? profile.defaultSteeringSide : preference;
}

export function resolveSessionConfig(config: GameSessionConfig): ResolvedGameSessionConfig {
  const profile = getCountryProfile(config.countryId);
  const destination = getDestinationProfile(config.destinationId);
  if (destination.countryId !== config.countryId) {
    throw new Error(
      `SideSwap destination ${config.destinationId} is not compatible with country ${config.countryId}`,
    );
  }
  if (!isScenarioCompatibleWithDestination(config.scenarioId, config.destinationId)) {
    throw new Error(
      `SideSwap scenario ${config.scenarioId} is not compatible with destination ${config.destinationId}`,
    );
  }
  return {
    ...config,
    trafficSide: profile.trafficSide,
    steeringSide: resolveSteeringSide(config.steeringPreference, profile),
    speedUnit: profile.speedUnit,
  };
}

export function getRuleReference(referenceId: string): OfficialRuleReference | undefined {
  for (const profile of COUNTRY_PROFILES) {
    const reference = profile.officialReferences.find((item) => item.id === referenceId);
    if (reference) {
      return reference;
    }
  }
  return undefined;
}

export function isLessonId(value: string): value is LessonId {
  return lessonById.has(value as LessonId);
}

export function isFreeDriveId(value: string): value is FreeDriveId {
  return freeDriveById.has(value as FreeDriveId);
}

export function getPenaltyForRule(code: RuleCode): number {
  return SCORING_CONFIG.penalties[code] ?? 0;
}
