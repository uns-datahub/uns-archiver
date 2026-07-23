import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveQuestDbTopicIdentity,
  parseQuestDbTopicTail,
} from "../src/writers/questdb-identity.js";

test("parses a direct sub-asset path into existing QuestDB identity columns", () => {
  assert.deepEqual(
    parseQuestDbTopicTail(
      "enterprise/site/area/line/furnace-1/material/main/daily-production",
    ),
    {
      topic: "enterprise/site/area/line",
      asset: "furnace-1",
      objectType: "material",
      objectId: "main",
      attribute: "daily-production",
    },
  );
});

test("parses a nested sub-asset path by keeping parent assets in topic", () => {
  assert.deepEqual(
    parseQuestDbTopicTail(
      "enterprise/site/area/line/furnace-1/zone-1/equipment/main/temperature",
    ),
    {
      topic: "enterprise/site/area/line/furnace-1",
      asset: "zone-1",
      objectType: "equipment",
      objectId: "main",
      attribute: "temperature",
    },
  );
});

test("derives topic from active UNS metadata and preserves the leaf asset", () => {
  assert.deepEqual(
    deriveQuestDbTopicIdentity(
      "enterprise/site/area/line/furnace-1/material/main/daily-production",
      {
        asset: "furnace-1",
        objectType: "material",
        objectId: "main",
        attribute: "daily-production",
      },
    ),
    {
      topic: "enterprise/site/area/line",
      asset: "furnace-1",
      objectType: "material",
      objectId: "main",
      attribute: "daily-production",
    },
  );
});

test("derives QuestDB identity for a realistic nested sub-asset path", () => {
  const fullTopic =
    "enterprise/site/area/wash-line/pump-skid-1/equipment/main/temperature";
  const expected = {
    topic: "enterprise/site/area/wash-line",
    asset: "pump-skid-1",
    objectType: "equipment",
    objectId: "main",
    attribute: "temperature",
  };

  assert.deepEqual(parseQuestDbTopicTail(fullTopic), expected);
  assert.deepEqual(
    deriveQuestDbTopicIdentity(fullTopic, {
      asset: "pump-skid-1",
      objectType: "equipment",
      objectId: "main",
      attribute: "temperature",
    }),
    expected,
  );
});

test("active metadata keeps an intermediate sub-asset in topic and only leaf in asset", () => {
  assert.deepEqual(
    deriveQuestDbTopicIdentity(
      "enterprise/site/area/wash-line/pump-skid-1/nozzle-bank-1/equipment/main/pressure",
      {
        asset: "nozzle-bank-1",
        objectType: "equipment",
        objectId: "main",
        attribute: "pressure",
      },
    ),
    {
      topic: "enterprise/site/area/wash-line/pump-skid-1",
      asset: "nozzle-bank-1",
      objectType: "equipment",
      objectId: "main",
      attribute: "pressure",
    },
  );
});

test("leaves short legacy topics untouched when identity tail is missing", () => {
  assert.deepEqual(parseQuestDbTopicTail("enterprise/site/area"), {
    topic: "enterprise/site/area",
  });
});
