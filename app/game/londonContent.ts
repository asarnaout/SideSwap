import type {
  FreeDriveDefinition,
  LaneAnchor,
  LaneGraph,
  LaneNode,
  LaneRole,
  LaneSegment,
  MapCheckpoint,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  ProceduralLandmark,
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

/**
 * Points along a circular arc, inclusive of both endpoints. Angles in degrees,
 * 0deg = +x (east), 90deg = +z (north); a1 < a0 traces the arc clockwise.
 */
const arcPoints = (
  center: WorldPoint,
  radius: number,
  a0Deg: number,
  a1Deg: number,
  steps = 6,
): WorldPoint[] => {
  const points: WorldPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = ((a0Deg + ((a1Deg - a0Deg) * index) / steps) * Math.PI) / 180;
    points.push(
      point(center.x + radius * Math.cos(angle), center.z + radius * Math.sin(angle)),
    );
  }
  return points;
};

/**
 * Turns a dead-end stub into a single-arm turning loop: a one-way ring around a
 * small central island bulging out from the stub's end node, so cars drive out,
 * loop once and return instead of hitting a flat dead-end. London traffic is
 * left-side, so the ring circulates clockwise; it needs no give-way (a single
 * arm has no conflicting traffic) and runs purely on `successors`. The caller
 * keeps the dead node as the connection point, repoints the ARRIVING lane's
 * successor to `${prefix}-a`, and the returning arc `${prefix}-b` feeds
 * `departLaneId` back into the network.
 */
const turningLoop = (opts: {
  prefix: string;
  connectNode: LaneNode;
  bulgeDeg: number;
  radius: number;
  speed: number;
  departLaneId: string;
  color: string;
  islandRadius?: number;
  widthM?: number;
}): {
  farNode: LaneNode;
  firstArcId: string;
  lanes: readonly LaneSegment[];
  surface: RoadSurface;
  island: ProceduralLandmark;
} => {
  const {
    prefix,
    connectNode,
    bulgeDeg,
    radius,
    speed,
    departLaneId,
    color,
    islandRadius = Math.max(4, radius - 6),
    widthM = 7.2,
  } = opts;
  const bulge = {
    x: Math.cos((bulgeDeg * Math.PI) / 180),
    z: Math.sin((bulgeDeg * Math.PI) / 180),
  };
  const connect = connectNode.position;
  const center = point(connect.x + bulge.x * radius, connect.z + bulge.z * radius);
  const farNode = node(
    `${prefix}-far`,
    connect.x + bulge.x * radius * 2,
    connect.z + bulge.z * radius * 2,
  );
  const connectAngle = bulgeDeg + 180;
  // Clockwise circulation for left-side traffic (decreasing angle).
  const arcA = arcPoints(center, radius, connectAngle, connectAngle - 180);
  const arcB = arcPoints(center, radius, connectAngle - 180, connectAngle - 360);
  const firstArcId = `${prefix}-a`;
  const secondArcId = `${prefix}-b`;
  const arcLane = (
    id: string,
    from: LaneNode,
    to: LaneNode,
    successors: readonly string[],
    via: readonly WorldPoint[],
  ): LaneSegment => ({
    id,
    roadId: prefix,
    widthM: 3.2,
    from: from.id,
    to: to.id,
    centerline: [from.position, ...via, to.position],
    role: "roundabout",
    trafficSide: "left",
    speedLimit: speed,
    successors,
  });
  return {
    farNode,
    firstArcId,
    lanes: [
      arcLane(firstArcId, connectNode, farNode, [secondArcId], arcA.slice(1, -1)),
      arcLane(secondArcId, farNode, connectNode, [departLaneId], arcB.slice(1, -1)),
    ],
    surface: roadSurface(prefix, [...arcA, ...arcB.slice(1)], widthM, [firstArcId, secondArcId], "roundabout"),
    island: {
      id: `${prefix}-green`,
      kind: "park",
      center,
      size: point(islandRadius * 2, islandRadius * 2),
      color,
    },
  };
};

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
    ["london-brompton-loop-a"],
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
  laneTrue("london-gloucester-s-2", londonNodes.gloucesterCromwell, londonNodes.gloucesterSouth, 20, ["london-gloucester-loop-a"], "travel", [point(-298.3, -68)], ["london-gloucester-n-1"], "london-gloucester"),
  // Kensington Road (two-way, z=220): Gloucester <-> Queen's Gate <-> Exhibition.
  laneTrue("london-kensington-e-1", londonNodes.gloucesterKensington, londonNodes.queenGateFarNorth, 20, ["london-kensington-e-2", "london-queen-gate-south-0"], "travel", [point(-204, 221.7)], ["london-kensington-w-2"], "london-kensington"),
  laneTrue("london-kensington-e-2", londonNodes.queenGateFarNorth, londonNodes.kensingtonExhibition, 20, ["london-exhibition-north-s"], "travel", [point(-33, 221.7)], ["london-kensington-w-1"], "london-kensington"),
  laneTrue("london-kensington-w-1", londonNodes.kensingtonExhibition, londonNodes.queenGateFarNorth, 20, ["london-kensington-w-2", "london-queen-gate-south-0"], "travel", [point(-33, 218.3)], ["london-kensington-e-2"], "london-kensington"),
  laneTrue("london-kensington-w-2", londonNodes.queenGateFarNorth, londonNodes.gloucesterKensington, 20, ["london-gloucester-s-1"], "travel", [point(-204, 218.3)], ["london-kensington-e-1"], "london-kensington"),
  // Exhibition Road extended north to Kensington Road (two-way).
  laneTrue("london-exhibition-north-n", londonNodes.exhibitionThurloe, londonNodes.kensingtonExhibition, 20, ["london-kensington-w-1"], "travel", [point(40.3, 150)], ["london-exhibition-north-s"], "london-exhibition-north"),
  laneTrue("london-exhibition-north-s", londonNodes.kensingtonExhibition, londonNodes.exhibitionThurloe, 20, ["london-thurloe-west-2"], "travel", [point(43.7, 150)], ["london-exhibition-north-n"], "london-exhibition-north"),
];

