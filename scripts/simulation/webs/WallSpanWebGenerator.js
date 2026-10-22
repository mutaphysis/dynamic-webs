import {
  clamp,
  createWebBlueprint,
  lerpPoint,
  normaliseVector,
  randomBetween
} from "./webGeometry.js";

import {
  OrganicRadialWebBuilder,
  createStratifiedValues,
  randomScaledIntegerInclusive
} from "./organicRadialWebGeometry.js";

import {
  WEB_BLUEPRINT_KINDS,
  createStableWebId
} from "./webBlueprintContract.js";

import {
  evaluateWebRegionRestrictionAtPoint,
  evaluateWebRegionRestrictionForStrands
} from "../../spatial/webRegionRestrictionIndex.js";

import {
  createWebSpanAssetPresentation,
  isUsableWebSpanQuad
} from "../../data/webSpanAssetCatalog.js";

/**
 * Generate deterministic wall-to-wall webs across narrow passages.
 *
 * Detection samples structural walls, casts both local wall normals, and
 * accepts the nearest broadly compatible opposing wall within the configured
 * span. Wall pairs may be parallel, converging, diverging or moderately
 * skewed; only near-perpendicular pairs are excluded. Repeated samples for the
 * same wall pair are grouped before spacing and count limits are applied.
 */
export class WallSpanWebGenerator {
  generate({
    sceneId,
    populationId = "default",
    populationLabel = "Default Web Population",
    thicknessMultiplier = 1,
    level,
    generationSeed,
    wallSegments,
    gridSize,
    configuration,
    random,
    regionRestriction = null
  }) {
    if (
      configuration?.enabled !== true ||
      !Array.isArray(wallSegments) ||
      wallSegments.length < 2 ||
      !Number.isFinite(Number(gridSize)) ||
      Number(gridSize) <= 0 ||
      typeof random !== "function"
    ) {
      return Object.freeze([]);
    }

    const candidates =
      buildSpanCandidates({
        wallSegments,
        gridSize:
          Number(gridSize),
        configuration
      });

    const regionCompatibleCandidates = candidates
      .map((candidate) => ({
        ...candidate,
        regionEvaluation: evaluateWebRegionRestrictionAtPoint(
          regionRestriction,
          candidate.midpoint.x,
          candidate.midpoint.y
        )
      }))
      .filter((candidate) => candidate.regionEvaluation.allowed);

    return Object.freeze(
      selectSpacedCandidateValues({
        candidates: regionCompatibleCandidates,
        maximumCount:
          configuration.maximumCount,
        minimumSpacingPx:
          configuration.minimumSpacingGridUnits *
          gridSize,
        random,
        createValue: (candidate) =>
          createSpanWeb({
            candidate,
            sceneId,
            populationId,
            populationLabel,
            thicknessMultiplier,
            level,
            generationSeed,
            gridSize,
            configuration,
            random,
            regionRestriction
          })
      })
    );
  }
}

