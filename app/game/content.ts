import type {
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
  MapCheckpoint,
  MapId,
  MapPack,
  MapSpawnPoint,
  OfficialRuleReference,
  ProceduralLandmark,
  ResolvedGameSessionConfig,
  RuleCode,
  RoadMarkingPath,
  RoadMarkingStyle,
  RoadSurface,
  RoadSurfaceType,
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
  if (id.startsWith("nyc-86-")) return "nyc-west-86";
  if (id.startsWith("nyc-bway-")) return "nyc-broadway";
  if (id.startsWith("nyc-we-")) return "nyc-west-end";
  if (id.startsWith("nyc-cpw-")) return "nyc-central-park-west";
  if (id.startsWith("nyc-amst-")) return "nyc-amsterdam";
  if (id.startsWith("nyc-col-")) return "nyc-columbus";
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

const CONNECTOR_LENGTH_M = 0.5;

const distanceBetweenPoints = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

const conflictZoneForNode = (nodeId: string): string => {
  if (nodeId === "nyc-b") return "nyc-conflict-72-bway";
  if (nodeId === "nyc-h") return "nyc-conflict-79-bway";
  if (nodeId === "nyc-d") return "nyc-conflict-columbus";
  if (nodeId.startsWith("uk-") && ["uk-n", "uk-e", "uk-s", "uk-w"].includes(nodeId)) {
    return "uk-roundabout-conflict";
  }
  if (nodeId.startsWith("fr-") && ["fr-n", "fr-e", "fr-s", "fr-w"].includes(nodeId)) {
    return "fr-roundabout-conflict";
  }
  if (nodeId === "fr-eo") return "fr-coquelles-east-split-conflict";
  if (nodeId === "fr-so") return "fr-coquelles-south-split-conflict";
  if (nodeId === "jp-f") return "jp-station-conflict";
  if (nodeId === "jp-d") return "jp-east-curve-junction-conflict";
  if (nodeId === "jp-e") return "jp-east-neighbourhood-junction-conflict";
  return `junction-${nodeId}`;
};

/**
 * Keeps an authored lateral lane offset all the way to a junction, limiting
 * any convergence on a shared node to a short, explicit connector-sized
 * taper. The logical graph nodes remain shared so existing route IDs and
 * deterministic successor routing stay stable.
 */
const laneTrue = (
  id: string,
  from: LaneNode,
  to: LaneNode,
  trafficSide: TrafficSide,
  speedLimit: number,
  successors: readonly string[],
  role: LaneRole,
  establishedPath: readonly WorldPoint[],
  adjacentLaneIds?: readonly string[],
  roadId: string = roadIdForLane(id),
  widthM = laneWidthForLane(id),
  localSpeedUnit?: SpeedUnit,
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
        ? point(
            from.position.x + directionX * CONNECTOR_LENGTH_M,
            first.z,
          )
        : point(
            first.x,
            from.position.z + directionZ * CONNECTOR_LENGTH_M,
          );
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
    trafficSide,
    speedLimit,
    ...(localSpeedUnit ? { localSpeedUnit } : {}),
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

const anchor = (laneId: string, distanceAlongM: number): LaneAnchor => ({
  laneId,
  distanceAlongM,
});

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
 * Points along a circular arc, inclusive of both endpoints. Angles are in
 * degrees with 0deg = +x (east) and 90deg = +z (north); passing a1 < a0 traces
 * the arc clockwise.
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
 * small central island that bulges out from the stub's end node, so cars drive
 * out, loop once and return instead of hitting a flat dead-end. The loop needs
 * no give-way (a single arm has no conflicting traffic) and circulates purely on
 * `successors`. The caller keeps the stub's end node as the connection point,
 * repoints the ARRIVING lane's successor to `${prefix}-a`, and the returning arc
 * `${prefix}-b` feeds `departLaneId` back into the network. Left-side traffic
 * circulates clockwise, right-side counter-clockwise, matching the roundabouts.
 */
const turningLoop = (opts: {
  prefix: string;
  connectNode: LaneNode;
  bulgeDeg: number;
  radius: number;
  side: TrafficSide;
  speed: number;
  departLaneId: string;
  color: string;
  islandRadius?: number;
  widthM?: number;
  speedUnit?: SpeedUnit;
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
    side,
    speed,
    departLaneId,
    color,
    islandRadius = Math.max(4, radius - 6),
    widthM = 7.2,
    speedUnit,
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
  // Left-side traffic drives clockwise (decreasing angle); right-side the other way.
  const direction = side === "left" ? -1 : 1;
  const arcA = arcPoints(center, radius, connectAngle, connectAngle + direction * 180);
  const arcB = arcPoints(
    center,
    radius,
    connectAngle + direction * 180,
    connectAngle + direction * 360,
  );
  const firstArcId = `${prefix}-a`;
  const secondArcId = `${prefix}-b`;
  return {
    farNode,
    firstArcId,
    lanes: [
      lane(firstArcId, connectNode, farNode, side, speed, [secondArcId], "roundabout", arcA.slice(1, -1), undefined, prefix, undefined, speedUnit),
      lane(secondArcId, farNode, connectNode, side, speed, [departLaneId], "roundabout", arcB.slice(1, -1), undefined, prefix, undefined, speedUnit),
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

const laneLengthOf = (lane: LaneSegment): number =>
  lane.centerline.slice(1).reduce(
    (total, current, index) =>
      total + distanceBetweenPoints(lane.centerline[index], current),
    0,
  );

/** Heading (deg, 0 = +z) of the lane's travel direction at a given arclength. */
const laneHeadingAtDistanceDeg = (lane: LaneSegment, distanceAlongM: number): number => {
  let accumulated = 0;
  for (let index = 0; index < lane.centerline.length - 1; index += 1) {
    const a = lane.centerline[index];
    const b = lane.centerline[index + 1];
    const segmentLength = distanceBetweenPoints(a, b);
    if (accumulated + segmentLength >= distanceAlongM || index === lane.centerline.length - 2) {
      return (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI;
    }
    accumulated += segmentLength;
  }
  return 0;
};

/**
 * Builds a signalised junction from the lanes that arrive at it. Each arriving
 * lane gets a stop-line approach 6 m short of the node and a head facing that
 * lane's travel direction, mounted at the junction corner (clear of every lane).
 * North/south lanes and east/west lanes sit on alternating phase groups. This is
 * correct-by-construction, so head headings and stop distances can't drift from
 * the geometry the way hand-authored signals do.
 */
const intersectionSignal = (
  id: string,
  center: WorldPoint,
  arms: readonly { readonly laneId: string; readonly phase: "ns" | "ew" }[],
  lanes: readonly LaneSegment[],
): { readonly control: TrafficControl; readonly zone: LaneGraph["conflictZones"][number] } => {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const zoneId = `${id}-zone`;
  const laneIds = arms.map((arm) => arm.laneId);
  const approaches: TrafficControlApproach[] = [];
  const installations: TrafficControlInstallation[] = [];
  for (const arm of arms) {
    const lane = laneById.get(arm.laneId);
    if (!lane) continue;
    const stopDistance = Math.max(0, laneLengthOf(lane) - 6);
    const headingDeg = laneHeadingAtDistanceDeg(lane, stopDistance);
    const rad = (headingDeg * Math.PI) / 180;
    const dirX = Math.sin(rad);
    const dirZ = Math.cos(rad);
    // Mount at the corner diagonally back-right of the approach, well clear of
    // both carriageways (±8 m from a node whose lanes span only ~±3.4 m).
    const headX = center.x + dirZ * 8 - dirX * 8;
    const headZ = center.z - dirX * 8 - dirZ * 8;
    approaches.push(approach(`${id}-${arm.laneId}-app`, arm.laneId, stopDistance, `${id}-${arm.phase}`, [zoneId]));
    // The pole stands at the back-right corner, offset to the right of the
    // approach. Its mast arm has to reach back the other way — in over the
    // carriageway — so the head hangs above the lane instead of out over the
    // grass. The renderer extends the arm along `armHeadingDeg`, whose zero
    // direction points the same way the pole is offset, so aim it opposite:
    // headingDeg + 180.
    const armHeadingDeg = headingDeg + 180;
    installations.push(installation(`${id}-${arm.laneId}-head`, headX, headZ, headingDeg, "mast_arm", "nyc_signal", "primary", [`${id}-${arm.laneId}-app`], armHeadingDeg));
  }
  const half = 7;
  return {
    control: control(id, "signal", center.x, center.z, 0, laneIds, [zoneId], approaches, installations),
    zone: {
      id: zoneId,
      laneIds,
      polygon: [
        point(center.x - half, center.z - half),
        point(center.x + half, center.z - half),
        point(center.x + half, center.z + half),
        point(center.x - half, center.z + half),
      ],
    },
  };
};

const CONNECTOR_ZONE_RADIUS_M = 2.1;

/**
 * Declares a compact conflict zone around every generic graph junction used
 * by an explicit connector range. Authored signal/roundabout zones keep their
 * wider polygons, while their lane membership is augmented automatically.
 */
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
  conflictZones: connectorConflictZones(lanes, conflictZones),
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
    id: "us-ny-dmv-turns",
    title: "New York State Driver's Manual — Intersections and Turns",
    authority: "New York State Department of Motor Vehicles",
    jurisdiction: "New York, United States",
    url: "https://dmv.ny.gov/new-york-state-drivers-manual-and-practice-tests/chapter-5-intersections-and-turns",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "missing_indicator",
      "one_way",
      "unsafe_gap",
      "observation",
    ],
  },
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
    id: "uk-highway-code-general",
    title:
      "The Highway Code — General rules, techniques and advice for drivers and riders",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "speeding",
      "missing_indicator",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "merge",
      "observation",
    ],
  },
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
  {
    id: "uk-highway-code-motorways",
    title: "The Highway Code — Motorways",
    authority: "UK Department for Transport",
    jurisdiction: "United Kingdom",
    url: "https://www.gov.uk/guidance/the-highway-code/motorways-253-to-273",
    reviewedOn: CONTENT_REVIEWED_ON,
    appliesTo: [
      "speeding",
      "unsafe_gap",
      "following_distance",
      "lane_misuse",
      "merge",
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
    currency: { code: "USD", symbol: "$", minorUnits: 2 },
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      normalTravelLaneSide: "right",
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
    currency: { code: "GBP", symbol: "£", minorUnits: 2 },
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      normalTravelLaneSide: "left",
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
    currency: { code: "EUR", symbol: "€", minorUnits: 2 },
    lanePolicy: {
      keepSide: "right",
      passingSide: "left",
      normalTravelLaneSide: "right",
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
    currency: { code: "JPY", symbol: "¥", minorUnits: 0 },
    lanePolicy: {
      keepSide: "left",
      passingSide: "right",
      normalTravelLaneSide: "left",
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
    freeDriveId: "free-jp",
    promotion: "standard",
    cityMark: "TYO",
    visualTheme: TOKYO_THEME,
  },
];

// Upper West Side grid. x = east, z = north. Three two-way avenues — West End
// (x=-320), Broadway (x=-120), Central Park West (x=320) — cross three two-way
// streets — West 72nd (z=-480), 79th (z=0), 86th (z=480). ~640 m x 960 m.
const nycNodes = {
  we72: node("nyc-we-72", -320, -480),
  bw72: node("nyc-bw-72", -120, -480),
  amst72: node("nyc-amst-72", 40, -480),
  col72: node("nyc-col-72", 180, -480),
  cpw72: node("nyc-cpw-72", 320, -480),
  we79: node("nyc-we-79", -320, 0),
  bw79: node("nyc-bw-79", -120, 0),
  amst79: node("nyc-amst-79", 40, 0),
  col79: node("nyc-col-79", 180, 0),
  cpw79: node("nyc-cpw-79", 320, 0),
  we86: node("nyc-we-86", -320, 480),
  bw86: node("nyc-bw-86", -120, 480),
  amst86: node("nyc-amst-86", 40, 480),
  col86: node("nyc-col-86", 180, 480),
  cpw86: node("nyc-cpw-86", 320, 480),
};

// Two-way pattern: opposing lanes ride ±1.7 m off the carriageway centreline
// (right-hand traffic: north/east-bound on the +offset side) and converge to the
// shared junction node only over laneTrue's short connector. Straight-ahead
// successors keep each avenue/street flowing; a couple of turns feed the lessons.
const nycLanes: readonly LaneSegment[] = [
  // West End Avenue (two-way, x=-320)
  laneTrue("nyc-we-n-1", nycNodes.we72, nycNodes.we79, "right", 25, ["nyc-we-n-2"], "travel", [point(-318.3, -240)], ["nyc-we-s-2"]),
  laneTrue("nyc-we-n-2", nycNodes.we79, nycNodes.we86, "right", 25, ["nyc-86-e-1"], "travel", [point(-318.3, 240)], ["nyc-we-s-1"]),
  laneTrue("nyc-we-s-1", nycNodes.we86, nycNodes.we79, "right", 25, ["nyc-we-s-2"], "travel", [point(-321.7, 240)], ["nyc-we-n-2"]),
  laneTrue("nyc-we-s-2", nycNodes.we79, nycNodes.we72, "right", 25, [], "travel", [point(-321.7, -240)], ["nyc-we-n-1"]),
  // Broadway (two-way, x=-120) — the hero avenue
  laneTrue("nyc-bway-n-1", nycNodes.bw72, nycNodes.bw79, "right", 25, ["nyc-bway-n-2"], "travel", [point(-118.3, -240)], ["nyc-bway-s-2"]),
  laneTrue("nyc-bway-n-2", nycNodes.bw79, nycNodes.bw86, "right", 25, ["nyc-86-w-4"], "travel", [point(-118.3, 240)], ["nyc-bway-s-1"]),
  laneTrue("nyc-bway-s-1", nycNodes.bw86, nycNodes.bw79, "right", 25, ["nyc-bway-s-2"], "travel", [point(-121.7, 240)], ["nyc-bway-n-2"]),
  laneTrue("nyc-bway-s-2", nycNodes.bw79, nycNodes.bw72, "right", 25, [], "travel", [point(-121.7, -240)], ["nyc-bway-n-1"]),
  // Central Park West (two-way, x=320)
  laneTrue("nyc-cpw-n-1", nycNodes.cpw72, nycNodes.cpw79, "right", 25, ["nyc-cpw-n-2"], "travel", [point(321.7, -240)], ["nyc-cpw-s-2"]),
  laneTrue("nyc-cpw-n-2", nycNodes.cpw79, nycNodes.cpw86, "right", 25, [], "travel", [point(321.7, 240)], ["nyc-cpw-s-1"]),
  laneTrue("nyc-cpw-s-1", nycNodes.cpw86, nycNodes.cpw79, "right", 25, ["nyc-cpw-s-2"], "travel", [point(318.3, 240)], ["nyc-cpw-n-2"]),
  laneTrue("nyc-cpw-s-2", nycNodes.cpw79, nycNodes.cpw72, "right", 25, [], "travel", [point(318.3, -240)], ["nyc-cpw-n-1"]),
  // West 72nd Street (two-way, z=-480), split across Amsterdam & Columbus
  laneTrue("nyc-72-e-1", nycNodes.we72, nycNodes.bw72, "right", 25, ["nyc-72-e-2", "nyc-bway-n-1"], "travel", [point(-220, -481.7)], ["nyc-72-w-4"]),
  laneTrue("nyc-72-e-2", nycNodes.bw72, nycNodes.amst72, "right", 25, ["nyc-72-e-3", "nyc-amst-n-1a"], "travel", [point(-40, -481.7)], ["nyc-72-w-3"]),
  laneTrue("nyc-72-e-3", nycNodes.amst72, nycNodes.col72, "right", 25, ["nyc-72-e-4"], "travel", [point(110, -481.7)], ["nyc-72-w-2"]),
  laneTrue("nyc-72-e-4", nycNodes.col72, nycNodes.cpw72, "right", 25, [], "travel", [point(250, -481.7)], ["nyc-72-w-1"]),
  laneTrue("nyc-72-w-1", nycNodes.cpw72, nycNodes.col72, "right", 25, ["nyc-72-w-2"], "travel", [point(250, -478.3)], ["nyc-72-e-4"]),
  laneTrue("nyc-72-w-2", nycNodes.col72, nycNodes.amst72, "right", 25, ["nyc-72-w-3"], "travel", [point(110, -478.3)], ["nyc-72-e-3"]),
  laneTrue("nyc-72-w-3", nycNodes.amst72, nycNodes.bw72, "right", 25, ["nyc-72-w-4"], "travel", [point(-40, -478.3)], ["nyc-72-e-2"]),
  laneTrue("nyc-72-w-4", nycNodes.bw72, nycNodes.we72, "right", 25, [], "travel", [point(-220, -478.3)], ["nyc-72-e-1"]),
  // West 79th Street (two-way, z=0)
  laneTrue("nyc-79-e-1", nycNodes.we79, nycNodes.bw79, "right", 25, ["nyc-79-e-2"], "travel", [point(-220, -1.7)], ["nyc-79-w-4"]),
  laneTrue("nyc-79-e-2", nycNodes.bw79, nycNodes.amst79, "right", 25, ["nyc-79-e-3"], "travel", [point(-40, -1.7)], ["nyc-79-w-3"]),
  laneTrue("nyc-79-e-3", nycNodes.amst79, nycNodes.col79, "right", 25, ["nyc-79-e-4"], "travel", [point(110, -1.7)], ["nyc-79-w-2"]),
  laneTrue("nyc-79-e-4", nycNodes.col79, nycNodes.cpw79, "right", 25, [], "travel", [point(250, -1.7)], ["nyc-79-w-1"]),
  laneTrue("nyc-79-w-1", nycNodes.cpw79, nycNodes.col79, "right", 25, ["nyc-79-w-2"], "travel", [point(250, 1.7)], ["nyc-79-e-4"]),
  laneTrue("nyc-79-w-2", nycNodes.col79, nycNodes.amst79, "right", 25, ["nyc-79-w-3"], "travel", [point(110, 1.7)], ["nyc-79-e-3"]),
  laneTrue("nyc-79-w-3", nycNodes.amst79, nycNodes.bw79, "right", 25, ["nyc-79-w-4"], "travel", [point(-40, 1.7)], ["nyc-79-e-2"]),
  laneTrue("nyc-79-w-4", nycNodes.bw79, nycNodes.we79, "right", 25, [], "travel", [point(-220, 1.7)], ["nyc-79-e-1"]),
  // West 86th Street (two-way, z=480)
  laneTrue("nyc-86-e-1", nycNodes.we86, nycNodes.bw86, "right", 25, ["nyc-86-e-2"], "travel", [point(-220, 478.3)], ["nyc-86-w-4"]),
  laneTrue("nyc-86-e-2", nycNodes.bw86, nycNodes.amst86, "right", 25, ["nyc-86-e-3"], "travel", [point(-40, 478.3)], ["nyc-86-w-3"]),
  laneTrue("nyc-86-e-3", nycNodes.amst86, nycNodes.col86, "right", 25, ["nyc-86-e-4", "nyc-col-s-1a"], "travel", [point(110, 478.3)], ["nyc-86-w-2"]),
  laneTrue("nyc-86-e-4", nycNodes.col86, nycNodes.cpw86, "right", 25, [], "travel", [point(250, 478.3)], ["nyc-86-w-1"]),
  laneTrue("nyc-86-w-1", nycNodes.cpw86, nycNodes.col86, "right", 25, ["nyc-86-w-2"], "travel", [point(250, 481.7)], ["nyc-86-e-4"]),
  laneTrue("nyc-86-w-2", nycNodes.col86, nycNodes.amst86, "right", 25, ["nyc-86-w-3"], "travel", [point(110, 481.7)], ["nyc-86-e-3"]),
  laneTrue("nyc-86-w-3", nycNodes.amst86, nycNodes.bw86, "right", 25, ["nyc-86-w-4"], "travel", [point(-40, 481.7)], ["nyc-86-e-2"]),
  laneTrue("nyc-86-w-4", nycNodes.bw86, nycNodes.we86, "right", 25, [], "travel", [point(-220, 481.7)], ["nyc-86-e-1"]),
  // Amsterdam Avenue (one-way northbound, x=40) — two parallel lanes
  laneTrue("nyc-amst-n-1a", nycNodes.amst72, nycNodes.amst79, "right", 25, ["nyc-amst-n-1b"], "one_way", [point(38.3, -240)], ["nyc-amst-n-2a"]),
  laneTrue("nyc-amst-n-1b", nycNodes.amst79, nycNodes.amst86, "right", 25, ["nyc-86-e-3"], "one_way", [point(38.3, 240)], ["nyc-amst-n-2b"]),
  laneTrue("nyc-amst-n-2a", nycNodes.amst72, nycNodes.amst79, "right", 25, ["nyc-amst-n-2b"], "one_way", [point(41.7, -240)], ["nyc-amst-n-1a"]),
  laneTrue("nyc-amst-n-2b", nycNodes.amst79, nycNodes.amst86, "right", 25, [], "one_way", [point(41.7, 240)], ["nyc-amst-n-1b"]),
  // Columbus Avenue (one-way southbound, x=180) — two parallel lanes
  laneTrue("nyc-col-s-1a", nycNodes.col86, nycNodes.col79, "right", 25, ["nyc-col-s-1b"], "one_way", [point(178.3, 240)], ["nyc-col-s-2a"]),
  laneTrue("nyc-col-s-1b", nycNodes.col79, nycNodes.col72, "right", 25, [], "one_way", [point(178.3, -240)], ["nyc-col-s-2b"]),
  laneTrue("nyc-col-s-2a", nycNodes.col86, nycNodes.col79, "right", 25, ["nyc-col-s-2b"], "one_way", [point(181.7, 240)], ["nyc-col-s-1a"]),
  laneTrue("nyc-col-s-2b", nycNodes.col79, nycNodes.col72, "right", 25, [], "one_way", [point(181.7, -240)], ["nyc-col-s-1b"]),
];

// Signalised junctions along the Broadway corridor (the lesson route).
const nycSignals = [
  intersectionSignal("nyc-sig-bw72", nycNodes.bw72.position, [
    { laneId: "nyc-bway-s-2", phase: "ns" },
    { laneId: "nyc-72-e-1", phase: "ew" },
    { laneId: "nyc-72-w-3", phase: "ew" },
  ], nycLanes),
  intersectionSignal("nyc-sig-bw79", nycNodes.bw79.position, [
    { laneId: "nyc-bway-n-1", phase: "ns" },
    { laneId: "nyc-bway-s-1", phase: "ns" },
    { laneId: "nyc-79-e-1", phase: "ew" },
    { laneId: "nyc-79-w-3", phase: "ew" },
  ], nycLanes),
  intersectionSignal("nyc-sig-bw86", nycNodes.bw86.position, [
    { laneId: "nyc-bway-n-2", phase: "ns" },
    { laneId: "nyc-86-e-1", phase: "ew" },
    { laneId: "nyc-86-w-3", phase: "ew" },
  ], nycLanes),
  intersectionSignal("nyc-sig-we79", nycNodes.we79.position, [
    { laneId: "nyc-we-n-1", phase: "ns" },
    { laneId: "nyc-we-s-1", phase: "ns" },
    { laneId: "nyc-79-w-4", phase: "ew" },
  ], nycLanes),
  intersectionSignal("nyc-sig-amst79", nycNodes.amst79.position, [
    { laneId: "nyc-amst-n-1a", phase: "ns" },
    { laneId: "nyc-amst-n-2a", phase: "ns" },
    { laneId: "nyc-79-e-2", phase: "ew" },
    { laneId: "nyc-79-w-2", phase: "ew" },
  ], nycLanes),
  intersectionSignal("nyc-sig-col79", nycNodes.col79.position, [
    { laneId: "nyc-col-s-1a", phase: "ns" },
    { laneId: "nyc-col-s-2a", phase: "ns" },
    { laneId: "nyc-79-e-3", phase: "ew" },
    { laneId: "nyc-79-w-1", phase: "ew" },
  ], nycLanes),
  intersectionSignal("nyc-sig-cpw79", nycNodes.cpw79.position, [
    { laneId: "nyc-cpw-n-1", phase: "ns" },
    { laneId: "nyc-cpw-s-1", phase: "ns" },
    { laneId: "nyc-79-e-4", phase: "ew" },
  ], nycLanes),
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
  ne: node("uk-ne", 700, 118),
  wgo: node("uk-wgo", -320, 0),
};

const ukLanes: readonly LaneSegment[] = [
  // Use short arc segments instead of a diamond. The visual carriageway and
  // the legal vehicle path now round each corner together.
  lane("uk-rb-n-e", ukNodes.n, ukNodes.e, "left", 30, ["uk-rb-e-s", "uk-exit-east"], "roundabout", [point(13, 31.4), point(24, 24), point(31.4, 13)]),
  lane("uk-rb-e-s", ukNodes.e, ukNodes.s, "left", 30, ["uk-rb-s-w", "uk-exit-south"], "roundabout", [point(31.4, -13), point(24, -24), point(13, -31.4)]),
  lane("uk-rb-s-w", ukNodes.s, ukNodes.w, "left", 30, ["uk-rb-w-n", "uk-exit-west"], "roundabout", [point(-13, -31.4), point(-24, -24), point(-31.4, -13)]),
  lane("uk-rb-w-n", ukNodes.w, ukNodes.n, "left", 30, ["uk-rb-n-e", "uk-exit-north"], "roundabout", [point(-31.4, 13), point(-24, 24), point(-13, 31.4)]),
  laneTrue("uk-entry-north", ukNodes.no, ukNodes.n, "left", 40, ["uk-rb-n-e"], "entry", [point(1.7, 76)], ["uk-exit-north"]),
  laneTrue("uk-exit-north", ukNodes.n, ukNodes.no, "left", 40, ["uk-dual-n-east"], "exit", [point(-1.7, 76)], ["uk-entry-north"]),
  laneTrue("uk-entry-east", ukNodes.eo, ukNodes.e, "left", 40, ["uk-rb-e-s"], "entry", [point(82, -1.7)], ["uk-exit-east"]),
  laneTrue("uk-exit-east", ukNodes.e, ukNodes.eo, "left", 40, ["uk-entry-east"], "exit", [point(82, 1.7)], ["uk-entry-east"]),
  laneTrue("uk-entry-south", ukNodes.so, ukNodes.s, "left", 40, ["uk-rb-s-w"], "entry", [point(-1.7, -76)], ["uk-exit-south"]),
  laneTrue("uk-exit-south", ukNodes.s, ukNodes.so, "left", 40, ["uk-south-west"], "exit", [point(1.7, -76)], ["uk-entry-south"]),
  laneTrue("uk-entry-west", ukNodes.wo, ukNodes.w, "left", 40, ["uk-rb-w-n"], "entry", [point(-82, 1.7)], ["uk-exit-west"]),
  laneTrue("uk-exit-west", ukNodes.w, ukNodes.wo, "left", 40, ["uk-west-south", "uk-westgrid-out"], "exit", [point(-82, -1.7)], ["uk-entry-west"]),
  laneTrue("uk-dual-n-east", ukNodes.no, ukNodes.ne, "left", 60, ["uk-east-north"], "travel", [point(80, 119.75), point(220, 119.75), point(360, 119.75), point(500, 119.75), point(620, 119.75)], ["uk-dual-n-east-pass"]),
  laneTrue("uk-dual-n-east-pass", ukNodes.no, ukNodes.ne, "left", 60, ["uk-east-north"], "passing", [point(80, 116.25), point(220, 116.25), point(360, 116.25), point(500, 116.25), point(620, 116.25)], ["uk-dual-n-east"]),
  laneTrue("uk-east-north", ukNodes.ne, ukNodes.eo, "left", 40, ["uk-entry-east"], "travel", [point(701.7, 117.5), point(701.7, 70), point(701.34, 28.95), point(600.4, -11.65), point(450.1, -31.7), point(299.86, -26.7), point(199.75, -11.68), point(130.25, -1.75)]),
  laneTrue("uk-south-west", ukNodes.so, ukNodes.wo, "left", 40, ["uk-entry-west"], "travel", [point(-0.5, -119.7), point(-66.1, -119.3), point(-131.49, -60.82), point(-131.7, -0.5)]),
  laneTrue("uk-west-south", ukNodes.wo, ukNodes.so, "left", 40, ["uk-entry-south"], "travel", [point(-128.3, -0.5), point(-128.51, -59.18), point(-64.31, -116.45), point(-0.5, -116.3)]),
  // Westbound grid road off the roundabout's west arm. Rather than a flat
  // dead-end it ends in a single-arm turning loop (uk-westloop) so free-drive
  // can roam west and circle back, with genuine oncoming traffic on the way.
  laneTrue("uk-westgrid-out", ukNodes.wo, ukNodes.wgo, "left", 40, ["uk-westloop-a"], "travel", [point(-225, -1.7)], ["uk-westgrid-in"], "uk-westgrid", 3.2),
  laneTrue("uk-westgrid-in", ukNodes.wgo, ukNodes.wo, "left", 40, ["uk-entry-west"], "travel", [point(-225, 1.7)], ["uk-westgrid-out"], "uk-westgrid", 3.2),
];

// Turning loop at the west end of the Oldbrook westgrid (left-side: clockwise).
const ukWestLoop = turningLoop({
  prefix: "uk-westloop",
  connectNode: ukNodes.wgo,
  bulgeDeg: 180,
  radius: 12,
  side: "left",
  speed: 40,
  departLaneId: "uk-westgrid-in",
  color: "#608b4e",
});

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
  wgo: node("fr-wgo", -300, 0),
};

const frLanes: readonly LaneSegment[] = [
  // Match the French counter-clockwise circulation with smooth, driveable
  // arcs. This also leaves a clean, consistently wide island boundary.
  lane("fr-rb-n-w", frNodes.n, frNodes.w, "right", 30, ["fr-rb-w-s", "fr-exit-west"], "roundabout", [point(-13, 31.4), point(-24, 24), point(-31.4, 13)]),
  lane("fr-rb-w-s", frNodes.w, frNodes.s, "right", 30, ["fr-rb-s-e", "fr-exit-south"], "roundabout", [point(-31.4, -13), point(-24, -24), point(-13, -31.4)]),
  lane("fr-rb-s-e", frNodes.s, frNodes.e, "right", 30, ["fr-rb-e-n", "fr-exit-east"], "roundabout", [point(13, -31.4), point(24, -24), point(31.4, -13)]),
  lane("fr-rb-e-n", frNodes.e, frNodes.n, "right", 30, ["fr-rb-n-w", "fr-exit-north"], "roundabout", [point(31.4, 13), point(24, 24), point(13, 31.4)]),
  laneTrue("fr-entry-north", frNodes.no, frNodes.n, "right", 50, ["fr-rb-n-w"], "entry", [point(-1.7, 76)], ["fr-exit-north"]),
  laneTrue("fr-exit-north", frNodes.n, frNodes.no, "right", 50, ["fr-north-west"], "exit", [point(1.7, 76)], ["fr-entry-north"]),
  laneTrue("fr-entry-east", frNodes.eo, frNodes.e, "right", 50, ["fr-rb-e-n"], "entry", [point(86, 1.7)], ["fr-exit-east"]),
  laneTrue("fr-exit-east", frNodes.e, frNodes.eo, "right", 50, ["fr-east-south"], "exit", [point(86, -1.7)], ["fr-entry-east"]),
  laneTrue("fr-entry-south", frNodes.so, frNodes.s, "right", 50, ["fr-rb-s-e"], "entry", [point(1.7, -76)], ["fr-exit-south"]),
  laneTrue("fr-exit-south", frNodes.s, frNodes.so, "right", 50, ["fr-south-east"], "exit", [point(-1.7, -76)], ["fr-entry-south"]),
  laneTrue("fr-entry-west", frNodes.wo, frNodes.w, "right", 50, ["fr-rb-w-s"], "entry", [point(-86, -1.7)], ["fr-exit-west"]),
  laneTrue("fr-exit-west", frNodes.w, frNodes.wo, "right", 50, ["fr-entry-west", "fr-westgrid-out"], "exit", [point(-86, 1.7)], ["fr-entry-west"]),
  laneTrue("fr-south-east", frNodes.so, frNodes.eo, "right", 70, ["fr-entry-east"], "travel", [point(0.5, -119.7), point(53, -100.7), point(94, -80.7), point(139.25, -1.25)], ["fr-south-east-pass"]),
  laneTrue("fr-south-east-pass", frNodes.so, frNodes.eo, "right", 70, ["fr-entry-east"], "passing", [point(-0.5, -116.3), point(53, -97.3), point(94, -77.3), point(136.25, 0.4)], ["fr-south-east"]),
  laneTrue("fr-east-south", frNodes.eo, frNodes.so, "right", 50, ["fr-entry-south"], "travel", [point(136.5, -0.95), point(148.31, -42.18), point(148.49, -109.21), point(103.74, -128.32), point(20.2, -128.31), point(1.3, -116.8)]),
  laneTrue("fr-north-west", frNodes.no, frNodes.wo, "right", 50, ["fr-entry-west"], "travel", [point(-1.23, 119.27), point(-81.1, 77.3), point(-139.05, 1.43)]),
  // Westbound local road off the roundabout's west arm. It now ends in a
  // single-arm turning loop (fr-westloop) instead of a flat dead-end, so
  // right-side free-drive can roam west and circle back with oncoming traffic.
  laneTrue("fr-westgrid-out", frNodes.wo, frNodes.wgo, "right", 50, ["fr-westloop-a"], "travel", [point(-219, 1.7)], ["fr-westgrid-in"], "fr-westgrid", 3.2),
  laneTrue("fr-westgrid-in", frNodes.wgo, frNodes.wo, "right", 50, ["fr-entry-west"], "travel", [point(-219, -1.7)], ["fr-westgrid-out"], "fr-westgrid", 3.2),
];

// Turning loop at the west end of the Coquelles westgrid (right-side: counter-
// clockwise). A tighter radius keeps it clear of the nearby west world edge.
const frWestLoop = turningLoop({
  prefix: "fr-westloop",
  connectNode: frNodes.wgo,
  bulgeDeg: 180,
  radius: 10,
  side: "right",
  speed: 50,
  departLaneId: "fr-westgrid-in",
  color: "#6d914f",
});

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
  // Northern district (Miyanosaka side, north of the existing loop).
  nw2: node("jp-nw2", -112, 168),
  nm2: node("jp-nm2", -30, 168),
  ne2: node("jp-ne2", 82, 168),
  // Western corridor (Yamashita side, west of the existing loop).
  sw: node("jp-sw", -260, -72),
  cw: node("jp-cw", -260, 18),
  nw: node("jp-nw", -260, 76),
  // Southern district: Setagaya-dori arterial and its approaches.
  ssW: node("jp-ss-w", -260, -168),
  ssM: node("jp-ss-m", -30, -168),
  ssE: node("jp-ss-e", 72, -168),
};

const jpLanes: readonly LaneSegment[] = [
  laneTrue("jp-south-east-1", jpNodes.a, jpNodes.b, "left", 30, ["jp-south-east-2", "jp-narrow-north-1", "jp-shrine-south"], "travel", [point(-71, -70.5)], ["jp-south-west-1"]),
  laneTrue("jp-south-east-2", jpNodes.b, jpNodes.c, "left", 30, ["jp-curve-north", "jp-eastside-south"], "rail_crossing", [point(21, -70.5)], ["jp-south-west-2"]),
  laneTrue("jp-south-west-1", jpNodes.b, jpNodes.a, "left", 30, ["jp-westedge-north", "jp-southrow-west-w"], "travel", [point(-71, -73.5)], ["jp-south-east-1"], "jp-south-road", 3),
  laneTrue("jp-south-west-2", jpNodes.c, jpNodes.b, "left", 30, ["jp-south-west-1"], "rail_crossing", [point(21, -73.5)], ["jp-south-east-2"], "jp-south-road", 3),
  laneTrue("jp-curve-north", jpNodes.c, jpNodes.d, "left", 30, ["jp-center-west-1"], "travel", [point(71.64, -70.27), point(100.78, -54.81), point(106.36, -34.57), point(110.23, -18.1)], ["jp-curve-south"]),
  laneTrue("jp-curve-south", jpNodes.d, jpNodes.c, "left", 30, ["jp-south-west-2"], "travel", [point(113.54, -18.88), point(109.64, -35.43), point(103.22, -57.19), point(73.24, -73.26)], ["jp-curve-north"], "jp-east-curve", 3),
  laneTrue("jp-center-west-1", jpNodes.d, jpNodes.e, "left", 30, ["jp-center-west-2"], "travel", [point(110.37, -18.7), point(81.1, 16.56), point(54.5, 16.3)], ["jp-center-east-3"]),
  laneTrue("jp-center-west-2", jpNodes.e, jpNodes.f, "left", 30, ["jp-center-west-3", "jp-narrow-north-2"], "travel", [point(12, 16.5)], ["jp-center-east-2"]),
  laneTrue("jp-center-west-3", jpNodes.f, jpNodes.g, "left", 30, ["jp-west-north", "jp-centerrow-west-w"], "travel", [point(-71, 16.5)], ["jp-center-east-1"]),
  laneTrue("jp-center-east-1", jpNodes.g, jpNodes.f, "left", 30, ["jp-center-east-2", "jp-narrow-south-1"], "travel", [point(-71, 19.5)], ["jp-center-west-3"], "jp-center-road", 3),
  laneTrue("jp-center-east-2", jpNodes.f, jpNodes.e, "left", 30, ["jp-center-east-3"], "travel", [point(12, 19.5)], ["jp-center-west-2"], "jp-center-road", 3),
  laneTrue("jp-center-east-3", jpNodes.e, jpNodes.d, "left", 30, ["jp-curve-south"], "travel", [point(54.5, 19.7), point(82.9, 19.45), point(112.99, -16.53)], ["jp-center-west-1"], "jp-center-road", 3),
  laneTrue("jp-west-north", jpNodes.g, jpNodes.h, "left", 30, ["jp-north-east-1", "jp-westhill-north"], "travel", [point(-113.5, 47)], ["jp-west-south"]),
  laneTrue("jp-west-south", jpNodes.h, jpNodes.g, "left", 30, ["jp-center-east-1", "jp-westedge-south"], "travel", [point(-110.5, 47)], ["jp-west-north"], "jp-west-road", 3),
  laneTrue("jp-north-east-1", jpNodes.h, jpNodes.i, "left", 30, ["jp-north-east-2"], "travel", [point(-71, 77.5)], ["jp-north-west-2"]),
  laneTrue("jp-north-east-2", jpNodes.i, jpNodes.j, "left", 30, ["jp-junction-south", "jp-easthill-north"], "travel", [point(26, 77.5)], ["jp-north-west-1"]),
  laneTrue("jp-north-west-1", jpNodes.j, jpNodes.i, "left", 30, ["jp-north-west-2", "jp-narrow-south-2"], "travel", [point(26, 74.5)], ["jp-north-east-2"], "jp-north-road", 3),
  laneTrue("jp-north-west-2", jpNodes.i, jpNodes.h, "left", 30, ["jp-west-south", "jp-northrow-west-w"], "travel", [point(-71, 74.5)], ["jp-north-east-1"], "jp-north-road", 3),
  laneTrue("jp-junction-south", jpNodes.j, jpNodes.e, "left", 30, ["jp-center-west-2"], "travel", [point(83.3, 75.1), point(83.5, 47), point(55.3, 17.1)], ["jp-junction-north"]),
  laneTrue("jp-junction-north", jpNodes.e, jpNodes.j, "left", 30, ["jp-north-west-1", "jp-easthill-north"], "travel", [point(52.7, 18.9), point(80.5, 47), point(80.7, 76.9)], ["jp-junction-south"], "jp-junction-road", 3),
  laneTrue("jp-narrow-north-1", jpNodes.b, jpNodes.f, "left", 20, ["jp-narrow-north-2"], "travel", [point(-31.35, -27)], ["jp-narrow-south-1"]),
  laneTrue("jp-narrow-north-2", jpNodes.f, jpNodes.i, "left", 20, ["jp-north-east-2", "jp-narrowhill-north"], "travel", [point(-31.35, 47)], ["jp-narrow-south-2"]),
  laneTrue("jp-narrow-south-1", jpNodes.f, jpNodes.b, "left", 20, ["jp-south-west-1", "jp-shrine-south"], "travel", [point(-28.65, -27)], ["jp-narrow-north-1"], "jp-narrow-road", 2.7),
  laneTrue("jp-narrow-south-2", jpNodes.i, jpNodes.f, "left", 20, ["jp-narrow-south-1"], "travel", [point(-28.65, 47)], ["jp-narrow-north-2"], "jp-narrow-road", 2.7),
  // --- Northern district: a second loop north of the existing streets ---
  // Westhill Road (N-S, x=-112): extends the west edge north up to Uptown.
  laneTrue("jp-westhill-north", jpNodes.h, jpNodes.nw2, "left", 30, ["jp-uptown-east-1"], "travel", [point(-113.5, 122)], ["jp-westhill-south"], "jp-westhill-road", 3),
  laneTrue("jp-westhill-south", jpNodes.nw2, jpNodes.h, "left", 30, ["jp-west-south"], "travel", [point(-110.5, 122)], ["jp-westhill-north"], "jp-westhill-road", 3),
  // Narrowhill Road (narrow N-S, x=-30): extends the central spine north.
  laneTrue("jp-narrowhill-north", jpNodes.i, jpNodes.nm2, "left", 20, ["jp-uptown-east-2", "jp-uptown-west-2"], "travel", [point(-31.35, 122)], ["jp-narrowhill-south"], "jp-narrowhill-road", 2.7),
  laneTrue("jp-narrowhill-south", jpNodes.nm2, jpNodes.i, "left", 20, ["jp-narrow-south-2"], "travel", [point(-28.65, 122)], ["jp-narrowhill-north"], "jp-narrowhill-road", 2.7),
  // Easthill Road (N-S, x=82): extends the junction line north.
  laneTrue("jp-easthill-north", jpNodes.j, jpNodes.ne2, "left", 30, ["jp-uptown-west-1"], "travel", [point(80.5, 122)], ["jp-easthill-south"], "jp-easthill-road", 3),
  laneTrue("jp-easthill-south", jpNodes.ne2, jpNodes.j, "left", 30, ["jp-junction-south", "jp-north-west-1"], "travel", [point(83.5, 122)], ["jp-easthill-north"], "jp-easthill-road", 3),
  // Uptown Road (E-W, z=168): the northern through-street closing the loop.
  laneTrue("jp-uptown-east-1", jpNodes.nw2, jpNodes.nm2, "left", 30, ["jp-uptown-east-2", "jp-narrowhill-south"], "travel", [point(-71, 169.5)], ["jp-uptown-west-2"], "jp-uptown-road", 3),
  laneTrue("jp-uptown-east-2", jpNodes.nm2, jpNodes.ne2, "left", 30, ["jp-easthill-south"], "travel", [point(26, 169.5)], ["jp-uptown-west-1"], "jp-uptown-road", 3),
  laneTrue("jp-uptown-west-1", jpNodes.ne2, jpNodes.nm2, "left", 30, ["jp-uptown-west-2", "jp-narrowhill-south"], "travel", [point(26, 166.5)], ["jp-uptown-east-2"], "jp-uptown-road", 3),
  laneTrue("jp-uptown-west-2", jpNodes.nm2, jpNodes.nw2, "left", 30, ["jp-westhill-south"], "travel", [point(-71, 166.5)], ["jp-uptown-east-1"], "jp-uptown-road", 3),
  // --- Western corridor: closes the west side and reaches out to Westside Road ---
  // Westedge Road (N-S, x=-112): joins the south stub up to the centre street.
  laneTrue("jp-westedge-north", jpNodes.a, jpNodes.g, "left", 30, ["jp-west-north", "jp-centerrow-west-w"], "travel", [point(-113.5, -27)], ["jp-westedge-south"], "jp-westedge-road", 3),
  laneTrue("jp-westedge-south", jpNodes.g, jpNodes.a, "left", 30, ["jp-south-east-1", "jp-southrow-west-w"], "travel", [point(-110.5, -27)], ["jp-westedge-north"], "jp-westedge-road", 3),
  // Southrow West (E-W, z=-72): extends the south road out to Westside Road.
  laneTrue("jp-southrow-west-w", jpNodes.a, jpNodes.sw, "left", 30, ["jp-westside-north-1", "jp-westside-south-south"], "travel", [point(-186, -73.5)], ["jp-southrow-west-e"], "jp-southrow-west", 3),
  laneTrue("jp-southrow-west-e", jpNodes.sw, jpNodes.a, "left", 30, ["jp-south-east-1", "jp-westedge-north"], "travel", [point(-186, -70.5)], ["jp-southrow-west-w"], "jp-southrow-west", 3),
  // Centerrow West (E-W, z=18): extends the centre street out to Westside Road.
  laneTrue("jp-centerrow-west-w", jpNodes.g, jpNodes.cw, "left", 30, ["jp-westside-north-2", "jp-westside-south-1"], "travel", [point(-186, 16.5)], ["jp-centerrow-west-e"], "jp-centerrow-west", 3),
  laneTrue("jp-centerrow-west-e", jpNodes.cw, jpNodes.g, "left", 30, ["jp-center-east-1", "jp-westedge-south"], "travel", [point(-186, 19.5)], ["jp-centerrow-west-w"], "jp-centerrow-west", 3),
  // Northrow West (E-W, z=76): extends the north road out to Westside Road.
  laneTrue("jp-northrow-west-w", jpNodes.h, jpNodes.nw, "left", 30, ["jp-westside-south-2"], "travel", [point(-186, 74.5)], ["jp-northrow-west-e"], "jp-northrow-west", 3),
  laneTrue("jp-northrow-west-e", jpNodes.nw, jpNodes.h, "left", 30, ["jp-north-east-1", "jp-west-south"], "travel", [point(-186, 77.5)], ["jp-northrow-west-w"], "jp-northrow-west", 3),
  // Westside Road (N-S, x=-260): the far-west street closing the western loop.
  laneTrue("jp-westside-north-1", jpNodes.sw, jpNodes.cw, "left", 30, ["jp-westside-north-2", "jp-centerrow-west-e"], "travel", [point(-261.5, -27)], ["jp-westside-south-1"], "jp-westside-road", 3),
  laneTrue("jp-westside-north-2", jpNodes.cw, jpNodes.nw, "left", 30, ["jp-northrow-west-e"], "travel", [point(-261.5, 47)], ["jp-westside-south-2"], "jp-westside-road", 3),
  laneTrue("jp-westside-south-2", jpNodes.nw, jpNodes.cw, "left", 30, ["jp-westside-south-1", "jp-centerrow-west-e"], "travel", [point(-258.5, 47)], ["jp-westside-north-2"], "jp-westside-road", 3),
  laneTrue("jp-westside-south-1", jpNodes.cw, jpNodes.sw, "left", 30, ["jp-southrow-west-e", "jp-westside-south-south"], "travel", [point(-258.5, -27)], ["jp-westside-north-1"], "jp-westside-road", 3),
  // --- Southern district: Setagaya-dori arterial and its approaches ---
  // Setagaya-dori (E-W arterial, z=-168): the wider, faster hero through-road.
  laneTrue("jp-dori-east-1", jpNodes.ssW, jpNodes.ssM, "left", 40, ["jp-dori-east-2", "jp-shrine-north"], "travel", [point(-145, -166.5)], ["jp-dori-west-2"], "jp-setagaya-dori", 3),
  laneTrue("jp-dori-east-2", jpNodes.ssM, jpNodes.ssE, "left", 40, ["jp-eastside-north"], "travel", [point(21, -166.5)], ["jp-dori-west-1"], "jp-setagaya-dori", 3),
  laneTrue("jp-dori-west-1", jpNodes.ssE, jpNodes.ssM, "left", 40, ["jp-dori-west-2", "jp-shrine-north"], "travel", [point(21, -169.5)], ["jp-dori-east-2"], "jp-setagaya-dori", 3),
  laneTrue("jp-dori-west-2", jpNodes.ssM, jpNodes.ssW, "left", 40, ["jp-westside-south-north"], "travel", [point(-145, -169.5)], ["jp-dori-east-1"], "jp-setagaya-dori", 3),
  // Westside South (N-S, x=-260): joins Westside Road down to the arterial.
  laneTrue("jp-westside-south-north", jpNodes.ssW, jpNodes.sw, "left", 30, ["jp-westside-north-1", "jp-southrow-west-e"], "travel", [point(-261.5, -120)], ["jp-westside-south-south"], "jp-westside-south", 3),
  laneTrue("jp-westside-south-south", jpNodes.sw, jpNodes.ssW, "left", 30, ["jp-dori-east-1"], "travel", [point(-258.5, -120)], ["jp-westside-south-north"], "jp-westside-south", 3),
  // Shrine Road (narrow N-S, x=-30): extends the central spine south to the arterial.
  laneTrue("jp-shrine-north", jpNodes.ssM, jpNodes.b, "left", 20, ["jp-narrow-north-1", "jp-south-east-2"], "travel", [point(-31.35, -120)], ["jp-shrine-south"], "jp-shrine-road", 2.7),
  laneTrue("jp-shrine-south", jpNodes.b, jpNodes.ssM, "left", 20, ["jp-dori-west-2", "jp-dori-east-2"], "travel", [point(-28.65, -120)], ["jp-shrine-north"], "jp-shrine-road", 2.7),
  // Eastside Road (N-S, x=72): joins the south road down to the arterial.
  laneTrue("jp-eastside-north", jpNodes.ssE, jpNodes.c, "left", 30, ["jp-south-west-2", "jp-curve-north"], "travel", [point(70.5, -120)], ["jp-eastside-south"], "jp-eastside-road", 3),
  laneTrue("jp-eastside-south", jpNodes.c, jpNodes.ssE, "left", 30, ["jp-dori-west-1"], "travel", [point(73.5, -120)], ["jp-eastside-north"], "jp-eastside-road", 3),
];

export const MAP_PACKS: readonly MapPack[] = [
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
      worldSize: point(760, 1080),
      roadWidth: 11,
      shoulderWidth: 1.5,
      roadSurfaces: [
        roadSurface("nyc-west-72", [nycNodes.we72.position, nycNodes.bw72.position, nycNodes.amst72.position, nycNodes.col72.position, nycNodes.cpw72.position], 10.4, ["nyc-72-e-1", "nyc-72-e-2", "nyc-72-e-3", "nyc-72-e-4", "nyc-72-w-1", "nyc-72-w-2", "nyc-72-w-3", "nyc-72-w-4"], "standard", [
          roadMarking("nyc-72-centre", "centre_dashed", [nycNodes.we72.position, nycNodes.cpw72.position], "white"),
        ]),
        roadSurface("nyc-west-79", [nycNodes.we79.position, nycNodes.bw79.position, nycNodes.amst79.position, nycNodes.col79.position, nycNodes.cpw79.position], 10.4, ["nyc-79-e-1", "nyc-79-e-2", "nyc-79-e-3", "nyc-79-e-4", "nyc-79-w-1", "nyc-79-w-2", "nyc-79-w-3", "nyc-79-w-4"], "standard", [
          roadMarking("nyc-79-centre", "centre_dashed", [nycNodes.we79.position, nycNodes.cpw79.position], "white"),
        ]),
        roadSurface("nyc-west-86", [nycNodes.we86.position, nycNodes.bw86.position, nycNodes.amst86.position, nycNodes.col86.position, nycNodes.cpw86.position], 10.4, ["nyc-86-e-1", "nyc-86-e-2", "nyc-86-e-3", "nyc-86-e-4", "nyc-86-w-1", "nyc-86-w-2", "nyc-86-w-3", "nyc-86-w-4"], "standard", [
          roadMarking("nyc-86-centre", "centre_dashed", [nycNodes.we86.position, nycNodes.cpw86.position], "white"),
        ]),
        roadSurface("nyc-west-end", [nycNodes.we72.position, nycNodes.we79.position, nycNodes.we86.position], 11, ["nyc-we-n-1", "nyc-we-n-2", "nyc-we-s-1", "nyc-we-s-2"], "standard", [
          roadMarking("nyc-west-end-centre", "centre_solid", [nycNodes.we72.position, nycNodes.we86.position], "yellow"),
        ]),
        roadSurface("nyc-broadway", [nycNodes.bw72.position, nycNodes.bw79.position, nycNodes.bw86.position], 11, ["nyc-bway-n-1", "nyc-bway-n-2", "nyc-bway-s-1", "nyc-bway-s-2"], "standard", [
          roadMarking("nyc-broadway-centre", "centre_solid", [nycNodes.bw72.position, nycNodes.bw86.position], "yellow"),
        ]),
        roadSurface("nyc-central-park-west", [nycNodes.cpw72.position, nycNodes.cpw79.position, nycNodes.cpw86.position], 11, ["nyc-cpw-n-1", "nyc-cpw-n-2", "nyc-cpw-s-1", "nyc-cpw-s-2"], "standard", [
          roadMarking("nyc-cpw-centre", "centre_solid", [nycNodes.cpw72.position, nycNodes.cpw86.position], "yellow"),
        ]),
        roadSurface("nyc-amsterdam", [nycNodes.amst72.position, nycNodes.amst79.position, nycNodes.amst86.position], 9, ["nyc-amst-n-1a", "nyc-amst-n-1b", "nyc-amst-n-2a", "nyc-amst-n-2b"], "standard", [
          roadMarking("nyc-amsterdam-lane", "lane_dashed", [nycNodes.amst72.position, nycNodes.amst86.position], "white"),
        ]),
        roadSurface("nyc-columbus", [nycNodes.col72.position, nycNodes.col79.position, nycNodes.col86.position], 9, ["nyc-col-s-1a", "nyc-col-s-1b", "nyc-col-s-2a", "nyc-col-s-2b"], "standard", [
          roadMarking("nyc-columbus-lane", "lane_dashed", [nycNodes.col72.position, nycNodes.col86.position], "white"),
        ]),
      ],
      blocks: [
        // One building cluster per grid cell, fitted between the avenues so none
        // sits on Amsterdam or Columbus.
        { id: "nyc-block-we-bway-s", center: point(-220, -240), size: point(150, 420), heightRange: [18, 42], density: 0.8, material: "brick" },
        { id: "nyc-block-we-bway-n", center: point(-220, 240), size: point(150, 420), heightRange: [20, 46], density: 0.82, material: "sandstone" },
        { id: "nyc-block-bway-amst-s", center: point(-40, -240), size: point(120, 420), heightRange: [16, 40], density: 0.78, material: "stone" },
        { id: "nyc-block-bway-amst-n", center: point(-40, 240), size: point(120, 420), heightRange: [20, 44], density: 0.8, material: "brick" },
        { id: "nyc-block-amst-col-s", center: point(110, -240), size: point(100, 420), heightRange: [18, 46], density: 0.82, material: "sandstone" },
        { id: "nyc-block-amst-col-n", center: point(110, 240), size: point(100, 420), heightRange: [22, 50], density: 0.84, material: "stone" },
        { id: "nyc-block-col-cpw-s", center: point(250, -240), size: point(100, 420), heightRange: [20, 48], density: 0.8, material: "brick" },
      ],
      servicePoints: [
        // West 72nd is a wide two-way, so the lot has to clear 3.5 m of lane
        // plus the 1.5 m shoulder before its own 11.64 m half-width starts.
        { id: "nyc-gas", kind: "gas_station", anchor: { laneId: "nyc-72-e-1", distanceAlongM: 30 }, footprint: point(14, 9), label: "Broadway Fuel", setbackM: 16.7 },
      ],
      gigVenues: [
        { id: "nyc-v1", kind: "restaurant", anchor: { laneId: "nyc-amst-n-1a", distanceAlongM: 240 }, footprint: point(16, 12), name: "Amsterdam Diner" },
        { id: "nyc-v2", kind: "shop", anchor: { laneId: "nyc-86-e-3", distanceAlongM: 70 }, footprint: point(16, 12), name: "West 86th Grocers" },
        { id: "nyc-v3", kind: "residence", anchor: { laneId: "nyc-col-s-1b", distanceAlongM: 445 }, footprint: point(14, 12), name: "Columbus Apartments" },
        { id: "nyc-v4", kind: "office", anchor: { laneId: "nyc-we-n-2", distanceAlongM: 240 }, footprint: point(16, 14), name: "West End Offices" },
      ],
      landmarks: [
        // Kept clear of the carriageways (a content test enforces this).
        { id: "nyc-verdi-green", kind: "park", center: point(-40, -455), size: point(40, 24), color: "#5c8c4b" },
        { id: "nyc-subway", kind: "station", center: point(-92, -455), size: point(8, 5), color: "#2d2f33" },
        { id: "nyc-central-park", kind: "park", center: point(358, 0), size: point(38, 940), color: "#4f7a3d" },
        { id: "nyc-amnh", kind: "shops", center: point(250, 240), size: point(100, 420), color: "#caa76f" },
      ],
    },
    laneGraph: graph(
      Object.values(nycNodes),
      nycLanes,
      nycSignals.map((signal) => signal.control),
      nycSignals.map((signal) => signal.zone),
      [
        anchoredSpawn("nyc-player-1way", "player", "nyc-72-e-1", 30),
        anchoredSpawn("nyc-player-signals", "player", "nyc-bway-n-1", 30),
        anchoredSpawn("nyc-player-lane", "player", "nyc-we-n-1", 30),
        anchoredSpawn("nyc-car-1", "vehicle", "nyc-bway-s-1", 130),
        anchoredSpawn("nyc-car-2", "vehicle", "nyc-79-e-1", 60),
        anchoredSpawn("nyc-car-3", "vehicle", "nyc-we-n-1", 130),
        anchoredSpawn("nyc-cab-4", "vehicle", "nyc-amst-n-1a", 120),
        anchoredSpawn("nyc-car-5", "vehicle", "nyc-col-s-1a", 120),
        freeSpawn("nyc-ped-1", "pedestrian", -100, 12, 0),
        freeSpawn("nyc-ped-2", "pedestrian", -132, -10, 180),
        freeSpawn("nyc-ped-3", "pedestrian", 28, 12, 0),
        freeSpawn("nyc-ped-4", "pedestrian", 168, -12, 180),
        freeSpawn("nyc-ped-5", "pedestrian", -308, 10, 0),
        freeSpawn("nyc-cyclist-1", "cyclist", -318, -200, 0, "nyc-we-n-1"),
        freeSpawn("nyc-cyclist-2", "cyclist", 38.3, -200, 0, "nyc-amst-n-1a"),
      ],
      [
        checkpoint("nyc-r1-start", "West 72nd & West End", "nyc-72-e-1", 30),
        checkpoint("nyc-r1-amst", "Amsterdam Avenue northbound", "nyc-amst-n-1a", 240),
        checkpoint("nyc-r1-86", "West 86th Street", "nyc-86-e-3", 70),
        checkpoint("nyc-r1-finish", "Columbus & 72nd", "nyc-col-s-1b", 445),
        checkpoint("nyc-r2-start", "Broadway & 72nd", "nyc-bway-n-1", 30),
        checkpoint("nyc-r2-signal", "Broadway & 79th signal", "nyc-bway-n-1", 445),
        checkpoint("nyc-r2-finish", "West 86th & Broadway", "nyc-86-w-4", 180),
        checkpoint("nyc-r3-start", "West End & 72nd", "nyc-we-n-1", 30),
        checkpoint("nyc-r3-mid", "West End & 79th", "nyc-we-n-2", 240),
        checkpoint("nyc-r3-finish", "West 86th & Central Park West", "nyc-86-e-2", 145),
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
      worldSize: point(1500, 300),
      roadWidth: 9,
      shoulderWidth: 2,
      roadSurfaces: [
        roadSurface("uk-roundabout", [ukNodes.n.position, point(13, 31.4), point(24, 24), point(31.4, 13), ukNodes.e.position, point(31.4, -13), point(24, -24), point(13, -31.4), ukNodes.s.position, point(-13, -31.4), point(-24, -24), point(-31.4, -13), ukNodes.w.position, point(-31.4, 13), point(-24, 24), point(-13, 31.4), ukNodes.n.position], 7.2, ["uk-rb-n-e", "uk-rb-e-s", "uk-rb-s-w", "uk-rb-w-n"], "roundabout"),
        roadSurface("uk-north-approach", [ukNodes.n.position, ukNodes.no.position], 7.2, ["uk-entry-north", "uk-exit-north"], "standard", [roadMarking("uk-north-centre", "centre_dashed", [ukNodes.n.position, ukNodes.no.position], "white")]),
        roadSurface("uk-east-approach", [ukNodes.e.position, ukNodes.eo.position], 7.2, ["uk-entry-east", "uk-exit-east"], "standard", [roadMarking("uk-east-centre", "centre_dashed", [ukNodes.e.position, ukNodes.eo.position], "white")]),
        roadSurface("uk-south-approach", [ukNodes.s.position, ukNodes.so.position], 7.2, ["uk-entry-south", "uk-exit-south"], "standard", [roadMarking("uk-south-centre", "centre_dashed", [ukNodes.s.position, ukNodes.so.position], "white")]),
        roadSurface("uk-west-approach", [ukNodes.w.position, ukNodes.wo.position], 7.2, ["uk-entry-west", "uk-exit-west"], "standard", [roadMarking("uk-west-centre", "centre_dashed", [ukNodes.w.position, ukNodes.wo.position], "white")]),
        roadSurface("uk-dual-carriageway", [ukNodes.no.position, point(350, 118), ukNodes.ne.position], 7.4, ["uk-dual-n-east", "uk-dual-n-east-pass"], "standard", [
          roadMarking("uk-dual-divider", "lane_dashed", [ukNodes.no.position, point(350, 118), ukNodes.ne.position], "white"),
          roadMarking("uk-dual-left-edge", "edge_solid", [point(0, 121.7), point(350, 121.7), point(700, 121.7)], "white"),
          roadMarking("uk-dual-right-edge", "edge_solid", [point(0, 114.3), point(350, 114.3), point(700, 114.3)], "white"),
        ]),
        roadSurface("uk-east-link", [ukNodes.ne.position, point(700, 70), point(700, 30), point(600, -10), point(450, -30), point(300, -25), point(200, -10), ukNodes.eo.position], 7.2, ["uk-east-north"]),
        roadSurface("uk-oldbrook-loop", [ukNodes.so.position, point(-65, -118), point(-130, -60), ukNodes.wo.position], 7.2, ["uk-south-west", "uk-west-south"]),
        roadSurface("uk-westgrid", [ukNodes.wo.position, ukNodes.wgo.position], 7.2, ["uk-westgrid-out", "uk-westgrid-in"], "standard", [roadMarking("uk-westgrid-centre", "centre_dashed", [ukNodes.wo.position, ukNodes.wgo.position], "white")]),
        ukWestLoop.surface,
      ],
      blocks: [
        { id: "uk-oldbrook", center: point(-78, 72), size: point(90, 72), heightRange: [5, 12], density: 0.55, material: "brick" },
        { id: "uk-retail", center: point(84, -72), size: point(96, 70), heightRange: [6, 14], density: 0.4, material: "concrete" },
      ],
      servicePoints: [
        // Anchored on the far-side lane of a left-hand-drive approach, so the
        // lot clears the full carriageway plus a 2 m shoulder. Nudged one metre
        // up the approach to keep its near corner off the south split's apron.
        { id: "mk-gas", kind: "gas_station", anchor: { laneId: "uk-entry-south", distanceAlongM: 23 }, footprint: point(14, 9), label: "Grafton Fuel", setbackM: 19 },
      ],
      gigVenues: [
        { id: "mk-v1", kind: "shop", anchor: { laneId: "uk-dual-n-east", distanceAlongM: 48 }, footprint: point(16, 12), name: "Grafton Retail Park" },
        { id: "mk-v2", kind: "residence", anchor: { laneId: "uk-west-south", distanceAlongM: 48 }, footprint: point(14, 12), name: "Oldbrook Houses" },
        { id: "mk-v3", kind: "restaurant", anchor: { laneId: "uk-exit-south", distanceAlongM: 46 }, footprint: point(14, 10), name: "South Grafton Kitchen" },
        { id: "mk-v4", kind: "office", anchor: { laneId: "uk-entry-south", distanceAlongM: 68 }, footprint: point(16, 14), name: "Midsummer Office" },
      ],
      landmarks: [
        // The island must sit fully inside the roundabout's inner kerb, not
        // cover the circulating lane at the cardinal approaches.
        { id: "uk-roundabout-green", kind: "park", center: point(0, 0), size: point(32, 32), color: "#608b4e" },
        { id: "uk-station-sign", kind: "station", center: point(82, 82), size: point(15, 8), color: "#d64045" },
        { id: "uk-retail-parade", kind: "shops", center: point(84, -88), size: point(30, 18), color: "#c9a24b" },
        { id: "uk-oldbrook-green", kind: "park", center: point(-95, 95), size: point(44, 30), color: "#5f9a4e" },
        ukWestLoop.island,
      ],
    },
    laneGraph: graph(
      [...Object.values(ukNodes), ukWestLoop.farNode],
      [...ukLanes, ...ukWestLoop.lanes],
      [
        control("uk-yield-south", "yield", 0, -42, 0, ["uk-entry-south"], ["uk-roundabout-conflict"],
          [approach("uk-yield-south-approach", "uk-entry-south", 74, "yield", ["uk-roundabout-conflict"])],
          [installation("uk-yield-south-sign", -7.5, -47, 0, "roadside_pole", "yield_sign", "primary")]),
        control("uk-yield-north", "yield", 0, 42, 180, ["uk-entry-north"], ["uk-roundabout-conflict"],
          [approach("uk-yield-north-approach", "uk-entry-north", 74, "yield", ["uk-roundabout-conflict"])],
          [installation("uk-yield-north-sign", 7.5, 47, 180, "roadside_pole", "yield_sign", "primary")]),
        control("uk-yield-east", "yield", 42, 0, 270, ["uk-entry-east"], ["uk-roundabout-conflict"],
          [approach("uk-yield-east-approach", "uk-entry-east", 86, "yield", ["uk-roundabout-conflict"])],
          [installation("uk-yield-east-sign", 47, -7.5, 270, "roadside_pole", "yield_sign", "primary")]),
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
        anchoredSpawn("uk-car-2", "vehicle", "uk-dual-n-east", 108),
        // Oncoming/cross traffic on every two-way road. Total live NPCs stay
        // capped by density (npcCount); these extra anchors only guarantee the
        // player meets cars in both directions and vary the opening scene. All
        // sit >=25 m from every checkpoint so stationary-safety staging is clean.
        anchoredSpawn("uk-car-3", "vehicle", "uk-exit-north", 45),
        anchoredSpawn("uk-car-4", "vehicle", "uk-entry-north", 38),
        anchoredSpawn("uk-car-5", "vehicle", "uk-exit-east", 52),
        anchoredSpawn("uk-car-6", "vehicle", "uk-entry-east", 44),
        anchoredSpawn("uk-car-7", "vehicle", "uk-exit-west", 55),
        anchoredSpawn("uk-car-8", "vehicle", "uk-entry-west", 48),
        anchoredSpawn("uk-car-9", "vehicle", "uk-rb-e-s", 14),
        anchoredSpawn("uk-car-10", "vehicle", "uk-rb-s-w", 22),
        anchoredSpawn("uk-car-11", "vehicle", "uk-dual-n-east-pass", 300),
        anchoredSpawn("uk-car-12", "vehicle", "uk-east-north", 200),
        anchoredSpawn("uk-car-13", "vehicle", "uk-south-west", 70),
        anchoredSpawn("uk-car-14", "vehicle", "uk-west-south", 130),
        anchoredSpawn("uk-car-15", "vehicle", "uk-westgrid-in", 95),
        anchoredSpawn("uk-car-16", "vehicle", "uk-westgrid-out", 110),
        freeSpawn("uk-ped-1", "pedestrian", -104, -92, 0),
        freeSpawn("uk-ped-2", "pedestrian", 78, -58, 180),
        freeSpawn("uk-ped-3", "pedestrian", -68, 58, 0),
        freeSpawn("uk-cyclist-1", "cyclist", -98, -12, 90),
      ],
      [
        checkpoint("uk-start", "Oldbrook approach", "uk-entry-south", 22),
        checkpoint("uk-roundabout", "South Grafton Roundabout approach", "uk-entry-south", 68),
        checkpoint("uk-dual", "Dual carriageway", "uk-dual-n-east", 48),
        checkpoint("uk-finish", "Oldbrook return", "uk-west-south", 48),
        checkpoint("uk-south-finish", "South approach return", "uk-exit-south", 46),
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
      worldSize: point(680, 300),
      roadWidth: 9,
      shoulderWidth: 2,
      roadSurfaces: [
        roadSurface("fr-roundabout", [frNodes.n.position, point(-13, 31.4), point(-24, 24), point(-31.4, 13), frNodes.w.position, point(-31.4, -13), point(-24, -24), point(-13, -31.4), frNodes.s.position, point(13, -31.4), point(24, -24), point(31.4, -13), frNodes.e.position, point(31.4, 13), point(24, 24), point(13, 31.4), frNodes.n.position], 7.2, ["fr-rb-n-w", "fr-rb-w-s", "fr-rb-s-e", "fr-rb-e-n"], "roundabout"),
        roadSurface("fr-north-approach", [frNodes.n.position, frNodes.no.position], 7.2, ["fr-entry-north", "fr-exit-north"], "standard", [roadMarking("fr-north-centre", "centre_dashed", [frNodes.n.position, frNodes.no.position], "white")]),
        roadSurface("fr-east-approach", [frNodes.e.position, frNodes.eo.position], 7.2, ["fr-entry-east", "fr-exit-east"], "standard", [roadMarking("fr-east-centre", "centre_dashed", [frNodes.e.position, frNodes.eo.position], "white")]),
        roadSurface("fr-south-approach", [frNodes.s.position, frNodes.so.position], 7.2, ["fr-entry-south", "fr-exit-south"], "standard", [roadMarking("fr-south-centre", "centre_dashed", [frNodes.s.position, frNodes.so.position], "white")]),
        roadSurface("fr-west-approach", [frNodes.w.position, frNodes.wo.position], 7.2, ["fr-entry-west", "fr-exit-west"], "standard", [roadMarking("fr-west-centre", "centre_dashed", [frNodes.w.position, frNodes.wo.position], "white")]),
        roadSurface("fr-south-east-road", [frNodes.so.position, point(53, -99), point(94, -79), frNodes.eo.position], 7.4, ["fr-south-east", "fr-south-east-pass"], "standard", [roadMarking("fr-south-east-divider", "lane_dashed", [frNodes.so.position, point(53, -99), point(94, -79), frNodes.eo.position], "white")]),
        roadSurface("fr-east-south-road", [frNodes.eo.position, point(150, -42), point(150, -110), point(104, -130), point(20, -130), frNodes.so.position], 7.2, ["fr-east-south"]),
        roadSurface("fr-north-west-road", [frNodes.no.position, point(-80, 76), frNodes.wo.position], 7.2, ["fr-north-west"]),
        roadSurface("fr-westgrid", [frNodes.wo.position, frNodes.wgo.position], 7.2, ["fr-westgrid-out", "fr-westgrid-in"], "standard", [roadMarking("fr-westgrid-centre", "centre_dashed", [frNodes.wo.position, frNodes.wgo.position], "white")]),
        frWestLoop.surface,
      ],
      blocks: [
        // Keep compact scenery beside the two curved links; neither block may
        // occupy a driving surface.
        { id: "fr-coquelles", center: point(-88, 104), size: point(56, 20), heightRange: [5, 13], density: 0.45, material: "stucco" },
        { id: "fr-commercial", center: point(118, -104), size: point(28, 28), heightRange: [7, 16], density: 0.38, material: "pale-concrete" },
      ],
      servicePoints: [
        // Moved 10 m further up the approach: at the old anchor the lot's far
        // corner sat astride the Coquelles link that peels off south-east, so
        // the forecourt read as paved-over road. Up here the link is a couple
        // of metres clear and the lot only has the south approach to meet.
        { id: "fr-gas", kind: "gas_station", anchor: { laneId: "fr-entry-south", distanceAlongM: 32 }, footprint: point(14, 9), label: "Coquelles Carburant", setbackM: 15.6 },
      ],
      gigVenues: [
        { id: "fr-v1", kind: "shop", anchor: { laneId: "fr-north-west", distanceAlongM: 82 }, footprint: point(16, 12), name: "Cité Europe Market" },
        { id: "fr-v2", kind: "restaurant", anchor: { laneId: "fr-south-east", distanceAlongM: 70 }, footprint: point(14, 10), name: "Brasserie Coquelles" },
        { id: "fr-v3", kind: "residence", anchor: { laneId: "fr-east-south", distanceAlongM: 70 }, footprint: point(14, 12), name: "Résidence du Port" },
        { id: "fr-v4", kind: "office", anchor: { laneId: "fr-exit-north", distanceAlongM: 60 }, footprint: point(16, 14), name: "Terminal Offices" },
      ],
      landmarks: [
        { id: "fr-terminal", kind: "terminal", center: point(-96, -82), size: point(54, 32), color: "#28569a" },
        { id: "fr-roundabout-green", kind: "park", center: point(0, 0), size: point(32, 32), color: "#6d914f" },
        { id: "fr-commercial-parade", kind: "shops", center: point(124, -106), size: point(24, 14), color: "#b6803f" },
        { id: "fr-parkway-green", kind: "park", center: point(55, 75), size: point(34, 26), color: "#5f9a4e" },
        frWestLoop.island,
      ],
    },
    laneGraph: graph(
      [...Object.values(frNodes), frWestLoop.farNode],
      [...frLanes, ...frWestLoop.lanes],
      [
        control("fr-yield-south", "yield", 0, -42, 0, ["fr-entry-south"], ["fr-roundabout-conflict"],
          [approach("fr-yield-south-approach", "fr-entry-south", 74, "yield", ["fr-roundabout-conflict"])],
          [installation("fr-yield-south-sign", 8, -48, 0, "roadside_pole", "yield_sign", "primary")]),
        control("fr-yield-east", "yield", 42, 0, 270, ["fr-entry-east"], ["fr-roundabout-conflict"],
          [approach("fr-yield-east-approach", "fr-entry-east", 94, "yield", ["fr-roundabout-conflict"])],
          [installation("fr-yield-east-sign", 48, 8, 270, "roadside_pole", "yield_sign", "primary")]),
        control("fr-yield-west", "yield", -42, 0, 90, ["fr-entry-west"], ["fr-roundabout-conflict"],
          [approach("fr-yield-west-approach", "fr-entry-west", 94, "yield", ["fr-roundabout-conflict"])],
          [installation("fr-yield-west-sign", -48, -8, 90, "roadside_pole", "yield_sign", "primary")]),
        control("fr-priority-right", "yield", -74, 72, 225, ["fr-north-west"], undefined,
          [approach("fr-priority-right-approach", "fr-north-west", 82, "yield")],
          [installation("fr-priority-right-sign", -70, 65, 225, "roadside_pole", "yield_sign", "warning")]),
      ],
      [
        { id: "fr-roundabout-conflict", laneIds: ["fr-rb-n-w", "fr-rb-w-s", "fr-rb-s-e", "fr-rb-e-n"], polygon: [point(-40, -40), point(40, -40), point(40, 40), point(-40, 40)] },
        { id: "fr-coquelles-east-split-conflict", laneIds: ["fr-south-east", "fr-south-east-pass", "fr-east-south", "fr-entry-east", "fr-exit-east"], polygon: [point(126, -12), point(150, -12), point(150, 12), point(126, 12)] },
        { id: "fr-coquelles-south-split-conflict", laneIds: ["fr-south-east", "fr-south-east-pass", "fr-east-south", "fr-entry-south", "fr-exit-south"], polygon: [point(-12, -130), point(12, -130), point(12, -106), point(-12, -106)] },
      ],
      [
        anchoredSpawn("fr-player", "player", "fr-entry-south", 22),
        anchoredSpawn("fr-car-1", "vehicle", "fr-rb-s-e", 28),
        anchoredSpawn("fr-car-2", "vehicle", "fr-south-east", 59),
        // Oncoming/cross traffic on every two-way road. Live NPC count stays
        // capped by density (npcCount); these anchors only guarantee the player
        // meets cars in both directions and vary the opening scene. All sit
        // >=25 m from every checkpoint so stationary-safety staging is clean.
        anchoredSpawn("fr-car-3", "vehicle", "fr-exit-north", 30),
        anchoredSpawn("fr-car-4", "vehicle", "fr-entry-north", 50),
        anchoredSpawn("fr-car-5", "vehicle", "fr-exit-east", 45),
        anchoredSpawn("fr-car-6", "vehicle", "fr-entry-east", 40),
        anchoredSpawn("fr-car-7", "vehicle", "fr-exit-west", 45),
        anchoredSpawn("fr-car-8", "vehicle", "fr-entry-west", 50),
        anchoredSpawn("fr-car-9", "vehicle", "fr-rb-w-s", 14),
        anchoredSpawn("fr-car-10", "vehicle", "fr-rb-n-w", 20),
        anchoredSpawn("fr-car-11", "vehicle", "fr-south-east-pass", 40),
        anchoredSpawn("fr-car-12", "vehicle", "fr-east-south", 120),
        anchoredSpawn("fr-car-13", "vehicle", "fr-north-west", 40),
        anchoredSpawn("fr-car-14", "vehicle", "fr-westgrid-in", 85),
        anchoredSpawn("fr-car-15", "vehicle", "fr-westgrid-out", 100),
        freeSpawn("fr-cyclist-1", "cyclist", -74, 80, 225, "fr-north-west"),
        freeSpawn("fr-ped-1", "pedestrian", -95, 96, 180),
        freeSpawn("fr-ped-2", "pedestrian", 112, -92, 270),
        freeSpawn("fr-cyclist-2", "cyclist", -70, -70, 45),
      ],
      [
        checkpoint("fr-start", "Coquelles start", "fr-entry-south", 22),
        checkpoint("fr-roundabout", "Roundabout entry", "fr-entry-south", 68),
        checkpoint("fr-priority", "Signed local-road yield", "fr-north-west", 82),
        checkpoint("fr-finish", "Normal travel-lane checkpoint", "fr-south-east", 70),
        checkpoint("fr-speed-finish", "North approach finish", "fr-exit-north", 60),
        checkpoint("fr-local-finish", "Coquelles local-road finish", "fr-east-south", 70),
        checkpoint("fr-roundabout-finish", "South approach finish", "fr-exit-south", 46),
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
      worldSize: point(600, 420),
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
        roadSurface("jp-westhill-road", [jpNodes.h.position, jpNodes.nw2.position], 6.4, ["jp-westhill-north", "jp-westhill-south"]),
        roadSurface("jp-narrowhill-road", [jpNodes.i.position, jpNodes.nm2.position], 5.8, ["jp-narrowhill-north", "jp-narrowhill-south"], "shared_space"),
        roadSurface("jp-easthill-road", [jpNodes.j.position, jpNodes.ne2.position], 6.4, ["jp-easthill-north", "jp-easthill-south"]),
        roadSurface("jp-uptown-road", [jpNodes.nw2.position, jpNodes.nm2.position, jpNodes.ne2.position], 6.4, ["jp-uptown-east-1", "jp-uptown-east-2", "jp-uptown-west-1", "jp-uptown-west-2"]),
        roadSurface("jp-westedge-road", [jpNodes.a.position, jpNodes.g.position], 6.4, ["jp-westedge-north", "jp-westedge-south"]),
        roadSurface("jp-southrow-west", [jpNodes.a.position, jpNodes.sw.position], 6.4, ["jp-southrow-west-w", "jp-southrow-west-e"]),
        roadSurface("jp-centerrow-west", [jpNodes.g.position, jpNodes.cw.position], 6.4, ["jp-centerrow-west-w", "jp-centerrow-west-e"]),
        roadSurface("jp-northrow-west", [jpNodes.h.position, jpNodes.nw.position], 6.4, ["jp-northrow-west-w", "jp-northrow-west-e"]),
        roadSurface("jp-westside-road", [jpNodes.sw.position, jpNodes.cw.position, jpNodes.nw.position], 6.4, ["jp-westside-north-1", "jp-westside-north-2", "jp-westside-south-1", "jp-westside-south-2"]),
        roadSurface("jp-setagaya-dori", [jpNodes.ssW.position, jpNodes.ssM.position, jpNodes.ssE.position], 6.4, ["jp-dori-east-1", "jp-dori-east-2", "jp-dori-west-1", "jp-dori-west-2"], "standard", [roadMarking("jp-dori-centre", "centre_dashed", [jpNodes.ssW.position, jpNodes.ssE.position], "white")]),
        roadSurface("jp-westside-south", [jpNodes.sw.position, jpNodes.ssW.position], 6.4, ["jp-westside-south-north", "jp-westside-south-south"]),
        roadSurface("jp-shrine-road", [jpNodes.b.position, jpNodes.ssM.position], 5.8, ["jp-shrine-north", "jp-shrine-south"], "shared_space"),
        roadSurface("jp-eastside-road", [jpNodes.c.position, jpNodes.ssE.position], 6.4, ["jp-eastside-north", "jp-eastside-south"]),
      ],
      blocks: [
        { id: "jp-block-west", center: point(-70, 46), size: point(64, 40), heightRange: [5, 14], density: 0.72, material: "plaster" },
        { id: "jp-block-center", center: point(10, 46), size: point(64, 40), heightRange: [6, 18], density: 0.78, material: "tile" },
        { id: "jp-block-south", center: point(-48, -30), size: point(100, 50), heightRange: [5, 13], density: 0.7, material: "wood-plaster" },
        { id: "jp-block-north", center: point(-71, 116), size: point(72, 64), heightRange: [5, 15], density: 0.7, material: "plaster" },
        { id: "jp-block-west-lower", center: point(-186, -27), size: point(136, 72), heightRange: [5, 13], density: 0.68, material: "wood-plaster" },
        { id: "jp-block-west-upper", center: point(-186, 47), size: point(136, 44), heightRange: [6, 16], density: 0.72, material: "tile" },
        { id: "jp-block-south-west", center: point(-215, -120), size: point(70, 74), heightRange: [5, 12], density: 0.66, material: "wood-plaster" },
        { id: "jp-block-south-east", center: point(21, -120), size: point(92, 74), heightRange: [6, 14], density: 0.72, material: "plaster" },
      ],
      servicePoints: [
        // The narrow south road still needs a 17.3 m set-back because the lot
        // is anchored on the near lane. Shifted 4 m east of the old anchor so
        // the west edge clears the junction apron at jp-a rather than kissing
        // its corner.
        { id: "jp-gas", kind: "gas_station", anchor: { laneId: "jp-south-east-1", distanceAlongM: 22 }, footprint: point(12, 8), label: "Setagaya Fuel", setbackM: 17.3 },
      ],
      gigVenues: [
        { id: "jp-v1", kind: "restaurant", anchor: { laneId: "jp-narrow-north-1", distanceAlongM: 82 }, footprint: point(12, 9), name: "Gotokuji Bento" },
        { id: "jp-v2", kind: "shop", anchor: { laneId: "jp-uptown-east-2", distanceAlongM: 40 }, footprint: point(12, 9), name: "Miyanosaka Market" },
        { id: "jp-v3", kind: "residence", anchor: { laneId: "jp-north-east-2", distanceAlongM: 54 }, footprint: point(12, 10), name: "Setagaya Residence" },
        { id: "jp-v4", kind: "office", anchor: { laneId: "jp-dori-east-2", distanceAlongM: 60 }, footprint: point(14, 12), name: "Setagaya-dori Office" },
      ],
      landmarks: [
        { id: "jp-gotokuji-station", kind: "station", center: point(-14, 6), size: point(20, 9), color: "#e85e59" },
        { id: "jp-setagaya-line", kind: "railway", center: point(18, -62), size: point(5, 72), color: "#656a70" },
        // The former temple garden covered the live junction. Keep it visible
        // to the east of the street instead of placing it over the asphalt.
        { id: "jp-temple-green", kind: "park", center: point(106, 48), size: point(24, 28), color: "#527b4d" },
        // Gotokuji temple grounds (the maneki-neko cat temple) fill the
        // northern block; the Shoin shrine sits in the southern district.
        { id: "jp-gotokuji-temple", kind: "park", center: point(30, 124), size: point(62, 58), color: "#5b8a52" },
        { id: "jp-shoin-shrine", kind: "park", center: point(-148, -118), size: point(48, 44), color: "#4f7b48" },
        { id: "jp-carrot-tower", kind: "tower", center: point(60, 60), size: point(12, 12), color: "#b6553f" },
      ],
    },
    laneGraph: graph(
      Object.values(jpNodes),
      jpLanes,
      [
        control("jp-rail-signal", "railway_signal", 18, -72, 90, ["jp-south-east-2", "jp-south-west-2"], ["jp-rail-conflict"],
          [
            approach("jp-rail-eastbound-approach", "jp-south-east-2", 42, "railway", ["jp-rail-conflict"]),
            approach("jp-rail-westbound-approach", "jp-south-west-2", 48, "railway", ["jp-rail-conflict"]),
          ],
          [
            installation("jp-rail-east-crossing", 12, -77, 90, "railway_crossing", "japan_railway", "primary"),
            installation("jp-rail-west-crossing", 24, -67, 270, "railway_crossing", "japan_railway", "secondary"),
          ]),
        control("jp-stop-narrow", "stop", -30, 12, 0, ["jp-narrow-north-1"], undefined,
          [approach("jp-stop-narrow-approach", "jp-narrow-north-1", 82, "stop")],
          [installation("jp-stop-narrow-sign", -36, 10, 0, "roadside_pole", "stop_sign", "primary")]),
        control("jp-crosswalk-station", "crosswalk", -30, 18, 90, ["jp-center-west-2", "jp-narrow-north-1"], ["jp-station-conflict"],
          [
            approach("jp-station-westbound-crosswalk", "jp-center-west-2", 76, "crosswalk", ["jp-station-conflict"]),
            approach("jp-station-northbound-crosswalk", "jp-narrow-north-1", 82, "crosswalk", ["jp-station-conflict"]),
          ],
          [installation("jp-station-crosswalk-marking", -30, 18, 90, "road_marking", "crosswalk", "marking")]),
      ],
      [
        { id: "jp-rail-conflict", laneIds: ["jp-south-east-2", "jp-south-west-2"], polygon: [point(12, -80), point(24, -80), point(24, -64), point(12, -64)] },
        { id: "jp-station-conflict", laneIds: ["jp-center-west-2", "jp-narrow-north-1"], polygon: [point(-38, 10), point(-22, 10), point(-22, 26), point(-38, 26)] },
        { id: "jp-east-curve-junction-conflict", laneIds: ["jp-curve-north", "jp-curve-south", "jp-center-west-1", "jp-center-east-3"], polygon: [point(104, -26), point(120, -26), point(120, -10), point(104, -10)] },
        { id: "jp-east-neighbourhood-junction-conflict", laneIds: ["jp-center-west-1", "jp-center-east-3", "jp-junction-south", "jp-junction-north"], polygon: [point(46, 10), point(62, 10), point(62, 26), point(46, 26)] },
      ],
      [
        anchoredSpawn("jp-player", "player", "jp-south-east-1", 18),
        anchoredSpawn("jp-car-1", "vehicle", "jp-curve-north", 12),
        // Oncoming/cross traffic seeded across the enlarged network; the
        // adapter's two-way gate supplement keeps the other lanes populated.
        anchoredSpawn("jp-car-dori-e", "vehicle", "jp-dori-east-1", 60),
        anchoredSpawn("jp-car-dori-w", "vehicle", "jp-dori-west-1", 50),
        anchoredSpawn("jp-car-uptown", "vehicle", "jp-uptown-east-1", 45),
        anchoredSpawn("jp-car-uptown-w", "vehicle", "jp-uptown-west-1", 60),
        anchoredSpawn("jp-car-westside", "vehicle", "jp-westside-north-1", 40),
        anchoredSpawn("jp-car-westhill", "vehicle", "jp-westhill-south", 45),
        anchoredSpawn("jp-car-eastside", "vehicle", "jp-eastside-north", 45),
        anchoredSpawn("jp-car-southrow", "vehicle", "jp-southrow-west-e", 70),
        freeSpawn("jp-ped-1", "pedestrian", -35, 10, 0),
        freeSpawn("jp-cyclist-1", "cyclist", -30, 48, 0, "jp-narrow-north-2"),
        freeSpawn("jp-ped-uptown", "pedestrian", -71, 164, 0),
        freeSpawn("jp-ped-dori", "pedestrian", -140, -164, 90),
        freeSpawn("jp-ped-westside", "pedestrian", -256, -20, 0),
        freeSpawn("jp-ped-shrine", "pedestrian", -34, -110, 0),
        freeSpawn("jp-cyclist-uptown", "cyclist", -31.35, 120, 0, "jp-narrowhill-north"),
        freeSpawn("jp-cyclist-dori", "cyclist", -145, -166.5, 90, "jp-dori-east-1"),
      ],
      [
        checkpoint("jp-start", "Setagaya start", "jp-south-east-1", 18),
        checkpoint("jp-rail", "Setagaya Line crossing", "jp-south-east-2", 38),
        checkpoint("jp-rail-clear", "Clear of the Setagaya Line", "jp-south-east-2", 60),
        checkpoint("jp-stop", "Narrow-street stop line", "jp-narrow-north-1", 82),
        checkpoint("jp-uptown", "Uptown Miyanosaka turn", "jp-uptown-east-2", 40),
        checkpoint("jp-station", "Gotokuji station crossing", "jp-center-west-2", 76),
        checkpoint("jp-finish", "Neighbourhood finish", "jp-north-east-2", 54),
        checkpoint("jp-local-finish", "Neighbourhood street finish", "jp-center-west-3", 54),
        checkpoint("jp-west-finish", "Yamashita west-side finish", "jp-northrow-west-e", 70),
        checkpoint("jp-dori", "Setagaya-dori arterial", "jp-dori-east-2", 60),
        checkpoint("jp-hill-finish", "Miyanosaka hill finish", "jp-westhill-south", 45),
        checkpoint("jp-vru-finish", "Patient-space exercise finish", "jp-southrow-west-e", 70),
      ],
    ),
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
    startSpawnId: "nyc-player-1way",
    trafficSeed: 2101,
  },
  {
    id: "free-uk",
    countryId: "uk",
    destinationId: "uk-milton-keynes",
    mapId: "milton-keynes-oldbrook",
    title: "Free Drive — Milton Keynes",
    description: "Practise left-side roads and roundabout approaches at your own pace.",
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
    startSpawnId: "jp-player",
    trafficSeed: 2401,
  },
];

/** Fuel-tank capacity in litres (same car everywhere). */
export const TANK_CAPACITY_L = 40;

/** Fuel burned per metre travelled (~2 L/km → ~20 km on a full tank). */
export const FUEL_CONSUMPTION_L_PER_M = 0.002;

/**
 * Pump price per litre, in each country's own currency. Tuned so a full refuel
 * is affordable from the starting wallet before gig income arrives.
 */
export const FUEL_PRICE_PER_LITRE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 0.4,
  uk: 0.45,
  fr: 0.5,
  jp: 60,
};

/**
 * Delivery reward per country: base fare plus a per-metre rate over the pickup →
 * drop-off distance, in the local currency.
 */
export const GIG_FARE_BY_COUNTRY: Readonly<
  Record<CountryId, { base: number; ratePerM: number }>
> = {
  us: { base: 4, ratePerM: 0.012 },
  uk: { base: 4, ratePerM: 0.012 },
  fr: { base: 5, ratePerM: 0.014 },
  jp: { base: 600, ratePerM: 2 },
};

/**
 * Passenger fares carry a pickup premium over parcel deliveries: a higher base
 * plus a slightly steeper per-metre rate, so ferrying a rider pays better than
 * dropping a package the same distance.
 */
export const PASSENGER_FARE_BY_COUNTRY: Readonly<
  Record<CountryId, { base: number; ratePerM: number }>
> = {
  us: { base: 7, ratePerM: 0.018 },
  uk: { base: 7, ratePerM: 0.018 },
  fr: { base: 8, ratePerM: 0.02 },
  jp: { base: 1000, ratePerM: 3 },
};

/**
 * Flat fine debited when a patrol car witnesses a road violation (wrong side,
 * off-road, running a red). Deliberately modest — a couple of fares' worth — so
 * it nudges rather than punishes; the pivot away from termination means careless
 * driving should cost money, not end the run.
 */
export const FINE_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 8,
  uk: 8,
  fr: 10,
  jp: 800,
};

/** Starting cash a new (or migrated) player holds in each country's currency. */
export const STARTING_WALLET_BY_COUNTRY: Readonly<Record<CountryId, number>> = {
  us: 20,
  uk: 20,
  fr: 25,
  jp: 3000,
};

/** Formats an amount in a country's own currency, e.g. £1,250 or ¥3,000. */
export function formatMoney(amount: number, country: CountryProfile): string {
  const { symbol, minorUnits } = country.currency;
  const value = Number.isFinite(amount) ? amount : 0;
  const fixed = Math.abs(value).toFixed(minorUnits);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return `${value < 0 ? "-" : ""}${symbol}${body}`;
}

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

export function getFreeDrive(id: FreeDriveId): FreeDriveDefinition {
  const freeDrive = freeDriveById.get(id);
  if (!freeDrive) {
    throw new Error(`Unknown SideSwap free-drive scenario: ${id}`);
  }
  return freeDrive;
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

/**
 * Validates the launch tuple: the chosen free drive must belong to the exact
 * destination, country and map the player selected.
 */
export function isScenarioCompatibleWithDestination(
  scenarioId: ScenarioId,
  destinationId: DestinationId,
): boolean {
  const destination = getDestinationProfile(destinationId);
  const freeDrive = getFreeDrive(scenarioId);
  return (
    freeDrive.destinationId === destinationId &&
    freeDrive.countryId === destination.countryId &&
    freeDrive.mapId === destination.mapId
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

export function isFreeDriveId(value: string): value is FreeDriveId {
  return freeDriveById.has(value as FreeDriveId);
}

export function getPenaltyForRule(code: RuleCode): number {
  return SCORING_CONFIG.penalties[code] ?? 0;
}
