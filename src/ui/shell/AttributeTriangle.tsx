import { useId } from "react";
import { useI18n } from "../i18n";
import type { SidebarAttributeItem } from "./sidebarModel";
import type { AttributeVariant, AttributeMarker } from "./attributeVariant";
import {
  ATTRIBUTE_VERTICES,
  ATTRIBUTE_EDGE_TICKS,
  ATTRIBUTE_REGIONS,
  attributeFills,
  ATTRIBUTE_CENTER,
  attributeContour,
  relativeAttributePoint,
} from "./attributeGeometry";
import "./attributeTriangle.css";
export function AttributeTriangle({
  attributes,
  variant,
  demo = false,
  marker: selectedMarker,
}: {
  attributes: readonly SidebarAttributeItem[];
  variant: AttributeVariant;
  marker?: AttributeMarker;
  demo?: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const marker = selectedMarker ?? "square";
  const patternId = useId();
  const fills = attributeFills(attributes);
  const point = relativeAttributePoint(attributes);
  const contour = attributeContour(attributes);
  return (
    <figure
      className="attribute-triangle"
      data-attribute-variant={variant}
      data-attribute-marker={marker}
    >
      {demo && (
        <figcaption>
          {t(
            selectedMarker && variant === "point"
              ? `attributes.marker.${selectedMarker}`
              : variant === "point"
                ? "attributes.demo"
                : variant === "contour"
                  ? "attributes.demoContour"
                  : "attributes.demoFill",
          )}
        </figcaption>
      )}
      <svg viewBox="0 0 280 120" aria-hidden="true">
        {variant === "fill" && (
          <g className="attribute-triangle__fill">
            <defs>
              <pattern id={`${patternId}-0`} width="6" height="6" patternUnits="userSpaceOnUse">
                <path d="M0 6L6 0" stroke="currentColor" strokeWidth="1" />
              </pattern>
              <pattern id={`${patternId}-1`} width="6" height="6" patternUnits="userSpaceOnUse">
                <path d="M0 3H6" stroke="currentColor" strokeWidth="1" />
              </pattern>
              <pattern id={`${patternId}-2`} width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1" />
              </pattern>
            </defs>
            {ATTRIBUTE_REGIONS.map((region, index) => (
              <polygon
                className="attribute-triangle__region"
                key={index}
                points={region.map(({ x, y }) => `${x},${y}`).join(" ")}
              />
            ))}
            {fills.map(
              (region, index) =>
                attributes[index].value > attributes[index].min && (
                  <polygon
                    className="attribute-triangle__filled"
                    key={index}
                    fill={`url(#${patternId}-${index})`}
                    points={region.map(({ x, y }) => `${x},${y}`).join(" ")}
                  />
                ),
            )}
          </g>
        )}
        <polygon
          points={ATTRIBUTE_VERTICES.map(({ x, y }) => `${x},${y}`).join(" ")}
          className="attribute-triangle__outline"
        />
        <g className="attribute-triangle__ticks">
          {ATTRIBUTE_EDGE_TICKS.map((tick, index) => (
            <line key={index} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
          ))}
        </g>
        {ATTRIBUTE_VERTICES.map((vertex, index) => (
          <g key={attributes[index].id}>
            <rect
              className="attribute-triangle__vertex"
              x={vertex.x - 2}
              y={vertex.y - 2}
              width="4"
              height="4"
            />
            <text x={vertex.x} y={index === 0 ? 16 : 113} textAnchor="middle">
              {attributes[index].label} {formatNumber(attributes[index].value)}
            </text>
          </g>
        ))}
        {variant === "contour" && (
          <g className="attribute-triangle__contour">
            {ATTRIBUTE_VERTICES.map((vertex, index) => (
              <line
                key={index}
                x1={ATTRIBUTE_CENTER.x}
                y1={ATTRIBUTE_CENTER.y}
                x2={vertex.x}
                y2={vertex.y}
              />
            ))}
            <polygon points={contour.map(({ x, y }) => `${x},${y}`).join(" ")} />
            {contour.map((position, index) => (
              <circle key={index} cx={position.x} cy={position.y} r="3" />
            ))}
          </g>
        )}
        {variant === "point" && point && (
          <g className="attribute-triangle__point">
            {marker === "dot" ? (
              <circle cx={point.x} cy={point.y} r="4.5" />
            ) : marker === "square" ? (
              <rect x={point.x - 3} y={point.y - 3} width="6" height="6" />
            ) : (
              <rect x={point.x - 10} y={point.y - 1.75} width="20" height="3.5" />
            )}
          </g>
        )}
      </svg>
      <span className="sr-only">{t("attributes.tickHint")}</span>
      <p className="attribute-triangle__caption">
        {t(variant === "point" ? "attributes.relative" : "attributes.independent")}
      </p>
      <p className="attribute-triangle__ratio">
        {variant === "fill"
          ? t("attributes.areaHint")
          : variant === "contour"
            ? t("attributes.axisHint")
            : point
              ? point.proportions
                  .map(
                    (proportion, index) =>
                      `${attributes[index].label} ${formatNumber(proportion, { style: "percent", maximumFractionDigits: 1 })}`,
                  )
                  .join(" · ")
              : t("attributes.noRatio")}
      </p>
    </figure>
  );
}