function buildSpanCandidates({
  wallSegments,
  gridSize,
  configuration
}) {
  const minimumSpanPx =
    configuration.minimumSpanGridUnits *
    gridSize;

  const maximumSpanPx =
    configuration.maximumSpanGridUnits *
    gridSize;

  const minimumWallLengthPx =
    configuration.minimumWallLengthGridUnits *
    gridSize;

  const sampleSpacingPx =
    configuration.sampleSpacingGridUnits *
    gridSize;

  const endpointInsetPx =
    configuration.endpointInsetGridUnits *
    gridSize;

  const minimumTangentCompatibilityDot =
    Math.cos(
      configuration.maximumTangentDifferenceDeg *
      Math.PI /
      180
    );

  const segments =
    wallSegments
      .map(normaliseSegment)
      .filter(Boolean)
      .filter(
        (segment) =>
          segment.length >=
          minimumWallLengthPx
      )
      .sort(
        (first, second) =>
          first.wallId.localeCompare(
            second.wallId
          )
      );

  const directionalCandidates =
    [];

  for (const source of segments) {
    const sampleParameters =
      createSampleParameters({
        length:
          source.length,
        spacingPx:
          sampleSpacingPx,
        endpointInsetPx
      });

    for (const sourceParameter of sampleParameters) {
      const sourceAnchor =
        lerpPoint(
          source.a,
          source.b,
          sourceParameter
        );

      const sourceTangent =
        source.tangent;

      const normal = {
        x:
          -sourceTangent.y,
        y:
          sourceTangent.x
      };

      for (const directionSign of [-1, 1]) {
        const rayDirection = {
          x:
            normal.x *
            directionSign,
          y:
            normal.y *
            directionSign
        };

        const hit =
          findNearestOpposingWall({
            source,
            sourceAnchor,
            rayDirection,
            segments,
            minimumSpanPx,
            maximumSpanPx,
            minimumTangentCompatibilityDot
          });

        if (!hit) {
          continue;
        }

        const minimumRequiredHalfLength =
          configuration.minimumLengthGridUnits *
          gridSize /
          2 /
          0.82;

        if (
          resolveAvailableHalfLength(
            source,
            sourceParameter
          ) <
            minimumRequiredHalfLength ||
          resolveAvailableHalfLength(
            hit.target,
            hit.targetParameter
          ) <
            minimumRequiredHalfLength
        ) {
          continue;
        }

        const alignedTargetTangent =
          alignTangent(
            sourceTangent,
            hit.target.tangent
          );

        const corridorTangent =
          normaliseVector({
            x:
              sourceTangent.x +
              alignedTargetTangent.x,
            y:
              sourceTangent.y +
              alignedTargetTangent.y
          });

        const stableCorridorTangent =
          vectorLength(corridorTangent) >
            0
            ? corridorTangent
            : sourceTangent;

        const midpoint =
          lerpPoint(
            sourceAnchor,
            hit.point,
            0.5
          );

        directionalCandidates.push({
          sourceWallId:
            source.wallId,
          targetWallId:
            hit.target.wallId,
          sourceAnchor,
          targetAnchor:
            hit.point,
          sourceParameter,
          targetParameter:
            hit.targetParameter,
          source,
          target:
            hit.target,
          corridorTangent:
            stableCorridorTangent,
          spanDirection:
            rayDirection,
          width:
            hit.distance,
          tangentDifferenceDeg:
            hit.tangentDifferenceDeg,
          midpoint
        });
      }
    }
  }

  const deduplicated =
    deduplicateDirectionalCandidates(
      directionalCandidates,
      Math.max(
        1,
        sampleSpacingPx *
        0.35
      )
    );

  return groupCorridorCandidates(
    deduplicated,
    {
      gridSize,
      configuration
    }
  );
}

function findNearestOpposingWall({
  source,
  sourceAnchor,
  rayDirection,
  segments,
  minimumSpanPx,
  maximumSpanPx,
  minimumTangentCompatibilityDot
}) {
  let nearest =
    null;

  for (const target of segments) {
    if (
      target.wallId ===
      source.wallId
    ) {
      continue;
    }

    const tangentCompatibilityDot =
      Math.abs(
        dot(
          source.tangent,
          target.tangent
        )
      );

    if (
      tangentCompatibilityDot <
      minimumTangentCompatibilityDot
    ) {
      continue;
    }

    const intersection =
      intersectRayWithSegment({
        origin:
          sourceAnchor,
        direction:
          rayDirection,
        maximumDistance:
          maximumSpanPx,
        segment:
          target
      });

    if (
      !intersection ||
      intersection.distance <
        minimumSpanPx ||
      intersection.distance >
        maximumSpanPx
    ) {
      continue;
    }

    if (
      !nearest ||
      intersection.distance <
        nearest.distance
    ) {
      nearest = {
        ...intersection,
        target,
        tangentDifferenceDeg:
          Math.acos(
            clamp(
              tangentCompatibilityDot,
              -1,
              1
            )
          ) *
          180 /
          Math.PI
      };
    }
  }

  return nearest;
}

function intersectRayWithSegment({
  origin,
  direction,
  maximumDistance,
  segment
}) {
  const segmentVector = {
    x:
      segment.b.x -
      segment.a.x,
    y:
      segment.b.y -
      segment.a.y
  };

  const denominator =
    cross(
      direction,
      segmentVector
    );

  if (
    Math.abs(denominator) <
    0.000001
  ) {
    return null;
  }

  const originToSegment = {
    x:
      segment.a.x -
      origin.x,
    y:
      segment.a.y -
      origin.y
  };

  const rayParameter =
    cross(
      originToSegment,
      segmentVector
    ) /
    denominator;

  const targetParameter =
    cross(
      originToSegment,
      direction
    ) /
    denominator;

  if (
    rayParameter <=
      0.000001 ||
    rayParameter >
      maximumDistance ||
    targetParameter <
      -0.000001 ||
    targetParameter >
      1.000001
  ) {
    return null;
  }

  return {
    point: {
      x:
        origin.x +
        direction.x *
        rayParameter,
      y:
        origin.y +
        direction.y *
        rayParameter
    },
    distance:
      rayParameter,
    targetParameter:
      clamp(
        targetParameter,
        0,
        1
      )
  };
}

