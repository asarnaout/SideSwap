import type {
  CoachPrompt,
  FreeDriveDefinition,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  LessonDefinition,
  MapCheckpoint,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  RoadMarkingPath,
  RoadMarkingStyle,
  RoadSurface,
  RoadSurfaceType,
  ScenarioClock,
  TrafficControl,
  TrafficControlApproach,
  TrafficControlInstallation,
  WorldPoint,
} from "./types";

export const LONDON_CONTENT_REVIEWED_ON = "2026-07-11";

/**
 * Official references used by the London curriculum. OpenStreetMap is kept
 * exclusively on the map source record below and is never used as a rule
 * authority.
 */
export const LONDON_RULE_REFERENCES: readonly OfficialRuleReference[] = [
  {
    id: "uk-london-highway-code-general",
    title:
      "The Highway Code — General rules, techniques and advice for drivers and riders (103–158)",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "speeding",
      "missing_indicator",
      "following_distance",
      "lane_misuse",
      "restricted_lane",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-london-highway-code-road",
    title: "The Highway Code — Using the road (159–203)",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [
      "wrong_way",
      "red_light",
      "missing_indicator",
      "unsafe_gap",
      "box_junction",
      "one_way",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-london-road-user-hierarchy",
    title: "The Highway Code — Introduction and hierarchy of road users",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/introduction",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [
      "unsafe_gap",
      "pedestrian_priority",
      "cyclist_clearance",
      "observation",
    ],
  },
  {
    id: "uk-london-rbkc-20mph",
    title: "Borough-wide 20 mph speed limit",
    authority: "Royal Borough of Kensington and Chelsea",
    jurisdiction: "Kensington and Chelsea, London",
    url: "https://www.rbkc.gov.uk/streets-and-transport/road-safety/borough-wide-20mph-speed-limit",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: ["speeding"],
  },
  {
    id: "uk-london-tfl-20mph-order",
    title:
      "GLA Roads in Kensington and Chelsea — 20 mph Speed Limit Order 2023",
    authority: "Transport for London",
    jurisdiction: "Kensington and Chelsea, London",
    url: "https://foi.tfl.gov.uk/FOI-1947-2526/GLA_2023_0041%20-%20Order_Redacted.pdf",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: ["speeding"],
  },
  {
    id: "uk-london-tfl-driving-charges",
    title: "Pay to drive in London",
    authority: "Transport for London",
    jurisdiction: "London, United Kingdom",
    url: "https://tfl.gov.uk/modes/driving/pay-to-drive-in-london",
    reviewedOn: LONDON_CONTENT_REVIEWED_ON,
    appliesTo: [],
  },
];

export const LONDON_SCENARIO_CLOCK: ScenarioClock = {
  weekday: "tue",
  minutesAfterMidnight: 8 * 60 + 30,
  label: "Tuesday · 08:30",
};

const point = (x: number, z: number): WorldPoint => ({ x, z });

const node = (id: string, x: number, z: number): LaneNode => ({
  id,
  position: point(x, z),
});

const roadIdForLane = (id: string): string => {
  if (id.startsWith("london-local") || id.startsWith("london-quiet") || id.startsWith("london-cromwell-local")) return "london-quiet-loop";
  if (id.startsWith("london-queen-gate")) return "london-queen-gate";
  if (id.startsWith("london-cromwell-east-1") || id.startsWith("london-cromwell-east-bus") || id.startsWith("london-cromwell-west-2")) return "london-cromwell-west";
  if (id.startsWith("london-cromwell-east-2") || id.startsWith("london-cromwell-west-1")) return "london-cromwell-east";
  if (id.startsWith("london-east-north")) return "london-east-road";
  if (id.startsWith("london-thurloe")) return "london-thurloe-place";
  if (id.startsWith("london-exhibition")) return "london-exhibition-road";
  return id;
};

const CONNECTOR_LENGTH_M = 0.5;

const distanceBetweenPoints = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const conflictZoneForNode = (nodeId: string): string => {
  if (nodeId === "london-node-queen-gate-cromwell") {
    return "london-queen-gate-cromwell-conflict";
  }
  if (nodeId === "london-node-exhibition-cromwell") {
    return "london-cromwell-exhibition-conflict";
  }
  return `junction-${nodeId}`;
};

const laneTrue = (
  id: string,
  from: LaneNode,
  to: LaneNode,
  speedLimit: number,
  successors: readonly string[],
  role: LaneRole,
  establishedPath: readonly WorldPoint[],
  adjacentLaneIds?: readonly string[],
  roadId: string = roadIdForLane(id),
  widthM = id.includes("cromwell") || id.includes("queen-gate") ? 3.4 : 3.2,
): LaneSegment => {
  const first = establishedPath[0];
  const last = establishedPath.at(-1)!;
  const dominantHorizontal =
    Math.abs(to.position.x - from.position.x) >=
    Math.abs(to.position.z - from.position.z);
  const directionX = Math.sign(to.position.x - from.position.x);
  const directionZ = Math.sign(to.position.z - from.position.z);
  const startEstablished =
    distanceBetweenPoints(from.position, first) <= 2
      ? first
      : dominantHorizontal
        ? point(from.position.x + directionX * CONNECTOR_LENGTH_M, first.z)
        : point(first.x, from.position.z + directionZ * CONNECTOR_LENGTH_M);
  const endEstablished =
    distanceBetweenPoints(to.position, last) <= 2
      ? last
      : dominantHorizontal
        ? point(to.position.x - directionX * CONNECTOR_LENGTH_M, last.z)
        : point(last.x, to.position.z - directionZ * CONNECTOR_LENGTH_M);
  const centerline = [
    from.position,
    startEstablished,
    ...establishedPath,
    endEstablished,
    to.position,
  ];
  const startConnectorLengthM = distanceBetweenPoints(
    from.position,
    startEstablished,
  );
  const endConnectorLengthM = distanceBetweenPoints(endEstablished, to.position);
  const totalLengthM = centerline.slice(1).reduce(
    (total, current, index) =>
      total + distanceBetweenPoints(centerline[index], current),
    0,
  );

  return {
    id,
    roadId,
    widthM,
    from: from.id,
    to: to.id,
    centerline,
    role,
    trafficSide: "left",
    speedLimit,
    successors,
    ...(adjacentLaneIds ? { adjacentLaneIds } : {}),
    connectorRanges: [
      {
        startDistanceAlongM: 0,
        endDistanceAlongM: startConnectorLengthM,
        ...(conflictZoneForNode(from.id)
          ? { conflictZoneId: conflictZoneForNode(from.id) }
          : {}),
      },
      {
        startDistanceAlongM: totalLengthM - endConnectorLengthM,
        endDistanceAlongM: totalLengthM,
        ...(conflictZoneForNode(to.id)
          ? { conflictZoneId: conflictZoneForNode(to.id) }
          : {}),
      },
    ],
  };
};

