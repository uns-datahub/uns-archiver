export interface QuestDbTopicMetadata {
  attribute?: string;
  asset?: string;
  objectType?: string;
  objectId?: string;
}

export interface QuestDbTopicIdentity extends QuestDbTopicMetadata {
  topic: string;
}

export function normalizeQuestDbFullTopic(fullTopic: unknown): string {
  return typeof fullTopic === "string"
    ? fullTopic.replace(/\/+$/, "")
    : String(fullTopic ?? "");
}

export function parseQuestDbTopicTail(fullTopic: unknown): QuestDbTopicIdentity {
  const normalized = normalizeQuestDbFullTopic(fullTopic);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 4) {
    return { topic: normalized };
  }

  const attribute = parts[parts.length - 1];
  const objectId = parts[parts.length - 2];
  const objectType = parts[parts.length - 3];
  const asset = parts[parts.length - 4];
  const topic = parts.slice(0, parts.length - 4).join("/");

  return { topic, attribute, asset, objectType, objectId };
}

export function deriveQuestDbTopicIdentity(
  fullTopic: unknown,
  topicMeta?: QuestDbTopicMetadata,
): QuestDbTopicIdentity {
  const normalized = normalizeQuestDbFullTopic(fullTopic);
  if (!topicMeta) {
    const parsed = parseQuestDbTopicTail(normalized);
    return { ...parsed, topic: parsed.topic || normalized };
  }

  const parts = normalized.split("/").filter(Boolean);
  let drop = 0;
  if (topicMeta.attribute) drop += 1;
  if (topicMeta.objectId) drop += 1;
  if (topicMeta.objectType) drop += 1;
  if (topicMeta.asset) drop += 1;

  const topic = drop > 0 && parts.length > drop
    ? parts.slice(0, parts.length - drop).join("/")
    : normalized;

  return {
    topic,
    attribute: topicMeta.attribute,
    asset: topicMeta.asset,
    objectType: topicMeta.objectType,
    objectId: topicMeta.objectId,
  };
}
