import { expect, it } from "vitest";
import { ATTRIBUTE_EDGE_TICKS } from "../../src/ui/shell/attributeGeometry";
import {
  ATTRIBUTE_VERTICES,
  ATTRIBUTE_REGIONS,
  attributeFills,
  ATTRIBUTE_CENTER,
  attributeContour,
  relativeAttributePoint,
} from "../../src/ui/shell/attributeGeometry";
const attributes = (values: number[]) =>
  values.map((value, index) => ({
    id: String(index),
    label: String(index),
    value,
    min: 0,
    max: 100,
  }));
it.each([0, 1, 2])("places isolated extreme %i at its vertex", (index) => {
  const point = relativeAttributePoint(
    attributes([0, 1, 2].map((entry) => (entry === index ? 100 : 0))),
  )!;
  expect({ x: point.x, y: point.y }).toEqual(ATTRIBUTE_VERTICES[index]);
});
it("preserves relative proportions rather than implying equal absolute intensity", () => {
  const first = relativeAttributePoint(attributes([75, 25, 50]))!;
  const second = relativeAttributePoint(attributes([30, 10, 20]))!;
  expect(first.x).toBeCloseTo(second.x);
  expect(first.y).toBeCloseTo(second.y);
  first.proportions.forEach((value, index) => expect(value).toBeCloseTo(second.proportions[index]));
});
it("does not fabricate a point for all-zero values", () => {
  expect(relativeAttributePoint(attributes([0, 0, 0]))).toBeNull();
});

it("contour treats independent endpoints without normalizing their sum", () => {
  expect(attributeContour(attributes([0, 0, 0]))).toEqual([
    ATTRIBUTE_CENTER,
    ATTRIBUTE_CENTER,
    ATTRIBUTE_CENTER,
  ]);
  const full = attributeContour(attributes([100, 100, 100]));
  full.forEach((point, index) => {
    expect(point.x).toBeCloseTo(ATTRIBUTE_VERTICES[index].x);
    expect(point.y).toBeCloseTo(ATTRIBUTE_VERTICES[index].y);
  });
  const mixed = attributeContour(attributes([100, 0, 50]));
  expect(mixed[0].y).toBeCloseTo(30);
  expect(mixed[1]).toEqual(ATTRIBUTE_CENTER);
  expect(mixed[2].x).toBeCloseTo(200);
});

const area = (points: readonly { x: number; y: number }[]) =>
  Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0),
  ) / 2;
it("fills independent regions with exact proportional areas including zero and maximum", () => {
  expect(ATTRIBUTE_REGIONS.reduce((sum, region) => sum + area(region), 0)).toBeCloseTo(
    area(ATTRIBUTE_VERTICES),
  );
  for (const values of [
    [0, 0, 0],
    [100, 100, 100],
    [75, 25, 50],
  ]) {
    attributeFills(attributes(values)).forEach((region, index) =>
      expect(area(region) / area(ATTRIBUTE_REGIONS[index])).toBeCloseTo(values[index] / 100),
    );
  }
});

it("centers perpendicular ticks across all three edges", () => {
  expect(ATTRIBUTE_EDGE_TICKS).toHaveLength(12);
  for (let edge = 0; edge < 3; edge++) {
    const start = ATTRIBUTE_VERTICES[edge],
      end = ATTRIBUTE_VERTICES[(edge + 1) % 3];
    const ticks = ATTRIBUTE_EDGE_TICKS.filter((tick) => tick.edge === edge);
    expect(ticks).toHaveLength(4);
    ticks.forEach((tick, index) => {
      const dx = tick.x2 - tick.x1,
        dy = tick.y2 - tick.y1;
      expect(dx * (end.x - start.x) + dy * (end.y - start.y)).toBeCloseTo(0);
      const fraction = (index + 1) / 5;
      expect((tick.x1 + tick.x2) / 2).toBeCloseTo(start.x + (end.x - start.x) * fraction);
      expect((tick.y1 + tick.y2) / 2).toBeCloseTo(start.y + (end.y - start.y) * fraction);
      expect(
        dx * (ATTRIBUTE_CENTER.x - tick.x1) + dy * (ATTRIBUTE_CENTER.y - tick.y1),
      ).toBeLessThan(0);
      expect(Math.hypot(dx, dy)).toBeCloseTo(8);
    });
  }
  expect(
    (ATTRIBUTE_VERTICES[2].x - ATTRIBUTE_VERTICES[1].x) /
      (ATTRIBUTE_VERTICES[1].y - ATTRIBUTE_VERTICES[0].y),
  ).toBe(4);
});