function deduplicateDirectionalCandidates(
  candidates,
  quantisationPx
) {
  const byKey =
    new Map();

  for (const candidate of candidates) {
    const wallIds =
      [
        candidate.sourceWallId,
        candidate.targetWallId
      ].sort();

    const key =
      [
        ...wallIds,
        Math.round(
          candidate.midpoint.x /
          quantisationPx
        ),
        Math.round(
          candidate.midpoint.y /
          quantisationPx
        )
      ].join(":");

    const existing =
      byKey.get(key);

    if (
      !existing ||
      candidate.width <
        existing.width
    ) {
      byKey.set(
        key,
        candidate
      );
    }
  }

  return Array.from(
    byKey.values()
  );
}

function groupCorridorCandidates(
  candidates,
  {
    gridSize,
    configuration
  }
) {
  const groups =
    new Map();

  for (const candidate of candidates) {
    const wallIds =
      [
        candidate.sourceWallId,
        candidate.targetWallId
      ].sort();

    const key =
      wallIds.join(":");

    const group =
      groups.get(key) ??
      [];

    group.push(
      candidate
    );

    groups.set(
      key,
      group
    );
  }

  const groupedCandidates =
    [];

  for (const [key, group] of groups.entries()) {
    group.sort(
      (first, second) => {
        if (
          first.midpoint.x !==
          second.midpoint.x
        ) {
          return first.midpoint.x -
            second.midpoint.x;
        }

        return first.midpoint.y -
          second.midpoint.y;
      }
    );

    const representative =
      group[
        Math.floor(
          group.length /
          2
        )
      ];

    const averageWidth =
      group.reduce(
        (total, candidate) =>
          total +
          candidate.width,
        0
      ) /
      group.length;

    const availableTotalLength =
      2 *
      Math.min(
        resolveAvailableHalfLength(
          representative.source,
          representative.sourceParameter
        ) *
          0.82,
        resolveAvailableHalfLength(
          representative.target,
          representative.targetParameter
        ) *
          0.82
      );

    const averageLengthToSpanRatio =
      (
        configuration.minimumLengthToSpanRatio +
        configuration.maximumLengthToSpanRatio
      ) /
      2;

    const estimatedLength =
      Math.min(
        availableTotalLength,
        clamp(
          averageWidth *
            averageLengthToSpanRatio,
          configuration.minimumLengthGridUnits *
            gridSize,
          configuration.maximumLengthGridUnits *
            gridSize
        )
      );

    groupedCandidates.push({
      ...representative,
      corridorKey:
        key,
      corridorSampleCount:
        group.length,
      averageWidth,
      estimatedHalfLength:
        estimatedLength /
        2
    });
  }

  return groupedCandidates.sort(
    (first, second) => {
      if (
        first.averageWidth !==
        second.averageWidth
      ) {
        return first.averageWidth -
          second.averageWidth;
      }

      return first.corridorKey.localeCompare(
        second.corridorKey
      );
    }
  );
}

function selectSpacedCandidateValues({
  candidates,
  maximumCount,
  minimumSpacingPx,
  random,
  createValue
}) {
  const scored =
    candidates
      .map(
        (candidate) => ({
          candidate,
          score:
            candidate.averageWidth +
            random() *
            Math.max(
              1,
              candidate.averageWidth *
              0.02
            )
        })
      )
      .sort(
        (first, second) => {
          if (
            first.score !==
            second.score
          ) {
            return first.score -
              second.score;
          }

          return first.candidate.corridorKey.localeCompare(
            second.candidate.corridorKey
          );
        }
      );

  const selected =
    [];

  for (const entry of scored) {
    if (
      selected.length >=
      maximumCount
    ) {
      break;
    }

    const tooClose =
      selected.some(
        (selectedEntry) => {
          const candidate = selectedEntry.candidate;
          const centreDistance =
            Math.hypot(
              candidate.midpoint.x -
                entry.candidate.midpoint.x,
              candidate.midpoint.y -
                entry.candidate.midpoint.y
            );

          const footprintSpacing =
            candidate.estimatedHalfLength +
            entry.candidate.estimatedHalfLength +
            minimumSpacingPx *
              0.2;

          return centreDistance <
            Math.max(
              minimumSpacingPx,
              footprintSpacing
            );
        }
      );

    if (!tooClose) {
      const value = createValue(entry.candidate);
      if (!value) continue;

      selected.push({
        candidate: entry.candidate,
        value
      });
    }
  }

  return selected.map((entry) => entry.value);
}