const CONNECTOR_ZONE_RADIUS_M = 2.1;

const connectorConflictZones = (
  lanes: readonly LaneSegment[],
  authoredZones: LaneGraph["conflictZones"],
): LaneGraph["conflictZones"] => {
  const connectorLaneIds = new Map<string, Set<string>>();
  const generatedCenters = new Map<string, WorldPoint>();
  const authoredIds = new Set(authoredZones.map((zone) => zone.id));

  for (const lane of lanes) {
    for (const range of lane.connectorRanges ?? []) {
      const conflictZoneId = range.conflictZoneId;
      if (!conflictZoneId) continue;
      const laneIds = connectorLaneIds.get(conflictZoneId) ?? new Set<string>();
      laneIds.add(lane.id);
      connectorLaneIds.set(conflictZoneId, laneIds);
      if (!authoredIds.has(conflictZoneId)) {
        generatedCenters.set(
          conflictZoneId,
          range.startDistanceAlongM <= 1e-6
            ? lane.centerline[0]
            : lane.centerline.at(-1)!,
        );
      }
    }
  }

  const authored = authoredZones.map((zone) => ({
    ...zone,
    laneIds: [
      ...new Set([
        ...zone.laneIds,
        ...(connectorLaneIds.get(zone.id) ?? []),
      ]),
    ],
  }));
  const generated = [...generatedCenters].map(([id, center]) => ({
    id,
    laneIds: [...(connectorLaneIds.get(id) ?? [])],
    polygon: [
      point(center.x - CONNECTOR_ZONE_RADIUS_M, center.z - CONNECTOR_ZONE_RADIUS_M),
      point(center.x + CONNECTOR_ZONE_RADIUS_M, center.z - CONNECTOR_ZONE_RADIUS_M),
      point(center.x + CONNECTOR_ZONE_RADIUS_M, center.z + CONNECTOR_ZONE_RADIUS_M),
      point(center.x - CONNECTOR_ZONE_RADIUS_M, center.z + CONNECTOR_ZONE_RADIUS_M),
    ],
  }));
  return [...authored, ...generated];
};

const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

// Distances include the short junction connector before each established
// running lane. These anchors resolve to the requested lane-true starts at
// approximately (-121.98, -105.8) and (-109.7, -92).
const LONDON_QUIET_START_DISTANCE_M = 15.35;
const LONDON_QUEEN_GATE_START_DISTANCE_M = 13.27;

const roadMarking = (
  id: string,
  style: RoadMarkingStyle,
  points: readonly WorldPoint[],
  color?: RoadMarkingPath["color"],
): RoadMarkingPath => ({ id, style, points, ...(color ? { color } : {}) });

