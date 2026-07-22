// The ambient crowd's brain: a fixed pool of walkers strolling the pavement
// rail graph inside a simulation bubble around the player. The Midtown
// Madness rule set — spawn on the pavement out of view, recycle only out of
// view, and at the bubble's edge turn round rather than vanish — is what
// keeps a small pool reading as a whole city of pedestrians. Renderer-
// agnostic on purpose: visibility arrives as an injected predicate, so the
// bubble rules are assertable in a unit test without a camera.

import {
  samplePavementEdge,
  type PavementGraph,
} from "./pavementPaths";
import { seededUnit } from "./visuals";

export interface CrowdWalker {
  edgeId: number;
  /** Arclength along the edge, within [0, lengthM]. */
  s: number;
  /** Direction of travel along the edge's arclength. */
  dir: 1 | -1;
  /** Cached segment index so resampling after a small advance is O(1). */
  segmentHint: number;
  speedMps: number;
  /** Which character model this walker wears; fixed for the pool's life so
   * the renderer's per-model instance partition never changes size. */
  readonly variant: number;
  /** Clothing tint slot; fixed for the pool's life, same reason. */
  readonly tintIndex: number;
  /** Complexion palette slot; fixed for the pool's life, same reason. */
  readonly complexionIndex: number;
  /** Hair palette slot; fixed for the pool's life, same reason. */
  readonly hairIndex: number;
  state: "walk" | "pause";
  pauseRemaining: number;
  /** True only on the step this walker was recycled to a new spot. */
  justRecycled: boolean;
  x: number;
  z: number;
  headingRad: number;
}

export interface CrowdConfig {
  readonly count: number;
  readonly seed: number;
  /** Recycled walkers land between inner and outer radius of the focus. */
  readonly innerRadiusM: number;
  readonly outerRadiusM: number;
  /** Beyond this a walker is recycled even if somehow still visible. */
  readonly recycleRadiusM: number;
  readonly minSpeedMps: number;
  readonly maxSpeedMps: number;
  /** How long a walker stands after turning at the bubble's edge. */
  readonly turnPauseSeconds: number;
  readonly modelCount: number;
  readonly tintCount: number;
  readonly complexionCount: number;
  readonly hairCount: number;
}

export interface CrowdFocus {
  readonly x: number;
  readonly z: number;
}

/** True when a disc at (x, z) of the given radius is on screen. */
export type CrowdVisibilityProbe = (x: number, z: number, radiusM: number) => boolean;

/**
 * Hair slots rotate by one full cycle of the pool rather than tracking the
 * index directly: every other slot is `index % count`, so hair would otherwise
 * be pinned to complexion for the pool's life and a crowd would show only
 * `count` of the possible pairings. Rotating by a stride coprime with the
 * palette length permutes within each cycle, so every slot is still drawn
 * exactly as often as its weight says.
 */
const HAIR_CYCLE_ROTATION = 7;

function hairSlot(index: number, hairCount: number): number {
  const count = Math.max(1, hairCount);
  return (index + Math.floor(index / count) * HAIR_CYCLE_ROTATION) % count;
}

const RESPAWN_ATTEMPTS = 12;
const JUNCTION_PAUSE_CHANCE = 0.3;
const JUNCTION_PAUSE_S = 0.3;
const WALKER_VISIBILITY_RADIUS_M = 2;

export class CrowdSim {
  readonly walkers: CrowdWalker[];
  private readonly graph: PavementGraph;
  private readonly config: CrowdConfig;
  private readonly random: () => number;
  /** Length-weighted cumulative table so spawns favour long rails. */
  private readonly cumulativeLengths: Float64Array;
  private readonly totalLength: number;
  private primed = false;

  constructor(graph: PavementGraph, config: CrowdConfig) {
    this.graph = graph;
    this.config = config;
    this.random = seededUnit(config.seed);
    this.cumulativeLengths = new Float64Array(graph.edges.length);
    let total = 0;
    for (const [index, edge] of graph.edges.entries()) {
      total += edge.lengthM;
      this.cumulativeLengths[index] = total;
    }
    this.totalLength = total;
    this.walkers = Array.from({ length: config.count }, (_, index) => ({
      edgeId: 0,
      s: 0,
      dir: 1 as const,
      segmentHint: 0,
      speedMps: config.minSpeedMps,
      variant: index % Math.max(1, config.modelCount),
      tintIndex: index % Math.max(1, config.tintCount),
      complexionIndex: index % Math.max(1, config.complexionCount),
      hairIndex: hairSlot(index, config.hairCount),
      state: "walk" as const,
      pauseRemaining: 0,
      justRecycled: false,
      x: 0,
      z: 0,
      headingRad: 0,
    }));
  }