function createSpanWeb({
  candidate,
  sceneId,
  populationId,
  populationLabel,
  thicknessMultiplier,
  level,
  generationSeed,
  gridSize,
  configuration,
  random,
  regionRestriction
}) {
  const minimumLengthPx =
    configuration.minimumLengthGridUnits *
    gridSize;

  const maximumLengthPx =
    configuration.maximumLengthGridUnits *
    gridSize;

  const sourceAvailable =
    resolveAvailableHalfLength(
      candidate.source,
      candidate.sourceParameter
    );

  const targetAvailable =
    resolveAvailableHalfLength(
      candidate.target,
      candidate.targetParameter
    );

  const maximumAvailableLength =
    2 *
    Math.min(
      sourceAvailable *
        0.82,
      targetAvailable *
        0.82
    );

  const desiredLength =
    clamp(
      candidate.width *
      randomBetween(
        random,
        configuration.minimumLengthToSpanRatio,
        configuration.maximumLengthToSpanRatio
      ),
      minimumLengthPx,
      maximumLengthPx
    );

  const totalLength =
    Math.min(
      desiredLength,
      maximumAvailableLength
    );

  const sharedHalfLength =
    totalLength /
    2;

  const tangent =
    candidate.corridorTangent;

  const spanDirection =
    normaliseVector({
      x:
        candidate.targetAnchor.x -
        candidate.sourceAnchor.x,
      y:
        candidate.targetAnchor.y -
        candidate.sourceAnchor.y
    });

  const detailScale =
    maximumLengthPx >
      minimumLengthPx
      ? clamp(
        (
          totalLength -
          minimumLengthPx
        ) /
        (
          maximumLengthPx -
          minimumLengthPx
        ),
        0,
        1
      )
      : 1;

  const sourceHalfLength =
    sharedHalfLength *
    randomBetween(
      random,
      0.82,
      1
    );

  const targetHalfLength =
    sharedHalfLength *
    randomBetween(
      random,
      0.78,
      1
    );

  const sourceAnchorCount =
    randomScaledIntegerInclusive(
      random,
      configuration.minimumAnchorCountPerSide,
      configuration.maximumAnchorCountPerSide,
      detailScale
    );

  const targetAnchorCount =
    randomScaledIntegerInclusive(
      random,
      configuration.minimumAnchorCountPerSide,
      configuration.maximumAnchorCountPerSide,
      detailScale
    );

  const sourceAnchors =
    createIrregularWallAnchors({
      segment:
        candidate.source,
      centreParameter:
        candidate.sourceParameter,
      corridorTangent:
        tangent,
      halfLength:
        sourceHalfLength,
      count:
        sourceAnchorCount,
      side:
        "source",
      random
    });

  const targetAnchors =
    createIrregularWallAnchors({
      segment:
        candidate.target,
      centreParameter:
        candidate.targetParameter,
      corridorTangent:
        tangent,
      halfLength:
        targetHalfLength,
      count:
        targetAnchorCount,
      side:
        "target",
      random
    });

  const hub = {
    x:
      candidate.midpoint.x +
      tangent.x *
        randomBetween(
          random,
          -sharedHalfLength *
            configuration.hubTangentOffsetFraction,
          sharedHalfLength *
            configuration.hubTangentOffsetFraction
        ) +
      spanDirection.x *
        randomBetween(
          random,
          -candidate.width *
            configuration.hubSpanOffsetFraction,
          candidate.width *
            configuration.hubSpanOffsetFraction
        ),

    y:
      candidate.midpoint.y +
      tangent.y *
        randomBetween(
          random,
          -sharedHalfLength *
            configuration.hubTangentOffsetFraction,
          sharedHalfLength *
            configuration.hubTangentOffsetFraction
        ) +
      spanDirection.y *
        randomBetween(
          random,
          -candidate.width *
            configuration.hubSpanOffsetFraction,
          candidate.width *
            configuration.hubSpanOffsetFraction
        )
  };

  const builder =
    new OrganicRadialWebBuilder({
      gridSize,
      configuration,
      random
    });

  const geometry =
    builder.build({
      hub,
      anchors:
        [
          ...sourceAnchors,
          ...targetAnchors
        ],
      closedCaptureRings:
        true,
      supportGroups:
        [
          {
            id:
              "source",
            anchors:
              sourceAnchors
          },
          {
            id:
              "target",
            anchors:
              targetAnchors
          }
        ],
      detailScale
    });

  const regionEvaluation = evaluateWebRegionRestrictionForStrands(
    regionRestriction,
    geometry.strands
  );

  if (!regionEvaluation.allowed) return null;

  const wallIds =
    [
      candidate.sourceWallId,
      candidate.targetWallId
    ].sort();

  const coordinateKey =
    `${Math.round(candidate.midpoint.x)}-${Math.round(candidate.midpoint.y)}`;

  const sourceKey =
    `${candidate.corridorKey}:${coordinateKey}`;

  const sourcePerch =
    sourceAnchors[
      Math.floor(
        sourceAnchors.length /
        2
      )
    ]?.point ??
    candidate.sourceAnchor;

  const targetPerch =
    targetAnchors[
      Math.floor(
        targetAnchors.length /
        2
      )
    ]?.point ??
    candidate.targetAnchor;

  const sourceAssetEdge =
    createOrderedWallEdge({
      segment:
        candidate.source,
      centreParameter:
        candidate.sourceParameter,
      corridorTangent:
        tangent,
      halfLength:
        sourceHalfLength
    });

  const targetAssetEdge =
    createOrderedWallEdge({
      segment:
        candidate.target,
      centreParameter:
        candidate.targetParameter,
      corridorTangent:
        tangent,
      halfLength:
        targetHalfLength
    });

  // Converging or crossing walls can fold the ordered edges into a bowtie or
  // a sliver; such a pair cannot carry a span asset, so skip the candidate.
  if (
    !isUsableWebSpanQuad({
      firstWallStart:
        sourceAssetEdge.start,
      firstWallEnd:
        sourceAssetEdge.end,
      secondWallStart:
        targetAssetEdge.start,
      secondWallEnd:
        targetAssetEdge.end
    })
  ) {
    return null;
  }

  const spanAsset =
    createWebSpanAssetPresentation({
      selectionKey:
        `${generationSeed}:${sourceKey}`,
      firstWallStart:
        sourceAssetEdge.start,
      firstWallEnd:
        sourceAssetEdge.end,
      secondWallStart:
        targetAssetEdge.start,
      secondWallEnd:
        targetAssetEdge.end,
      targetLengthPx:
        (
          sourceAssetEdge.length +
          targetAssetEdge.length
        ) /
        2,
      targetSpanPx:
        (
          pointDistance(
            sourceAssetEdge.start,
            targetAssetEdge.start
          ) +
          pointDistance(
            sourceAssetEdge.end,
            targetAssetEdge.end
          )
        ) /
        2
    });

  return createWebBlueprint({
    id:
      createStableWebId({
        sceneId,
        populationId,
        levelId:
          level.id,
        kind:
          WEB_BLUEPRINT_KINDS.WALL_SPAN,
        sourceKey
      }),
    sceneId,
    populationId,
    populationLabel,
    thicknessMultiplier,
    levelProviderMode:
      level.providerMode,
    levelId:
      level.id,
    elevationBand:
      level.elevationBand,
    seed:
      generationSeed,
    sourceKey,
    kind:
      WEB_BLUEPRINT_KINDS.WALL_SPAN,
    hub,
    strands:
      geometry.strands,
    regionIds: regionEvaluation.regionIds,
    regionTags: regionEvaluation.regionTags,
    perches:
      [
        {
          id:
            "hub",
          x:
            hub.x,
          y:
            hub.y,
          rotation:
            Math.atan2(
              tangent.y,
              tangent.x
            )
        },
        {
          id:
            "wall-a",
          x:
            sourcePerch.x,
          y:
            sourcePerch.y,
          rotation:
            Math.atan2(
              tangent.y,
              tangent.x
            )
        },
        {
          id:
            "wall-b",
          x:
            targetPerch.x,
          y:
            targetPerch.y,
          rotation:
            Math.atan2(
              -tangent.y,
              -tangent.x
            )
        }
      ],
    supportingWallIds:
      wallIds,
    spanAsset
  });
}