// Turning loops replacing London's two flat dead-ends (both clockwise, left-side).
// Cromwell Road's Brompton end bulges east; Gloucester Road's south end bulges south.
const londonBromptonLoop = turningLoop({
  prefix: "london-brompton-loop",
  connectNode: londonNodes.cromwellFarEast,
  bulgeDeg: 0,
  radius: 12,
  speed: 20,
  departLaneId: "london-cromwell-west-0",
  color: "#5f9a4e",
});
const londonGloucesterLoop = turningLoop({
  prefix: "london-gloucester-loop",
  connectNode: londonNodes.gloucesterSouth,
  bulgeDeg: 270,
  radius: 12,
  speed: 20,
  departLaneId: "london-gloucester-n-1",
  color: "#5f9a4e",
});
const londonLoopLanes: readonly LaneSegment[] = [
  ...londonBromptonLoop.lanes,
  ...londonGloucesterLoop.lanes,
];

const londonLaneGraph: LaneGraph = {
  nodes: [
    ...Object.values(londonNodes),
    londonBromptonLoop.farNode,
    londonGloucesterLoop.farNode,
  ],
  lanes: [...londonLanes, ...londonLoopLanes],
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
        installation("london-queen-gate-primary", -103.1, -43.3, 0, "roadside_pole", "uk_signal", "primary", ["london-queen-gate-north-approach"]),
        installation("london-queen-gate-secondary", -112.9, -20.7, 180, "secondary_pole", "uk_signal", "secondary", ["london-queen-gate-south-approach"]),
        installation("london-cromwell-west-primary", -96.7, -23.5, 270, "roadside_pole", "uk_signal", "primary", ["london-cromwell-west-approach"]),
        installation("london-cromwell-west-secondary", -96.7, -37.1, 270, "secondary_pole", "uk_signal", "secondary", ["london-cromwell-west-approach"]),
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
        installation("london-exhibition-primary", 30.7, -37.1, 90, "roadside_pole", "uk_signal", "primary", ["london-cromwell-east-general-approach", "london-cromwell-east-bus-approach"]),
        installation("london-exhibition-secondary", 53.3, -27.1, 270, "secondary_pole", "uk_signal", "secondary", ["london-cromwell-westbound-approach"]),
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
      londonBromptonLoop.surface,
      londonGloucesterLoop.surface,
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
      londonBromptonLoop.island,
      londonGloucesterLoop.island,
    ],
  },
  laneGraph: londonLaneGraph,
};

export const LONDON_FREE_DRIVE: FreeDriveDefinition = {
  id: "free-uk-london",
  countryId: "uk",
  destinationId: "uk-london",
  mapId: "london-south-kensington",
  title: "Free Drive — London",
  description:
    "Explore South Kensington's museum streets with optional coaching, a fixed Tuesday morning clock and no prescribed route.",
  startSpawnId: "london-player",
  trafficSeed: 2251,
  scenarioClock: LONDON_SCENARIO_CLOCK,
};
