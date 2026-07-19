import { describe, expect, it } from "vitest";
import {
  advanceGig,
  generateGig,
  gigTarget,
  pickGigKind,
} from "../app/game/gigs";

const venues = [
  { id: "a", name: "Alpha", kind: "shop", x: 0, z: 0 },
  { id: "b", name: "Beta", kind: "restaurant", x: 300, z: 0 },
  { id: "c", name: "Gamma", kind: "residence", x: 0, z: 400 },
];
const fare = { base: 4, ratePerM: 0.01 };

describe("gig generation + state machine", () => {
  it("needs at least two venues", () => {
    expect(generateGig([venues[0]], fare, "GBP", 1)).toBeNull();
  });

  it("picks two distinct venues and rewards by distance", () => {
    const gig = generateGig(venues, fare, "GBP", 7);
    expect(gig).not.toBeNull();
    expect(gig!.pickup.id).not.toBe(gig!.dropoff.id);
    expect(gig!.currencyCode).toBe("GBP");
    expect(gig!.state).toBe("enroute_pickup");
    const expected = Math.round(
      fare.base +
        fare.ratePerM *
          Math.hypot(
            gig!.pickup.x - gig!.dropoff.x,
            gig!.pickup.z - gig!.dropoff.z,
          ),
    );
    expect(gig!.reward).toBe(expected);
  });

  it("is deterministic for the same seed", () => {
    expect(generateGig(venues, fare, "GBP", 42)).toEqual(
      generateGig(venues, fare, "GBP", 42),
    );
  });

  it("advances pickup -> carrying -> delivered on proximity", () => {
    const gig = generateGig(venues, fare, "GBP", 3)!;
    expect(gigTarget(gig)).toEqual(gig.pickup);
    // Far from everything: no change.
    expect(advanceGig(gig, { x: 9999, z: 9999 }).state).toBe("enroute_pickup");
    // Near the pickup → carrying, now targeting the drop-off.
    const carrying = advanceGig(gig, { x: gig.pickup.x, z: gig.pickup.z });
    expect(carrying.state).toBe("carrying");
    expect(gigTarget(carrying)).toEqual(gig.dropoff);
    // Near the drop-off → delivered, no further target.
    const delivered = advanceGig(carrying, {
      x: gig.dropoff.x,
      z: gig.dropoff.z,
    });
    expect(delivered.state).toBe("delivered");
    expect(gigTarget(delivered)).toBeNull();
  });

  it("labels the gig kind, defaulting to delivery", () => {
    expect(generateGig(venues, fare, "GBP", 5)!.kind).toBe("delivery");
    expect(generateGig(venues, fare, "GBP", 5, "passenger")!.kind).toBe(
      "passenger",
    );
  });

  it("runs a passenger fare through the same pickup -> drop-off machine", () => {
    const gig = generateGig(venues, fare, "GBP", 8, "passenger")!;
    expect(gig.kind).toBe("passenger");
    const carrying = advanceGig(gig, { x: gig.pickup.x, z: gig.pickup.z });
    expect(carrying.state).toBe("carrying");
    const delivered = advanceGig(carrying, {
      x: gig.dropoff.x,
      z: gig.dropoff.z,
    });
    expect(delivered.state).toBe("delivered");
  });

  it("pickGigKind is deterministic and produces both kinds across seeds", () => {
    expect(pickGigKind(7)).toBe(pickGigKind(7));
    const kinds = new Set(
      Array.from({ length: 40 }, (_, index) => pickGigKind(index + 1)),
    );
    expect(kinds.has("delivery")).toBe(true);
    expect(kinds.has("passenger")).toBe(true);
  });
});