function createOrderedWallEdge({
  segment,
  centreParameter,
  corridorTangent,
  halfLength
}) {
  const orientation =
    dot(
      segment.tangent,
      corridorTangent
    ) <
      0
      ? -1
      : 1;

  const parameterOffset =
    Math.max(
      0,
      Number(
        halfLength
      ) ||
      0
    ) /
    segment.length;

  const startParameter =
    clamp(
      centreParameter -
      parameterOffset *
      orientation,
      0,
      1
    );

  const endParameter =
    clamp(
      centreParameter +
      parameterOffset *
      orientation,
      0,
      1
    );

  const start =
    lerpPoint(
      segment.a,
      segment.b,
      startParameter
    );

  const end =
    lerpPoint(
      segment.a,
      segment.b,
      endParameter
    );

  return Object.freeze({
    start:
      Object.freeze(start),
    end:
      Object.freeze(end),
    length:
      pointDistance(
        start,
        end
      )
  });
}

function pointDistance(
  first,
  second
) {
  return Math.hypot(
    second.x -
      first.x,
    second.y -
      first.y
  );
}

function createIrregularWallAnchors({
  segment,
  centreParameter,
  corridorTangent,
  halfLength,
  count,
  side,
  random
}) {
  const orientation =
    dot(
      segment.tangent,
      corridorTangent
    ) <
      0
      ? -1
      : 1;

  const offsets =
    createStratifiedValues({
      count,
      minimum:
        -halfLength,
      maximum:
        halfLength,
      random
    });

  return offsets.map(
    (
      distanceOffset,
      anchorIndex
    ) => {
      const parameter =
        clamp(
          centreParameter +
          distanceOffset *
            orientation /
            segment.length,
          0,
          1
        );

      return {
        id:
          `${side}-${anchorIndex}`,
        side,
        order:
          anchorIndex,
        parameter,
        point:
          lerpPoint(
            segment.a,
            segment.b,
            parameter
          )
      };
    }
  );
}