const roadSurface = (
  id: string,
  centerline: readonly WorldPoint[],
  widthM: number,
  laneIds: readonly string[],
  surfaceType: RoadSurfaceType = "standard",
  markings: readonly RoadMarkingPath[] = [],
): RoadSurface => ({
  id,
  centerline,
  widthM,
  laneIds,
  surfaceType,
  markings,
});

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
): TrafficControlInstallation => ({
  id,
  position: point(x, z),
  headingDeg,
  mounting,
  style,
  role,
  ...(approachIds ? { approachIds } : {}),
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

const londonNodes = {
  queenGateSouth: node("london-node-queen-gate-south", -108, -104),
  quietWestSouth: node("london-node-quiet-west-south", -164, -104),
  quietWestNorth: node("london-node-quiet-west-north", -164, -32),
  queenGateCromwell: node("london-node-queen-gate-cromwell", -108, -32),
  queenGateThurloe: node("london-node-queen-gate-thurloe", -108, 82),
  exhibitionCromwell: node("london-node-exhibition-cromwell", 42, -32),
  exhibitionMid: node("london-node-exhibition-mid", 42, 25),
  exhibitionThurloe: node("london-node-exhibition-thurloe", 42, 82),
  cromwellEast: node("london-node-cromwell-east", 150, -32),
  thurloeEast: node("london-node-thurloe-east", 150, 82),
  // Enlargement: Cromwell Road continues east toward Brompton, Queen's Gate
  // continues north toward Kensington Gardens.
  cromwellFarEast: node("london-node-cromwell-far-east", 330, -32),
  queenGateFarNorth: node("london-node-queen-gate-far-north", -108, 220),
  // Big enlargement: Gloucester Road (west), Kensington Road (north).
  gloucesterSouth: node("london-node-gloucester-south", -300, -104),
  gloucesterCromwell: node("london-node-gloucester-cromwell", -300, -32),
  gloucesterKensington: node("london-node-gloucester-kensington", -300, 220),
  kensingtonExhibition: node("london-node-kensington-exhibition", 42, 220),
};

const londonLanes: readonly LaneSegment[] = [
  // A calm local loop west of Queen's Gate. It is used for the first lesson.
  laneTrue(
    "london-local-west",
    londonNodes.queenGateSouth,
    londonNodes.quietWestSouth,
    20,
    ["london-quiet-north"],
    "travel",
    [point(-136, -105.8)],
  ),
  laneTrue(
    "london-quiet-north",
    londonNodes.quietWestSouth,
    londonNodes.quietWestNorth,
    20,
    ["london-cromwell-local-east"],
    "travel",
    [point(-165.8, -68)],
  ),
  laneTrue(
    "london-cromwell-local-east",
    londonNodes.quietWestNorth,
    londonNodes.queenGateCromwell,
    20,
    ["london-queen-gate-south-2"],
    "travel",
    [point(-136, -30.2)],
  ),
  laneTrue(
    "london-local-east-opposite",
    londonNodes.quietWestSouth,
    londonNodes.queenGateSouth,
    20,
    ["london-queen-gate-north-1"],
    "travel",
    [point(-136, -102.2)],
    ["london-local-west"],
  ),
  laneTrue(
    "london-quiet-south-opposite",
    londonNodes.quietWestNorth,
    londonNodes.quietWestSouth,
    20,
    ["london-local-east-opposite"],
    "travel",
    [point(-162.2, -68)],
    ["london-quiet-north"],
  ),
  laneTrue(
    "london-cromwell-local-west-opposite",
    londonNodes.queenGateCromwell,
    londonNodes.quietWestNorth,
    20,
    ["london-quiet-south-opposite"],
    "travel",
    [point(-136, -33.8)],
    ["london-cromwell-local-east"],
  ),

  // Queen's Gate is modelled in both legal directions, with the left-hand
  // running position visible in each centreline's lateral offset.
  laneTrue(
    "london-queen-gate-north-1",
    londonNodes.queenGateSouth,
    londonNodes.queenGateCromwell,
    20,
    ["london-queen-gate-north-2", "london-cromwell-east-1", "london-cromwell-local-west-opposite"],
    "travel",
    [point(-109.7, -68)],
    ["london-queen-gate-south-2"],
  ),
  laneTrue(
    "london-queen-gate-north-2",
    londonNodes.queenGateCromwell,
    londonNodes.queenGateThurloe,
    20,
    ["london-queen-gate-south-1", "london-queen-gate-north-3"],
    "travel",
    [point(-109.7, 24), point(-109.7, 58)],
    ["london-queen-gate-south-1"],
  ),
  laneTrue(
    "london-queen-gate-south-1",
    londonNodes.queenGateThurloe,
    londonNodes.queenGateCromwell,
    20,
    ["london-queen-gate-south-2", "london-cromwell-east-1"],
    "travel",
    [point(-106.3, 58), point(-106.3, 24)],
    ["london-queen-gate-north-2"],
  ),
  laneTrue(
    "london-queen-gate-south-2",
    londonNodes.queenGateCromwell,
    londonNodes.queenGateSouth,
    20,
    ["london-local-west", "london-queen-gate-north-1"],
    "travel",
    [point(-106.3, -68)],
    ["london-queen-gate-north-1"],
  ),

  // Cromwell Road's eastbound general lane sits beside a signed, timed bus
  // lane. The restriction is active at the fixed Tuesday 08:30 lesson clock.
  laneTrue(
    "london-cromwell-east-1",
    londonNodes.queenGateCromwell,
    londonNodes.exhibitionCromwell,
    20,
    ["london-cromwell-east-2", "london-exhibition-shared-1"],
    "travel",
    [point(-66, -30.3), point(-14, -30.3)],
  ),
  {
    id: "london-cromwell-east-bus",
    roadId: "london-cromwell-west",
    widthM: 3.4,
    from: londonNodes.queenGateCromwell.id,
    to: londonNodes.exhibitionCromwell.id,
    centerline: [
      point(-108, -26.9),
      point(-66, -26.9),
      point(-14, -26.9),
      point(42, -26.9),
    ],
    role: "travel",
    trafficSide: "left",
    speedLimit: 20,
    successors: [],
  },
  laneTrue(
    "london-cromwell-east-2",
    londonNodes.exhibitionCromwell,
    londonNodes.cromwellEast,
    20,
    ["london-east-north", "london-cromwell-east-3"],
    "travel",
    [point(82, -30.3), point(118, -30.3)],
    ["london-cromwell-west-1"],
  ),
  laneTrue(
    "london-cromwell-west-1",
    londonNodes.cromwellEast,
    londonNodes.exhibitionCromwell,
    20,
    ["london-cromwell-west-2", "london-exhibition-shared-1"],
    "travel",
    [point(118, -33.7), point(82, -33.7)],
    ["london-cromwell-east-2"],
  ),
  laneTrue(
    "london-cromwell-west-2",
    londonNodes.exhibitionCromwell,
    londonNodes.queenGateCromwell,
    20,
    ["london-queen-gate-south-2", "london-queen-gate-north-2", "london-cromwell-fw-w"],
    "travel",
    [point(-14, -33.7), point(-66, -33.7)],
    ["london-cromwell-east-1"],
  ),

  // The eastern and northern streets close the busier museum-quarter loop.
  laneTrue(
    "london-east-north",
    londonNodes.cromwellEast,
    londonNodes.thurloeEast,
    20,
    ["london-thurloe-west-1"],
    "travel",
    [point(148.2, 18), point(148.2, 54)],
  ),
  laneTrue(
    "london-thurloe-west-1",
    londonNodes.thurloeEast,
    londonNodes.exhibitionThurloe,
    20,
    ["london-thurloe-west-2", "london-exhibition-north-n"],
    "one_way",
    [point(100, 80.2)],
  ),
  laneTrue(
    "london-thurloe-west-2",
    londonNodes.exhibitionThurloe,
    londonNodes.queenGateThurloe,
    20,
    ["london-queen-gate-south-1"],
    "one_way",
    [point(-24, 80.2), point(-68, 80.2)],
  ),

  // The northern portion of Exhibition Road is a deliberately slow, one-way
  // shared-space exercise with dense pedestrian and cyclist activity.
  laneTrue(
    "london-exhibition-shared-1",
    londonNodes.exhibitionCromwell,
    londonNodes.exhibitionMid,
    20,
    ["london-exhibition-shared-2"],
    "one_way",
    [point(40.3, -4)],
  ),
  laneTrue(
    "london-exhibition-shared-2",
    londonNodes.exhibitionMid,
    londonNodes.exhibitionThurloe,
    20,
    ["london-thurloe-west-2"],
    "one_way",
    [point(40.3, 54)],
  ),

  // Cromwell Road extended east toward Brompton (two-way).
  laneTrue(
    "london-cromwell-east-3",
    londonNodes.cromwellEast,
    londonNodes.cromwellFarEast,
    20,
    [],
    "travel",
    [point(240, -30.3)],
    ["london-cromwell-west-0"],
    "london-cromwell-east",
  ),
  laneTrue(
    "london-cromwell-west-0",
    londonNodes.cromwellFarEast,
    londonNodes.cromwellEast,
    20,
    ["london-cromwell-west-1"],
    "travel",
    [point(240, -33.7)],
    ["london-cromwell-east-3"],
    "london-cromwell-east",
  ),
  // Queen's Gate extended north toward Kensington Gardens (two-way).
  laneTrue(
    "london-queen-gate-north-3",
    londonNodes.queenGateThurloe,
    londonNodes.queenGateFarNorth,
    20,
    ["london-kensington-e-2", "london-kensington-w-2"],
    "travel",
    [point(-109.7, 150)],
    ["london-queen-gate-south-0"],
    "london-queen-gate",
  ),
  laneTrue(
    "london-queen-gate-south-0",
    londonNodes.queenGateFarNorth,
    londonNodes.queenGateThurloe,
    20,
    ["london-queen-gate-south-1"],
    "travel",
    [point(-106.3, 150)],
    ["london-queen-gate-north-3"],
    "london-queen-gate",
  ),

  // Cromwell Road extended west to Gloucester Road (two-way).
  laneTrue("london-cromwell-fw-e", londonNodes.gloucesterCromwell, londonNodes.queenGateCromwell, 20, ["london-cromwell-east-1"], "travel", [point(-204, -30.3)], ["london-cromwell-fw-w"], "london-cromwell-far-west"),
  laneTrue("london-cromwell-fw-w", londonNodes.queenGateCromwell, londonNodes.gloucesterCromwell, 20, ["london-gloucester-n-2", "london-gloucester-s-2"], "travel", [point(-204, -33.7)], ["london-cromwell-fw-e"], "london-cromwell-far-west"),
  // Gloucester Road (two-way, x=-300).
  laneTrue("london-gloucester-n-1", londonNodes.gloucesterSouth, londonNodes.gloucesterCromwell, 20, ["london-gloucester-n-2", "london-cromwell-fw-e"], "travel", [point(-301.7, -68)], ["london-gloucester-s-2"], "london-gloucester"),
  laneTrue("london-gloucester-n-2", londonNodes.gloucesterCromwell, londonNodes.gloucesterKensington, 20, ["london-kensington-e-1"], "travel", [point(-301.7, 94)], ["london-gloucester-s-1"], "london-gloucester"),
  laneTrue("london-gloucester-s-1", londonNodes.gloucesterKensington, londonNodes.gloucesterCromwell, 20, ["london-gloucester-s-2", "london-cromwell-fw-e"], "travel", [point(-298.3, 94)], ["london-gloucester-n-2"], "london-gloucester"),
  laneTrue("london-gloucester-s-2", londonNodes.gloucesterCromwell, londonNodes.gloucesterSouth, 20, [], "travel", [point(-298.3, -68)], ["london-gloucester-n-1"], "london-gloucester"),
  // Kensington Road (two-way, z=220): Gloucester <-> Queen's Gate <-> Exhibition.
  laneTrue("london-kensington-e-1", londonNodes.gloucesterKensington, londonNodes.queenGateFarNorth, 20, ["london-kensington-e-2", "london-queen-gate-south-0"], "travel", [point(-204, 221.7)], ["london-kensington-w-2"], "london-kensington"),
  laneTrue("london-kensington-e-2", londonNodes.queenGateFarNorth, londonNodes.kensingtonExhibition, 20, ["london-exhibition-north-s"], "travel", [point(-33, 221.7)], ["london-kensington-w-1"], "london-kensington"),
  laneTrue("london-kensington-w-1", londonNodes.kensingtonExhibition, londonNodes.queenGateFarNorth, 20, ["london-kensington-w-2", "london-queen-gate-south-0"], "travel", [point(-33, 218.3)], ["london-kensington-e-2"], "london-kensington"),
  laneTrue("london-kensington-w-2", londonNodes.queenGateFarNorth, londonNodes.gloucesterKensington, 20, ["london-gloucester-s-1"], "travel", [point(-204, 218.3)], ["london-kensington-e-1"], "london-kensington"),
  // Exhibition Road extended north to Kensington Road (two-way).
  laneTrue("london-exhibition-north-n", londonNodes.exhibitionThurloe, londonNodes.kensingtonExhibition, 20, ["london-kensington-w-1"], "travel", [point(40.3, 150)], ["london-exhibition-north-s"], "london-exhibition-north"),
  laneTrue("london-exhibition-north-s", londonNodes.kensingtonExhibition, londonNodes.exhibitionThurloe, 20, ["london-thurloe-west-2"], "travel", [point(43.7, 150)], ["london-exhibition-north-n"], "london-exhibition-north"),
];

const londonLaneGraph: LaneGraph = {
  nodes: Object.values(londonNodes),
  lanes: londonLanes,
  controls: [
    control(
      "london-crosswalk-quiet",
      "crosswalk",
      -164,
      -68,
      0,
      ["london-quiet-north"],
      undefined,
      [approach("london-quiet-crosswalk-approach", "london-quiet-north", 28, "crosswalk")],
      [installation("london-quiet-crosswalk-marking", -164, -68, 0, "road_marking", "crosswalk", "marking")],
    ),
    control(
      "london-signal-queen-gate-cromwell",
      "signal",
      -108,
      -32,
      90,
      [
        "london-queen-gate-north-1",
        "london-queen-gate-south-1",
        "london-cromwell-east-1",
        "london-cromwell-west-2",
      ],
      ["london-queen-gate-cromwell-conflict"],
      [
        approach("london-queen-gate-north-approach", "london-queen-gate-north-1", 62, "queen-gate", ["london-queen-gate-cromwell-conflict"]),
        approach("london-queen-gate-south-approach", "london-queen-gate-south-1", 104, "queen-gate", ["london-queen-gate-cromwell-conflict"]),
        approach("london-cromwell-west-approach", "london-cromwell-west-2", 140, "cromwell", ["london-queen-gate-cromwell-conflict"]),
      ],
      [
        installation("london-queen-gate-primary", -116, -43, 0, "roadside_pole", "uk_signal", "primary", ["london-queen-gate-north-approach"]),
        installation("london-queen-gate-secondary", -98, -21, 180, "secondary_pole", "uk_signal", "secondary", ["london-queen-gate-south-approach"]),
        installation("london-cromwell-west-primary", -97, -43, 270, "roadside_pole", "uk_signal", "primary", ["london-cromwell-west-approach"]),
        installation("london-cromwell-west-secondary", -119, -21, 270, "secondary_pole", "uk_signal", "secondary", ["london-cromwell-west-approach"]),
      ],
    ),
    control(
      "london-signal-cromwell-exhibition",
      "signal",
      42,
      -32,
      90,
      [
        "london-cromwell-east-1",
        "london-cromwell-east-bus",
        "london-cromwell-west-1",
        "london-exhibition-shared-1",
      ],
      ["london-cromwell-exhibition-conflict"],
      [
        approach("london-cromwell-east-general-approach", "london-cromwell-east-1", 140, "cromwell-east", ["london-cromwell-exhibition-conflict"]),
        approach("london-cromwell-east-bus-approach", "london-cromwell-east-bus", 140, "cromwell-east", ["london-cromwell-exhibition-conflict"]),
        approach("london-cromwell-westbound-approach", "london-cromwell-west-1", 98, "cromwell-west", ["london-cromwell-exhibition-conflict"]),
      ],
      [
        installation("london-exhibition-primary", 31, -43, 90, "roadside_pole", "uk_signal", "primary", ["london-cromwell-east-general-approach", "london-cromwell-east-bus-approach"]),
        installation("london-exhibition-secondary", 53, -21, 270, "secondary_pole", "uk_signal", "secondary", ["london-cromwell-westbound-approach"]),
      ],
    ),
    control(
      "london-box-cromwell-exhibition",
      "box_junction",
      42,
      -32,
      90,
      [
        "london-cromwell-east-1",
        "london-cromwell-east-bus",
        "london-cromwell-west-1",
        "london-exhibition-shared-1",
      ],
      ["london-cromwell-exhibition-conflict"],
      [],
      [installation("london-box-marking", 42, -32, 90, "road_marking", "box_junction", "marking")],
    ),
    control(
      "london-cromwell-bus-lane-sign",
      "restricted_lane",
      -64,
      -27,
      90,
      ["london-cromwell-east-bus"],
      undefined,
      [approach("london-bus-lane-sign-approach", "london-cromwell-east-bus", 34, "restriction")],
      [installation("london-bus-lane-roadside-sign", -64, -19, 90, "roadside_pole", "restricted_lane", "warning")],
    ),
    control(
      "london-crosswalk-museum",
      "crosswalk",
      42,
      20,
      0,
      ["london-exhibition-shared-1"],
      undefined,
      [approach("london-museum-crosswalk-approach", "london-exhibition-shared-1", 48, "crosswalk")],
      [installation("london-museum-crosswalk-marking", 42, 20, 0, "road_marking", "crosswalk", "marking")],
    ),
    control(
      "london-crosswalk-thurloe",
      "crosswalk",
      42,
      76,
      270,
      [
        "london-thurloe-west-1",
        "london-thurloe-west-2",
        "london-exhibition-shared-2",
      ],
      undefined,
      [
        approach("london-thurloe-crosswalk-approach", "london-thurloe-west-1", 99, "crosswalk"),
        approach("london-exhibition-crosswalk-approach", "london-exhibition-shared-2", 50, "crosswalk"),
      ],
      [installation("london-thurloe-crosswalk-marking", 42, 76, 270, "road_marking", "crosswalk", "marking")],
    ),
  ],
  conflictZones: connectorConflictZones(londonLanes, [
    {
      id: "london-queen-gate-cromwell-conflict",
      laneIds: [
        "london-queen-gate-north-1",
        "london-queen-gate-south-1",
        "london-cromwell-east-1",
        "london-cromwell-west-2",
      ],
      polygon: [
        point(-119, -43),
        point(-97, -43),
        point(-97, -21),
        point(-119, -21),
      ],
    },
    {
      id: "london-cromwell-exhibition-conflict",
      laneIds: [
        "london-cromwell-east-1",
        "london-cromwell-east-bus",
        "london-cromwell-west-1",
        "london-exhibition-shared-1",
      ],
      polygon: [
        point(37, -36),
        point(47, -36),
        point(47, -25),
        point(37, -25),
      ],
    },
  ]),
  restrictions: [
    {
      id: "london-cromwell-bus-lane-weekday",
      laneId: "london-cromwell-east-bus",
      ruleCode: "restricted_lane",
      activeWindows: [
        {
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startMinutes: 7 * 60,
          endMinutes: 19 * 60,
        },
      ],
      sourceReferenceId: "uk-london-highway-code-general",
      message:
        "The signed bus lane operates 07:00–19:00 Monday to Friday in this training scenario. At Tuesday 08:30, use the adjacent general lane.",
    },
  ],
  spawnPoints: [
    anchoredSpawn(
      "london-player",
      "player",
      "london-local-west",
      LONDON_QUIET_START_DISTANCE_M,
    ),
    anchoredSpawn(
      "london-player-queen-gate",
      "player",
      "london-queen-gate-north-1",
      LONDON_QUEEN_GATE_START_DISTANCE_M,
    ),
    anchoredSpawn("london-car-queen-gate", "vehicle", "london-queen-gate-north-1", 34),
    anchoredSpawn("london-black-cab", "vehicle", "london-thurloe-west-1", 38),
    anchoredSpawn("london-red-bus", "vehicle", "london-cromwell-east-bus", 68),
    anchoredSpawn("london-car-cromwell", "vehicle", "london-cromwell-east-2", 50),
    anchoredSpawn("london-car-brompton", "vehicle", "london-cromwell-east-3", 90),
    anchoredSpawn("london-cab-kensington", "vehicle", "london-queen-gate-north-3", 70),
    anchoredSpawn("london-car-gloucester", "vehicle", "london-gloucester-n-1", 40),
    anchoredSpawn("london-bus-kensington", "vehicle", "london-kensington-e-1", 90),
    freeSpawn("london-ped-gloucester", "pedestrian", -292, -68, 0),
    freeSpawn("london-ped-brompton", "pedestrian", 300, -22, 90),
    freeSpawn("london-ped-kensington", "pedestrian", -98, 150, 180),
    freeSpawn("london-ped-quiet", "pedestrian", -158, -67, 90),
    freeSpawn("london-ped-museum-1", "pedestrian", 34, 19, 90),
    freeSpawn("london-ped-museum-2", "pedestrian", 50, 77, 270),
    freeSpawn(
      "london-cyclist-exhibition",
      "cyclist",
      39,
      14,
      0,
      "london-exhibition-shared-1",
    ),
    freeSpawn(
      "london-cyclist-cromwell",
      "cyclist",
      78,
      -29,
      90,
      "london-cromwell-east-2",
    ),
  ],
  checkpoints: [
    checkpoint(
      "london-quiet-start",
      "Queen's Gate start",
      "london-local-west",
      LONDON_QUIET_START_DISTANCE_M,
    ),
    checkpoint("london-quiet-crosswalk", "Quiet-street crossing", "london-quiet-north", 36),
    checkpoint("london-cromwell-signal", "Cromwell Road signal approach", "london-cromwell-east-1", 136),
    checkpoint("london-box-junction", "Box-junction approach", "london-cromwell-east-1", 125),
    checkpoint("london-bus-lane", "Signed bus-lane approach", "london-cromwell-east-1", 44),
    checkpoint("london-shared-space", "Exhibition Road shared space", "london-exhibition-shared-1", 48),
    checkpoint("london-exhibition-one-way", "Signed one-way training section", "london-exhibition-shared-2", 27),
    checkpoint("london-finish", "Queen's Gate return", "london-queen-gate-south-2", 50),
  ],
};

export const LONDON_MAP_PACK: MapPack = {
  id: "london-south-kensington",
  name: "London — South Kensington Museum Quarter",
  areaLabel:
    "Queen's Gate, Cromwell Road, Exhibition Road and Thurloe Place",
  countryIds: ["uk"],
  source: {
    boundingBox: {
      south: 51.4938,
      west: -0.1818,
      north: 51.5006,
      east: -0.1698,
    },
    capturedOn: LONDON_CONTENT_REVIEWED_ON,
    sourceUrl:
      "https://api.openstreetmap.org/api/0.6/map?bbox=-0.1818,51.4938,-0.1698,51.5006",
    checksum:
      "a155a4d96e0318822c28c7da0627bde2f88a628ff0bebe1b93209f29fedf1d64",
    importerVersion: "sideswap-osm-compact@2",
    attribution: "© OpenStreetMap contributors",
    licenseName: "Open Data Commons Open Database License 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  },
  geometry: {
    worldSize: point(800, 540),
    roadWidth: 10,
    shoulderWidth: 1.5,
    roadSurfaces: [
      roadSurface("london-quiet-loop", [londonNodes.queenGateSouth.position, londonNodes.quietWestSouth.position, londonNodes.quietWestNorth.position, londonNodes.queenGateCromwell.position], 7.2, ["london-local-west", "london-quiet-north", "london-cromwell-local-east", "london-local-east-opposite", "london-quiet-south-opposite", "london-cromwell-local-west-opposite"], "standard", [
        roadMarking("london-quiet-centre", "centre_dashed", [londonNodes.queenGateSouth.position, londonNodes.quietWestSouth.position, londonNodes.quietWestNorth.position, londonNodes.queenGateCromwell.position], "white"),
      ]),
      roadSurface("london-queen-gate", [londonNodes.queenGateSouth.position, londonNodes.queenGateCromwell.position, londonNodes.queenGateThurloe.position, londonNodes.queenGateFarNorth.position], 7.6, ["london-queen-gate-north-1", "london-queen-gate-north-2", "london-queen-gate-north-3", "london-queen-gate-south-1", "london-queen-gate-south-2", "london-queen-gate-south-0"], "standard", [
        roadMarking("london-queen-gate-centre", "centre_dashed", [londonNodes.queenGateSouth.position, londonNodes.queenGateFarNorth.position], "white"),
      ]),
      roadSurface("london-cromwell-west", [point(-108, -30.3), point(42, -30.3)], 11.4, ["london-cromwell-east-1", "london-cromwell-east-bus", "london-cromwell-west-2"], "standard", [
        roadMarking("london-cromwell-bus-divider", "lane_solid", [point(-108, -28.6), point(42, -28.6)], "white"),
        roadMarking("london-cromwell-centre-west", "centre_dashed", [point(-108, -32), point(42, -32)], "white"),
        roadMarking("london-cromwell-box", "box_junction", [point(37, -36), point(47, -36), point(47, -25), point(37, -25), point(37, -36)], "yellow"),
      ]),
      roadSurface("london-cromwell-east", [londonNodes.exhibitionCromwell.position, londonNodes.cromwellEast.position, londonNodes.cromwellFarEast.position], 7.6, ["london-cromwell-east-2", "london-cromwell-west-1", "london-cromwell-east-3", "london-cromwell-west-0"], "standard", [roadMarking("london-cromwell-centre-east", "centre_dashed", [londonNodes.exhibitionCromwell.position, londonNodes.cromwellFarEast.position], "white")]),
      roadSurface("london-east-road", [londonNodes.cromwellEast.position, londonNodes.thurloeEast.position], 7.2, ["london-east-north"]),
      roadSurface("london-thurloe-place", [londonNodes.thurloeEast.position, londonNodes.exhibitionThurloe.position, londonNodes.queenGateThurloe.position], 7.2, ["london-thurloe-west-1", "london-thurloe-west-2"]),
      roadSurface("london-exhibition-road", [londonNodes.exhibitionCromwell.position, londonNodes.exhibitionMid.position, londonNodes.exhibitionThurloe.position], 7, ["london-exhibition-shared-1", "london-exhibition-shared-2"], "shared_space"),
      roadSurface("london-cromwell-far-west", [londonNodes.queenGateCromwell.position, londonNodes.gloucesterCromwell.position], 7.2, ["london-cromwell-fw-e", "london-cromwell-fw-w"], "standard", [
        roadMarking("london-cromwell-far-west-centre", "centre_dashed", [londonNodes.queenGateCromwell.position, londonNodes.gloucesterCromwell.position], "white"),
      ]),
      roadSurface("london-gloucester", [londonNodes.gloucesterSouth.position, londonNodes.gloucesterCromwell.position, londonNodes.gloucesterKensington.position], 7.2, ["london-gloucester-n-1", "london-gloucester-n-2", "london-gloucester-s-1", "london-gloucester-s-2"], "standard", [
        roadMarking("london-gloucester-centre", "centre_dashed", [londonNodes.gloucesterSouth.position, londonNodes.gloucesterKensington.position], "white"),
      ]),
      roadSurface("london-kensington", [londonNodes.gloucesterKensington.position, londonNodes.queenGateFarNorth.position, londonNodes.kensingtonExhibition.position], 7.2, ["london-kensington-e-1", "london-kensington-e-2", "london-kensington-w-1", "london-kensington-w-2"], "standard", [
        roadMarking("london-kensington-centre", "centre_dashed", [londonNodes.gloucesterKensington.position, londonNodes.kensingtonExhibition.position], "white"),
      ]),
      roadSurface("london-exhibition-north", [londonNodes.exhibitionThurloe.position, londonNodes.kensingtonExhibition.position], 7.2, ["london-exhibition-north-n", "london-exhibition-north-s"], "standard", [
        roadMarking("london-exhibition-north-centre", "centre_dashed", [londonNodes.exhibitionThurloe.position, londonNodes.kensingtonExhibition.position], "white"),
      ]),
    ],
    blocks: [
      {
        id: "london-natural-history-museum-block",
        center: point(-26, -76),
        size: point(118, 46),
        heightRange: [18, 34],
        density: 0.82,
        material: "terracotta-museum",
      },
      {
        id: "london-science-museum-block",
        center: point(-24, 30),
        size: point(116, 64),
        heightRange: [15, 29],
        density: 0.76,
        material: "pale-stone-museum",
      },
      {
        id: "london-v-and-a-block",
        center: point(98, 28),
        size: point(82, 64),
        heightRange: [17, 31],
        density: 0.8,
        material: "red-brick-museum",
      },
      {
        id: "london-queen-gate-terraces",
        center: point(-136, 28),
        size: point(42, 84),
        heightRange: [12, 24],
        density: 0.72,
        material: "white-stucco",
      },
      {
        id: "london-cromwell-terraces",
        center: point(102, -76),
        size: point(82, 46),
        heightRange: [10, 22],
        density: 0.68,
        material: "london-brick",
      },
    ],
    landmarks: [
      {
        id: "london-natural-history-museum",
        kind: "shops",
        center: point(-25, -75),
        size: point(72, 30),
        color: "#b46b4f",
      },
      {
        id: "london-natural-history-tower",
        kind: "tower",
        center: point(-24, -61),
        size: point(16, 16),
        color: "#855443",
      },
      {
        id: "london-science-museum",
        kind: "shops",
        center: point(-24, 30),
        size: point(66, 26),
        color: "#d4d0c5",
      },
      {
        id: "london-victoria-and-albert-museum",
        kind: "shops",
        center: point(96, 28),
        size: point(54, 30),
        color: "#9d5b4a",
      },
      {
        id: "london-south-kensington-station",
        kind: "station",
        center: point(132, 96),
        size: point(18, 10),
        color: "#b9303f",
      },
      {
        id: "london-exhibition-road-public-space",
        kind: "park",
        // Public-space planting belongs beside Exhibition Road; rendering it
        // over the shared carriageway made the road appear to be missing.
        center: point(50, 30),
        size: point(8, 40),
        color: "#708c66",
      },
    ],
  },
  laneGraph: londonLaneGraph,
};

export const LONDON_LESSONS: readonly LessonDefinition[] = [
  {
    id: "uk-london-left-side-basics",
    kind: "guided",
    title: "Left in London",
    summary:
      "Build calm left-side positioning on quieter museum streets before joining the busier roads.",
    mapId: "london-south-kensington",
    countryId: "uk",
    destinationId: "uk-london",
    trafficSide: "left",
    difficulty: 1,
    estimatedMinutes: [5, 7],
    startSpawnId: "london-player",
    route: [
      "london-local-west",
      "london-quiet-north",
      "london-cromwell-local-east",
      "london-queen-gate-south-2",
    ],
    objectives: [
      {
        id: "london-left-position",
        label: "Settle onto the left after each turn",
        ruleCode: "wrong_way",
      },
      {
        id: "london-twenty",
        label: "Keep to the signed 20 mph limit",
        ruleCode: "speeding",
      },
      {
        id: "london-parked-clearance",
        label: "Scan ahead and leave safe clearance from parked vehicles",
        ruleCode: "observation",
      },
      {
        id: "london-quiet-pedestrian",
        label: "Give priority at the pedestrian crossing",
        ruleCode: "pedestrian_priority",
      },
    ],
    trafficSeed: 1251,
    trafficDensity: "moderate",
    vulnerableRoadUsers: { pedestrians: 6, cyclists: 2 },
    checkpoints: [
      "london-quiet-start",
      "london-quiet-crosswalk",
      "london-finish",
    ],
    coachPrompts: [
      prompt(
        "london-charges-note",
        { type: "start" },
        "Before a real London trip, check current TfL driving-charge guidance. Charges are not scored in SideSwap.",
        "uk-london-tfl-driving-charges",
      ),
      prompt(
        "london-left-start",
        { type: "route_progress", value: 0.03 },
        "Keep the centre line on your right and finish every turn in the left-side running position.",
        "uk-london-highway-code-road",
      ),
      prompt(
        "london-quiet-crossing",
        { type: "checkpoint", checkpointId: "london-quiet-crosswalk" },
        "Ease off early, scan both pavements and wait for people using the crossing.",
        "uk-london-road-user-hierarchy",
      ),
      prompt(
        "london-parked-cars",
        { type: "route_progress", value: 0.58 },
        "Leave room for an opening door and be ready to wait when the available gap is narrow.",
        "uk-london-highway-code-general",
      ),
    ],
    assessedRules: [
      "wrong_way",
      "speeding",
      "missing_indicator",
      "pedestrian_priority",
      "observation",
    ],
    sourceReferenceIds: [
      "uk-london-highway-code-general",
      "uk-london-highway-code-road",
      "uk-london-road-user-hierarchy",
      "uk-london-rbkc-20mph",
      "uk-london-tfl-20mph-order",
      "uk-london-tfl-driving-charges",
    ],
    prerequisites: ["orientation-left"],
    unlocks: {
      lessonIds: ["uk-london-museum-traffic"],
      freeDriveIds: ["free-uk-london"],
    },
    scenarioClock: LONDON_SCENARIO_CLOCK,
  },
  {
    id: "uk-london-museum-traffic",
    kind: "guided",
    title: "People, Buses & Cycles",
    summary:
      "Read Cromwell Road signals, keep a yellow box clear and practise interpreting a signed restricted lane.",
    mapId: "london-south-kensington",
    countryId: "uk",
    destinationId: "uk-london",
    trafficSide: "left",
    difficulty: 2,
    estimatedMinutes: [6, 8],
    startSpawnId: "london-player-queen-gate",
    route: [
      "london-queen-gate-north-1",
      "london-cromwell-east-1",
      "london-cromwell-east-2",
      "london-east-north",
      "london-thurloe-west-1",
      "london-thurloe-west-2",
      "london-queen-gate-south-1",
      "london-queen-gate-south-2",
    ],
    objectives: [
      {
        id: "london-signal",
        label: "Stop before a red-light conflict zone",
        ruleCode: "red_light",
      },
      {
        id: "london-box-clear",
        label: "Enter the yellow box only when the exit is clear",
        ruleCode: "box_junction",
      },
      {
        id: "london-restricted-lane",
        label: "Stay out of the active signed bus lane",
        ruleCode: "restricted_lane",
      },
      {
        id: "london-cycle-space",
        label: "Give cyclists and pedestrians safe priority",
        ruleCode: "cyclist_clearance",
      },
    ],
    trafficSeed: 1252,
    trafficDensity: "busy",
    vulnerableRoadUsers: { pedestrians: 12, cyclists: 5 },
    checkpoints: [
      "london-bus-lane",
      "london-box-junction",
      "london-cromwell-signal",
      "london-finish",
    ],
    coachPrompts: [
      prompt(
        "london-museum-start",
        { type: "start" },
        "This training miniature uses a simplified Tuesday 08:30 restriction. Use the adjacent general lane now; on a real trip, always follow the exact times on the roadside sign.",
        "uk-london-highway-code-general",
      ),
      prompt(
        "london-box-coach",
        { type: "checkpoint", checkpointId: "london-box-junction" },
        "Wait before the yellow box unless there is enough space beyond it for your whole vehicle.",
        "uk-london-highway-code-road",
      ),
      prompt(
        "london-restricted-coach",
        { type: "rule_event", ruleCode: "restricted_lane" },
        "This lane is restricted at the displayed time. Check the sign and move to the permitted general lane when safe.",
        "uk-london-highway-code-general",
      ),
      prompt(
        "london-cycle-coach",
        { type: "route_progress", value: 0.62 },
        "Expect cyclists beside the bus and scan the crossing before turning through the museum area.",
        "uk-london-road-user-hierarchy",
      ),
    ],
    assessedRules: [
      "red_light",
      "box_junction",
      "restricted_lane",
      "pedestrian_priority",
      "cyclist_clearance",
      "following_distance",
    ],
    sourceReferenceIds: [
      "uk-london-highway-code-general",
      "uk-london-highway-code-road",
      "uk-london-road-user-hierarchy",
    ],
    prerequisites: ["uk-london-left-side-basics"],
    unlocks: {
      lessonIds: ["uk-london-exhibition-road"],
      freeDriveIds: [],
    },
    scenarioClock: LONDON_SCENARIO_CLOCK,
  },
  {
    id: "uk-london-exhibition-road",
    kind: "guided",
    title: "Exhibition Road Awareness",
    summary:
      "Follow the miniature's signed one-way route through a shared space and make every movement around vulnerable road users deliberate.",
    mapId: "london-south-kensington",
    countryId: "uk",
    destinationId: "uk-london",
    trafficSide: "left",
    difficulty: 3,
    estimatedMinutes: [6, 8],
    startSpawnId: "london-player-queen-gate",
    route: [
      "london-queen-gate-north-1",
      "london-cromwell-east-1",
      "london-exhibition-shared-1",
      "london-exhibition-shared-2",
      "london-thurloe-west-2",
      "london-queen-gate-south-1",
      "london-queen-gate-south-2",
    ],
    objectives: [
      {
        id: "london-one-way",
        label: "Follow the one-way direction",
        ruleCode: "one_way",
      },
      {
        id: "london-shared-scan",
        label: "Scan continuously through the shared space",
        ruleCode: "observation",
      },
      {
        id: "london-shared-priority",
        label: "Give pedestrians and cyclists enough time and space",
        ruleCode: "pedestrian_priority",
      },
      {
        id: "london-safe-turn",
        label: "Signal and wait for a safe turning gap",
        ruleCode: "unsafe_gap",
      },
    ],
    trafficSeed: 1253,
    trafficDensity: "busy",
    vulnerableRoadUsers: { pedestrians: 16, cyclists: 6 },
    checkpoints: [
      "london-cromwell-signal",
      "london-shared-space",
      "london-exhibition-one-way",
      "london-finish",
    ],
    coachPrompts: [
      prompt(
        "london-shared-start",
        { type: "start" },
        "In this training miniature, the one-way arrow sets the legal direction; the shared surface still requires walking-speed judgement around people.",
        "uk-london-highway-code-road",
      ),
      prompt(
        "london-shared-coach",
        { type: "checkpoint", checkpointId: "london-shared-space" },
        "Search from building line to building line. People may change direction without following a marked crossing.",
        "uk-london-road-user-hierarchy",
      ),
      prompt(
        "london-one-way-coach",
        {
          type: "checkpoint",
          checkpointId: "london-exhibition-one-way",
        },
        "Continue only with the one-way arrow; never improvise an opposing lane because the street looks open.",
        "uk-london-highway-code-road",
      ),
      prompt(
        "london-safe-turn-coach",
        { type: "route_progress", value: 0.72 },
        "Mirror, signal, check beside the car and turn only after the pedestrian and cyclist path is clear.",
        "uk-london-highway-code-general",
      ),
    ],
    assessedRules: [
      "one_way",
      "pedestrian_priority",
      "cyclist_clearance",
      "missing_indicator",
      "observation",
      "unsafe_gap",
    ],
    sourceReferenceIds: [
      "uk-london-highway-code-general",
      "uk-london-highway-code-road",
      "uk-london-road-user-hierarchy",
    ],
    prerequisites: ["uk-london-museum-traffic"],
    unlocks: {
      lessonIds: ["uk-fr-side-swap"],
      freeDriveIds: [],
    },
    scenarioClock: LONDON_SCENARIO_CLOCK,
  },
];

export const LONDON_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-uk-london",
  countryId: "uk",
  destinationId: "uk-london",
  mapId: "london-south-kensington",
  title: "Free Drive — London",
  description:
    "Explore South Kensington's museum streets with optional coaching, a fixed Tuesday morning clock and no prescribed route.",
  unlockAfter: "uk-london-left-side-basics",
  startSpawnId: "london-player",
  trafficSeed: 2251,
  scenarioClock: LONDON_SCENARIO_CLOCK,
};
