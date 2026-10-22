import {
  MODULE_TITLE
} from "../module/moduleConstants.js";

export const WEB_SPAN_ASSET_PRESENTATION_SCHEMA_VERSION =
  2;

export const WEB_SPAN_ASSET_VARIANT_COUNT =
  8;

/**
 * Authored texture coordinates for the two wall-running support fibres.
 * Runtime maps these four points onto the exact four generated wall anchors.
 */
const SOURCE_QUAD =
  deepFreeze({
    firstWallStart: {
      x:
        0.06,
      y:
        0.08
    },
    firstWallEnd: {
      x:
        0.94,
      y:
        0.08
    },
    secondWallStart: {
      x:
        0.06,
      y:
        0.92
    },
    secondWallEnd: {
      x:
        0.94,
      y:
        0.92
    }
  });

export const WEB_SPAN_ASSETS =
  Object.freeze(
    Array.from(
      {
        length:
          WEB_SPAN_ASSET_VARIANT_COUNT
      },
      (
        _unused,
        index
      ) =>
        createAssetRecord(
          index +
          1
        )
    )
  );

const ASSETS_BY_ID =
  new Map(
    WEB_SPAN_ASSETS.map(
      (
        asset
      ) => [
        asset.id,
        asset
      ]
    )
  );

export function getWebSpanAsset(
  assetId
) {
  return ASSETS_BY_ID.get(
    String(
      assetId ??
      ""
    ).trim()
  ) ??
    null;
}

export function selectWebSpanAsset({
  selectionKey
}) {
  if (
    WEB_SPAN_ASSETS.length ===
      0
  ) {
    return null;
  }

  const variantIndex =
    hashText(
      `${String(selectionKey ?? "span")}:variant`
    ) %
    WEB_SPAN_ASSETS.length;

  return WEB_SPAN_ASSETS[
    variantIndex
  ];
}

export function createWebSpanAssetPresentation({
  selectionKey,
  firstWallStart,
  firstWallEnd,
  secondWallStart,
  secondWallEnd,
  targetLengthPx = null,
  targetSpanPx = null
}) {
  const asset =
    selectWebSpanAsset({
      selectionKey
    });

  if (!asset) {
    return null;
  }

  const target =
    {
      firstWallStart:
        requirePoint(
          firstWallStart,
          "span asset first-wall start"
        ),
      firstWallEnd:
        requirePoint(
          firstWallEnd,
          "span asset first-wall end"
        ),
      secondWallStart:
        requirePoint(
          secondWallStart,
          "span asset second-wall start"
        ),
      secondWallEnd:
        requirePoint(
          secondWallEnd,
          "span asset second-wall end"
        )
    };

  assertUsableQuad(
    target,
    "span asset target"
  );

  const alphaUnit =
    hashText(
      `${String(selectionKey ?? "span")}:alpha`
    ) /
    0xffffffff;

  const alpha =
    asset.recommendedAlpha[0] +
    (
      asset.recommendedAlpha[1] -
      asset.recommendedAlpha[0]
    ) *
    alphaUnit;

  const firstLength =
    pointDistance(
      target.firstWallStart,
      target.firstWallEnd
    );

  const secondLength =
    pointDistance(
      target.secondWallStart,
      target.secondWallEnd
    );

  const startSpan =
    pointDistance(
      target.firstWallStart,
      target.secondWallStart
    );

  const endSpan =
    pointDistance(
      target.firstWallEnd,
      target.secondWallEnd
    );

  return deepFreeze({
    schemaVersion:
      WEB_SPAN_ASSET_PRESENTATION_SCHEMA_VERSION,
    warpMode:
      "piecewise-affine-quad",
    assetId:
      asset.id,
    modulePath:
      asset.modulePath,
    variant:
      asset.variant,
    alpha:
      clamp(
        alpha,
        0.05,
        1
      ),
    targetLengthPx:
      normalisePositiveNumber(
        targetLengthPx,
        (
          firstLength +
          secondLength
        ) /
        2
      ),
    targetSpanPx:
      normalisePositiveNumber(
        targetSpanPx,
        (
          startSpan +
          endSpan
        ) /
        2
      ),
    source:
      asset.source,
    target
  });
}

function createAssetRecord(
  variant
) {
  const variantId =
    String(
      variant
    ).padStart(
      2,
      "0"
    );

  const id =
    `span-${variantId}`;

  return deepFreeze({
    id,
    variant,
    file:
      `${id}.webp`,
    modulePath:
      `modules/dynamic-webs/assets/web-span/generated/${id}.webp`,
    recommendedAlpha:
      Object.freeze([
        1,
        1
      ]),
    tintable:
      true,
    source:
      SOURCE_QUAD
  });
}

/**
 * Whether a span quad (wall edges ordered start-to-end on both walls) is a
 * non-degenerate, non-self-intersecting quadrilateral that can be warped.
 *
 * @param {object} quad - Span quad with first/second wall start/end points.
 * @returns {boolean} True when the quad can be used as a span asset target.
 */
export function isUsableWebSpanQuad(
  quad
) {
  const points =
    [
      quad.firstWallStart,
      quad.firstWallEnd,
      quad.secondWallEnd,
      quad.secondWallStart
    ];

  const firstSignedArea =
    signedTriangleArea(
      points[0],
      points[1],
      points[2]
    );

  const secondSignedArea =
    signedTriangleArea(
      points[0],
      points[2],
      points[3]
    );

  return !(
    Math.abs(
      firstSignedArea
    ) <
      0.000001 ||
    Math.abs(
      secondSignedArea
    ) <
      0.000001 ||
    firstSignedArea *
      secondSignedArea <=
      0
  );
}

function assertUsableQuad(
  quad,
  label
) {
  if (!isUsableWebSpanQuad(quad)) {
    throw new Error(
      `${MODULE_TITLE} | ${label} quadrilateral is degenerate.`
    );
  }
}

function signedTriangleArea(
  first,
  second,
  third
) {
  return (
    (
      second.x -
      first.x
    ) *
    (
      third.y -
      first.y
    ) -
    (
      second.y -
      first.y
    ) *
    (
      third.x -
      first.x
    )
  ) /
    2;
}

function requirePoint(
  value,
  label
) {
  const x =
    Number(
      value?.x
    );

  const y =
    Number(
      value?.y
    );

  if (
    !Number.isFinite(
      x
    ) ||
    !Number.isFinite(
      y
    )
  ) {
    throw new TypeError(
      `${MODULE_TITLE} | ${label} must contain finite x and y values.`
    );
  }

  return {
    x,
    y
  };
}

function normalisePositiveNumber(
  value,
  fallback
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  ) &&
    number >
      0
    ? number
    : fallback;
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

function hashText(
  value
) {
  const text =
    String(
      value ??
      ""
    );

  let hash =
    0x811c9dc5;

  for (
    let index = 0;
    index <
      text.length;
    index +=
      1
  ) {
    hash ^=
      text.charCodeAt(
        index
      );

    hash =
      Math.imul(
        hash,
        0x01000193
      ) >>>
      0;
  }

  return hash;
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );
}

function deepFreeze(
  value
) {
  if (
    value ===
      null ||
    typeof value !==
      "object" ||
    Object.isFrozen(
      value
    )
  ) {
    return value;
  }

  for (
    const child of
    Object.values(
      value
    )
  ) {
    deepFreeze(
      child
    );
  }

  return Object.freeze(
    value
  );
}