  step(dt: number, focus: CrowdFocus, isVisible: CrowdVisibilityProbe): void {
    if (!this.graph.edges.length) return;
    if (!this.primed) {
      // The initial fill ignores visibility: people already standing on the
      // pavement when the scene fades in are exactly what a street looks
      // like. Only mid-drive recycling has to stay out of sight.
      this.primed = true;
      for (const walker of this.walkers) {
        this.respawn(walker, focus, () => false);
        walker.justRecycled = false;
      }
    }
    for (const walker of this.walkers) {
      walker.justRecycled = false;
      if (walker.state === "pause") {
        walker.pauseRemaining -= dt;
        if (walker.pauseRemaining <= 0) {
          walker.state = "walk";
          walker.pauseRemaining = 0;
        }
      } else {
        this.advance(walker, dt);
      }
      const dx = walker.x - focus.x;
      const dz = walker.z - focus.z;
      const distance = Math.hypot(dx, dz);
      if (distance > this.config.recycleRadiusM) {
        this.respawn(walker, focus, isVisible);
      } else if (distance > this.config.outerRadiusM && walker.state === "walk") {
        if (!isVisible(walker.x, walker.z, WALKER_VISIBILITY_RADIUS_M)) {
          this.respawn(walker, focus, isVisible);
        } else {
          // Walking away while watched: turn round like anyone reaching the
          // end of their street. Inbound walkers are left to wander back.
          const away =
            Math.sin(walker.headingRad) * dx + Math.cos(walker.headingRad) * dz;
          if (away > 0) {
            walker.dir = -walker.dir as 1 | -1;
            walker.headingRad += Math.PI;
            walker.state = "pause";
            walker.pauseRemaining = this.config.turnPauseSeconds;
          }
        }
      }
    }
  }

  private advance(walker: CrowdWalker, dt: number): void {
    const edge = this.graph.edges[walker.edgeId];
    walker.s += walker.dir * walker.speedMps * dt;
    if (edge.closed) {
      walker.s = ((walker.s % edge.lengthM) + edge.lengthM) % edge.lengthM;
      walker.segmentHint = 0;
    } else if (walker.s >= edge.lengthM || walker.s <= 0) {
      const nodeId = walker.s >= edge.lengthM ? edge.b : edge.a;
      walker.s = Math.min(Math.max(walker.s, 0), edge.lengthM);
      this.crossNode(walker, nodeId);
    }
    const pose = samplePavementEdge(
      this.graph.edges[walker.edgeId],
      walker.s,
      walker.segmentHint,
    );
    walker.x = pose.x;
    walker.z = pose.z;
    walker.segmentHint = pose.segmentIndex;
    walker.headingRad =
      walker.dir === 1 ? pose.headingRad : pose.headingRad + Math.PI;
  }

  private crossNode(walker: CrowdWalker, nodeId: number): void {
    const node = this.graph.nodes[nodeId];
    const candidates = node.edgeIds.filter((id) => id !== walker.edgeId);
    if (!candidates.length) {
      // A true dead end: turn round on the spot.
      walker.dir = -walker.dir as 1 | -1;
      return;
    }
    const nextId =
      candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    const next = this.graph.edges[nextId];
    walker.edgeId = nextId;
    walker.segmentHint = 0;
    if (next.closed) {
      walker.s = 0;
      walker.dir = this.random() < 0.5 ? 1 : -1;
    } else if (next.a === nodeId) {
      walker.s = 0;
      walker.dir = 1;
    } else {
      walker.s = next.lengthM;
      walker.dir = -1;
    }
    if (this.random() < JUNCTION_PAUSE_CHANCE) {
      walker.state = "pause";
      walker.pauseRemaining = JUNCTION_PAUSE_S;
    }
  }

  private respawn(
    walker: CrowdWalker,
    focus: CrowdFocus,
    isVisible: CrowdVisibilityProbe,
  ): void {
    const { innerRadiusM, outerRadiusM } = this.config;
    let bestEdge = 0;
    let bestS = 0;
    let bestScore = -1;
    for (let attempt = 0; attempt < RESPAWN_ATTEMPTS; attempt += 1) {
      const pick = this.random() * this.totalLength;
      let low = 0;
      let high = this.cumulativeLengths.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (this.cumulativeLengths[mid] < pick) low = mid + 1;
        else high = mid;
      }
      const edge = this.graph.edges[low];
      const s = this.random() * edge.lengthM;
      const pose = samplePavementEdge(edge, s);
      const distance = Math.hypot(pose.x - focus.x, pose.z - focus.z);
      const inAnnulus = distance >= innerRadiusM && distance <= outerRadiusM;
      if (inAnnulus && !isVisible(pose.x, pose.z, WALKER_VISIBILITY_RADIUS_M)) {
        bestEdge = low;
        bestS = s;
        bestScore = Number.POSITIVE_INFINITY;
        break;
      }
      // Fallback ranking: prefer far from the player, so a camera that sees
      // the whole annulus still gets its spawn as far away as possible.
      if (distance > bestScore) {
        bestScore = distance;
        bestEdge = low;
        bestS = s;
      }
    }
    walker.edgeId = bestEdge;
    walker.s = bestS;
    walker.dir = this.random() < 0.5 ? 1 : -1;
    walker.speedMps =
      this.config.minSpeedMps +
      this.random() * (this.config.maxSpeedMps - this.config.minSpeedMps);
    walker.state = "walk";
    walker.pauseRemaining = 0;
    walker.justRecycled = true;
    const pose = samplePavementEdge(this.graph.edges[bestEdge], bestS);
    walker.x = pose.x;
    walker.z = pose.z;
    walker.segmentHint = pose.segmentIndex;
    walker.headingRad =
      walker.dir === 1 ? pose.headingRad : pose.headingRad + Math.PI;
  }
}

/** Null when the map has no pavement to walk (or an empty pool is asked for). */
export function createCrowdSim(
  graph: PavementGraph,
  config: CrowdConfig,
): CrowdSim | null {
  if (!graph.edges.length || config.count <= 0) return null;
  return new CrowdSim(graph, config);
}
