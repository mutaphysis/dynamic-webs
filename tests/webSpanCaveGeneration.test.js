import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WEB_GENERATION_CONFIGURATION
} from "../scripts/simulation/webs/webConfigurationDefaults.js";

import {
  WallSpanWebGenerator
} from "../scripts/simulation/webs/WallSpanWebGenerator.js";

const LEVEL = Object.freeze({
  id: "base",
  providerMode: "base",
  elevationBand: Object.freeze({ bottom: null, top: null })
});

test("moderately skewed cave walls can generate a four-anchor span asset", () => {
  const webs = new WallSpanWebGenerator().generate({
    sceneId: "cave-scene",
    populationId: "cave-population",
    populationLabel: "cave-population",
    thicknessMultiplier: 1,
    level: LEVEL,
    generationSeed: "dynamic-webs:test:cave-span",
    gridSize: 100,
    configuration: DEFAULT_WEB_GENERATION_CONFIGURATION.spanWebs,
    random: () => 0.5,
    regionRestriction: null,
    wallSegments: [
      {
        wallId: "upper-cave-wall",
        a: { x: 100, y: 100 },
        b: { x: 500, y: 100 }
      },
      {
        wallId: "skewed-cave-wall",
        a: { x: 150, y: 180 },
        b: { x: 350, y: 526.4101615 }
      }
    ]
  });

  assert.equal(webs.length, 1);
  const span = webs[0];
  assert.equal(span.kind, "wall-span");
  assert.equal(span.spanAsset.schemaVersion, 2);
  assert.equal(span.spanAsset.warpMode, "piecewise-affine-quad");
  assert.deepEqual(span.supportingWallIds, ["skewed-cave-wall", "upper-cave-wall"]);

  const target = span.spanAsset.target;
  assert.equal(target.firstWallStart.y, target.firstWallEnd.y);
  assert.notEqual(target.secondWallStart.y, target.secondWallEnd.y);
  assert.notEqual(target.secondWallStart.x, target.secondWallEnd.x);
});

test("crossing walls skip the span instead of failing generation with a degenerate quad", () => {
  const webs = new WallSpanWebGenerator().generate({
    sceneId: "crossing-scene",
    level: LEVEL,
    generationSeed: "dynamic-webs:test:crossing-span",
    gridSize: 100,
    configuration: DEFAULT_WEB_GENERATION_CONFIGURATION.spanWebs,
    random: () => 0.5,
    regionRestriction: null,
    wallSegments: [
      { wallId: "steep-wall", a: { x: 169, y: 137 }, b: { x: -22, y: 556 } },
      { wallId: "flat-wall", a: { x: 197, y: 188 }, b: { x: -62, y: 185 } }
    ]
  });

  assert.deepEqual(webs, []);
});


import {
  WebGenerationService
} from "../scripts/simulation/webs/WebGenerationService.js";

import {
  getSceneWebPopulationConfiguration
} from "../scripts/config/sceneWebPopulationConfiguration.js";

import {
  MODULE_SETTING_KEYS,
  registerModuleSettings,
  resetModuleSettingsRegistrationForTests
} from "../scripts/config/moduleSettings.js";

test("the GM maximum-span setting gates modular passage eligibility in grid units", () => {
  const previousGame =
    globalThis.game;

  const previousCanvas =
    globalThis.canvas;

  const previousHooks =
    globalThis.Hooks;

  const registrations =
    [];

  const values =
    new Map([
      [MODULE_SETTING_KEYS.LEVEL_PROVIDER_MODE, "base"],
      [MODULE_SETTING_KEYS.MAXIMUM_SPAN_GRID_UNITS, 1.5]
    ]);

  globalThis.game = {
    release: {
      generation:
        13
    },
    version:
      "13",
    modules: {
      get() {
        return {
          active:
            false
        };
      }
    },
    user: {
      isGM:
        true
    },
    settings: {
      register(
        moduleId,
        key,
        configuration
      ) {
        registrations.push({
          moduleId,
          key,
          configuration
        });
      },
      get(
        _moduleId,
        key
      ) {
        return values.get(
          key
        );
      }
    }
  };

  globalThis.canvas = {
    scene:
      null
  };

  globalThis.Hooks = {
    on() {},
    callAll() {}
  };

  resetModuleSettingsRegistrationForTests();

  try {
    registerModuleSettings();

    const scene = {
      id:
        "span-setting-scene",
      getFlag() {
        return undefined;
      }
    };

    const generationContext = {
      sceneId:
        scene.id,
      sceneRect: {
        x:
          0,
        y:
          0,
        width:
          800,
        height:
          800,
        right:
          800,
        bottom:
          800
      },
      gridSize:
        100,
      wallSegments: [
        {
          wallId:
            "upper",
          a: {
            x:
              100,
            y:
              100
          },
          b: {
            x:
              500,
            y:
              100
          }
        },
        {
          wallId:
            "lower",
          a: {
            x:
              100,
            y:
              300
          },
          b: {
            x:
              500,
            y:
              300
          }
        }
      ]
    };

    const service =
      new WebGenerationService();

    const narrowConfiguration =
      getSceneWebPopulationConfiguration(
        scene
      );

    const narrowResult =
      service.generate(
        generationContext,
        {
          populations:
            narrowConfiguration.activePopulations
        }
      );

    assert.equal(
      narrowResult.counts.span,
      0
    );

    const maximumSpanRegistration =
      registrations.find(
        (
          entry
        ) =>
          entry.key ===
            MODULE_SETTING_KEYS.MAXIMUM_SPAN_GRID_UNITS
      );

    maximumSpanRegistration.configuration.onChange(
      2.5
    );

    const wideConfiguration =
      getSceneWebPopulationConfiguration(
        scene
      );

    const wideResult =
      service.generate(
        generationContext,
        {
          populations:
            wideConfiguration.activePopulations
        }
      );

    assert.equal(
      wideResult.counts.span,
      1
    );
  } finally {
    resetModuleSettingsRegistrationForTests();
    globalThis.game =
      previousGame;
    globalThis.canvas =
      previousCanvas;
    globalThis.Hooks =
      previousHooks;
  }
});