function createSampleParameters({
  length,
  spacingPx,
  endpointInsetPx
}) {
  const inset =
    Math.min(
      Math.max(
        0,
        endpointInsetPx
      ),
      length *
      0.35
    );

  const usableLength =
    Math.max(
      0,
      length -
      inset *
      2
    );

  if (
    usableLength <=
    0
  ) {
    return [0.5];
  }

  const sampleCount =
    Math.max(
      1,
      Math.floor(
        usableLength /
        Math.max(
          1,
          spacingPx
        )
      ) +
      1
    );

  if (
    sampleCount ===
    1
  ) {
    return [0.5];
  }

  const start =
    inset /
    length;

  const end =
    1 -
    start;

  return Array.from(
    {
      length:
        sampleCount
    },
    (_entry, index) =>
      start +
      (
        end -
        start
      ) *
      index /
      (
        sampleCount -
        1
      )
  );
}

function normaliseSegment(
  segment
) {
  const a =
    normalisePoint(
      segment?.a ??
      {
        x:
          segment?.x1,
        y:
          segment?.y1
      }
    );

  const b =
    normalisePoint(
      segment?.b ??
      {
        x:
          segment?.x2,
        y:
          segment?.y2
      }
    );

  if (
    !a ||
    !b
  ) {
    return null;
  }

  const direction = {
    x:
      b.x -
      a.x,
    y:
      b.y -
      a.y
  };

  const length =
    Math.hypot(
      direction.x,
      direction.y
    );

  if (
    !Number.isFinite(length) ||
    length <=
      0
  ) {
    return null;
  }

  return {
    wallId:
      String(
        segment?.wallId ??
        segment?.id ??
        "wall"
      ),
    a,
    b,
    length,
    tangent: {
      x:
        direction.x /
        length,
      y:
        direction.y /
        length
    }
  };
}

function normalisePoint(
  point
) {
  const x =
    Number(
      point?.x
    );

  const y =
    Number(
      point?.y
    );

  return Number.isFinite(x) &&
    Number.isFinite(y)
    ? {
      x,
      y
    }
    : null;
}

function resolveAvailableHalfLength(
  segment,
  parameter
) {
  return Math.min(
    parameter *
      segment.length,
    (
      1 -
      parameter
    ) *
      segment.length
  );
}

function alignTangent(
  reference,
  candidate
) {
  return dot(
    reference,
    candidate
  ) <
    0
    ? {
      x:
        -candidate.x,
      y:
        -candidate.y
    }
    : candidate;
}

function dot(
  first,
  second
) {
  return first.x *
    second.x +
    first.y *
    second.y;
}

function cross(
  first,
  second
) {
  return first.x *
    second.y -
    first.y *
    second.x;
}

function vectorLength(
  vector
) {
  return Math.hypot(
    Number(vector?.x),
    Number(vector?.y)
  );
}
