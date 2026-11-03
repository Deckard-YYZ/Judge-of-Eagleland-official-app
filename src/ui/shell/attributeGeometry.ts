import type { SidebarAttributeItem } from "./sidebarModel";
export const ATTRIBUTE_VERTICES = [
  { x: 140, y: 30 },
  { x: 20, y: 90 },
  { x: 260, y: 90 },
] as const;
/** Preview contract: exactly three independently ranged attributes, in vertex order. */
export function relativeAttributePoint(attributes: readonly SidebarAttributeItem[]) {
  const levels = attributes.map(({ value, min, max }) => (value - min) / (max - min));
  const sum = levels.reduce((total, value) => total + value, 0);
  if (sum === 0) return null;
  const proportions = levels.map((value) => value / sum);
  return {
    proportions,
    x: proportions.reduce((total, value, index) => total + value * ATTRIBUTE_VERTICES[index].x, 0),
    y: proportions.reduce((total, value, index) => total + value * ATTRIBUTE_VERTICES[index].y, 0),
  };
}

export const ATTRIBUTE_CENTER = {
  x: ATTRIBUTE_VERTICES.reduce((sum, vertex) => sum + vertex.x, 0) / 3,
  y: ATTRIBUTE_VERTICES.reduce((sum, vertex) => sum + vertex.y, 0) / 3,
};
export function attributeContour(attributes: readonly SidebarAttributeItem[]) {
  return attributes.map(({ value, min, max }, index) => {
    const level = (value - min) / (max - min);
    const vertex = ATTRIBUTE_VERTICES[index];
    return {
      x: ATTRIBUTE_CENTER.x + (vertex.x - ATTRIBUTE_CENTER.x) * level,
      y: ATTRIBUTE_CENTER.y + (vertex.y - ATTRIBUTE_CENTER.y) * level,
    };
  });
}

export const ATTRIBUTE_REGIONS = ATTRIBUTE_VERTICES.map((vertex, index) => {
  const next = ATTRIBUTE_VERTICES[(index + 1) % 3];
  const previous = ATTRIBUTE_VERTICES[(index + 2) % 3];
  return [
    vertex,
    { x: (vertex.x + next.x) / 2, y: (vertex.y + next.y) / 2 },
    ATTRIBUTE_CENTER,
    { x: (vertex.x + previous.x) / 2, y: (vertex.y + previous.y) / 2 },
  ];
});
export function attributeFills(attributes: readonly SidebarAttributeItem[]) {
  return attributes.map(({ value, min, max }, index) => {
    const scale = Math.sqrt((value - min) / (max - min));
    const vertex = ATTRIBUTE_VERTICES[index];
    return ATTRIBUTE_REGIONS[index].map((point) => ({
      x: vertex.x + (point.x - vertex.x) * scale,
      y: vertex.y + (point.y - vertex.y) * scale,
    }));
  });
}

/** Unlabelled relative-coordinate reference marks, centered across each edge. */
export const ATTRIBUTE_EDGE_TICKS = ATTRIBUTE_VERTICES.flatMap((start, edge) => {
  const end = ATTRIBUTE_VERTICES[(edge + 1) % 3];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return Array.from({ length: 4 }, (_, index) => {
    const fraction = (index + 1) / 5;
    const x = start.x + dx * fraction;
    const y = start.y + dy * fraction;
    const size = 8;
    const offsetX = (-dy / length) * (size / 2);
    const offsetY = (dx / length) * (size / 2);
    return { edge, x1: x - offsetX, y1: y - offsetY, x2: x + offsetX, y2: y + offsetY };
  });
});
