import { request, gql } from "graphql-request";
import { UnsNode } from "./graphql/schema.js";
import { ConfigFile } from "@uns-kit/core/config-file.js";
import { logger } from "@uns-kit/core";
import { promises as fs } from "fs";
import path from "path";
import { CircuitBreaker, errorMessage, isRetryableNetworkError, withRetry } from "./resilience.js";

export interface UnsTopicMetadata {
  attribute?: string;
  objectId?: string;
  objectType?: string;
  asset?: string;
  dataGroup?: string;
}

const TOPIC_CACHE_FILE = path.resolve(process.cwd(), "active_topics_cache.json");
const GRAPHQL_CIRCUIT = new CircuitBreaker("uns-graphql", {
  failureThreshold: 5,
  openMs: 30000,
});

type TokenCache = {
  restBase: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;


const hasFullTopic = (node: UnsNode): node is UnsNode & { fullTopic: string } => {
  return typeof node.fullTopic === "string";
};

const mapById = (nodes: UnsNode[]) => {
  const map = new Map<number, UnsNode>();
  for (const node of nodes) {
    if (typeof node.id === "number") {
      map.set(node.id, node);
    }
  }
  return map;
};

const resolveFromAncestors = (
  start: UnsNode | undefined,
  all: Map<number, UnsNode>,
  field: "asset" | "objectId" | "objectType",
) => {
  const seen = new Set<number>();
  let current = start;
  while (current) {
    const direct = (current as any)[field] as string | null | undefined;
    if (direct) return direct;

    if (field === "asset" && current.type === "Asset" && current.unsNode) return current.unsNode;
    if (field === "objectType" && current.type === "ObjectType" && current.unsNode) return current.unsNode;
    if (field === "objectId" && current.type === "ObjectId" && current.unsNode) return current.unsNode;

    const parentId = typeof current.parent === "number" ? current.parent : undefined;
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    current = all.get(parentId);
  }
  return undefined;
};

const sanitizeTopic = (topic: string) => topic.endsWith("/") ? topic.slice(0, -1) : topic;

const deriveAttribute = (node: UnsNode, topic: string) => {
  if (node.unsNode) return node.unsNode;
  const parts = topic.split("/").filter(Boolean);
  return parts[parts.length - 1];
};

const readCache = async () => {
  try {
    const raw = await fs.readFile(TOPIC_CACHE_FILE, "utf-8");
    return JSON.parse(raw) as { topics: string[]; metaByTopic: Record<string, UnsTopicMetadata> };
  } catch {
    return null;
  }
};

const writeCache = async (payload: { topics: string[]; metaByTopic: Record<string, UnsTopicMetadata> }) => {
  try {
    await fs.writeFile(TOPIC_CACHE_FILE, JSON.stringify(payload), "utf-8");
  } catch {
    // best effort
  }
};

const decodeJwtExpMs = (token: string): number | null => {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed?.exp !== "number") return null;
    return parsed.exp * 1000;
  } catch {
    return null;
  }
};

const isTokenFresh = (expiresAtMs: number | null): boolean => {
  if (!expiresAtMs) return false;
  return Date.now() + 30_000 < expiresAtMs;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, "");

const getSetCookieHeaders = (headers: Headers): string[] => {
  const anyHeaders = headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    const setCookies = anyHeaders.getSetCookie();
    if (Array.isArray(setCookies)) {
      return setCookies.filter((value) => typeof value === "string");
    }
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
};

const extractRefreshToken = (headers: Headers): string | undefined => {
  for (const value of getSetCookieHeaders(headers)) {
    const match = value.match(/(?:^|;\s*)RefreshToken=([^;]+)/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const loginForTokens = async (
  restBase: string,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresAtMs: number }> => {
  const response = await fetchWithTimeout(
    `${restBase}/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    12_000,
  );
  if (!response.ok) {
    throw new Error(`Auth login failed (${response.status})`);
  }
  const json = (await response.json()) as { accessToken?: string };
  if (!json?.accessToken) {
    throw new Error("Auth login response missing accessToken");
  }
  return {
    accessToken: json.accessToken,
    refreshToken: extractRefreshToken(response.headers),
    expiresAtMs: decodeJwtExpMs(json.accessToken) ?? Date.now() + 5 * 60 * 1000,
  };
};

const refreshAccessToken = async (
  restBase: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresAtMs: number }> => {
  const response = await fetchWithTimeout(
    `${restBase}/auth/refresh`,
    {
      method: "POST",
      headers: {
        Cookie: `RefreshToken=${refreshToken}`,
      },
    },
    10_000,
  );
  if (!response.ok) {
    throw new Error(`Auth refresh failed (${response.status})`);
  }
  const json = (await response.json()) as { accessToken?: string };
  if (!json?.accessToken) {
    throw new Error("Auth refresh response missing accessToken");
  }
  return {
    accessToken: json.accessToken,
    refreshToken: extractRefreshToken(response.headers) ?? refreshToken,
    expiresAtMs: decodeJwtExpMs(json.accessToken) ?? Date.now() + 5 * 60 * 1000,
  };
};

const buildAuthHeaders = async (config: any): Promise<Record<string, string> | undefined> => {
  const restBaseRaw = config?.uns?.rest;
  const email = config?.uns?.email;
  const password = config?.uns?.password;
  if (typeof restBaseRaw !== "string" || typeof email !== "string" || typeof password !== "string") {
    return undefined;
  }

  const restBase = normalizeBaseUrl(restBaseRaw);
  const cacheMatchesConfig = tokenCache?.restBase === restBase && tokenCache?.email === email;
  if (cacheMatchesConfig && tokenCache && isTokenFresh(tokenCache.expiresAtMs)) {
    return { Authorization: `Bearer ${tokenCache.accessToken}` };
  }

  if (cacheMatchesConfig && tokenCache?.refreshToken) {
    const refreshToken = tokenCache.refreshToken;
    try {
      const refreshed = await withRetry(
        "Refresh UNS auth token",
        async () => await refreshAccessToken(restBase, refreshToken),
        {
          attempts: 2,
          baseDelayMs: 200,
          maxDelayMs: 1200,
          shouldRetry: isRetryableNetworkError,
          onRetry: ({ delayMs, error }) => {
            logger.warn(`Auth refresh retry in ${delayMs}ms: ${errorMessage(error)}`);
          },
        },
      );
      tokenCache = {
        restBase,
        email,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAtMs: refreshed.expiresAtMs,
      };
      return { Authorization: `Bearer ${refreshed.accessToken}` };
    } catch {
      tokenCache = null;
    }
  }

  try {
    const loggedIn = await withRetry(
      "Login for UNS auth token",
      async () => await loginForTokens(restBase, email, password),
      {
        attempts: 2,
        baseDelayMs: 200,
        maxDelayMs: 1200,
        shouldRetry: isRetryableNetworkError,
        onRetry: ({ delayMs, error }) => {
          logger.warn(`Auth login retry in ${delayMs}ms: ${errorMessage(error)}`);
        },
      },
    );
    tokenCache = {
      restBase,
      email,
      accessToken: loggedIn.accessToken,
      refreshToken: loggedIn.refreshToken,
      expiresAtMs: loggedIn.expiresAtMs,
    };
    return { Authorization: `Bearer ${loggedIn.accessToken}` };
  } catch (error) {
    logger.warn(`Continuing GraphQL request without auth token: ${errorMessage(error)}`);
    return undefined;
  }
};

export class ActiveUnsTopics {

  static async getActiveUnsTopics(): Promise<{ topics: string[]; metaByTopic: Record<string, UnsTopicMetadata> }> {
    const config = await ConfigFile.loadConfig();
    const document = gql`
    query GetUnsNodes {
      GetUnsNodes {
        id
        unsNode
        parent
        description
        type
        processName
        processVersion
        attributeTimestamp
        attributeNeedsPersistance
        attributeTags
        fullTopic
        apiDescription
        apiEndpoint
        apiMethod
        attributeType
        dataGroup
        objectType
        objectId
        asset
        apiProxyHost
        apiSwaggerEndpoint
        apiHost
      }
    }`;

    try {
      const query: any = await withRetry(
        "Load active UNS topics",
        async () => {
          const headers = await buildAuthHeaders(config);
          return await GRAPHQL_CIRCUIT.execute(
            async () => await request(config.uns.graphql, document, undefined, headers),
          );
        },
        {
          attempts: 4,
          baseDelayMs: 300,
          maxDelayMs: 3000,
          shouldRetry: (error) => {
            const status = (error as any)?.response?.status;
            if (status === 401 || status === 403) {
              tokenCache = null;
              return true;
            }
            return isRetryableNetworkError(error);
          },
          onRetry: ({ attempt, delayMs, error }) => {
            logger.warn(`GetUnsNodes attempt ${attempt} failed; retrying in ${delayMs}ms: ${errorMessage(error)}`);
          },
        },
      );
      const unsNodes: UnsNode[] | undefined = query.GetUnsNodes;
      if (!unsNodes) {
        const cached = await readCache();
        if (cached) return cached;
        throw new Error("Unable to load UNS topics from GraphQL or cache.");
      }

      const nodesById = mapById(unsNodes);

      const attributes = unsNodes
        .filter(item => item.type === "Attribute")
        .filter(hasFullTopic);

      const metaByTopic: Record<string, UnsTopicMetadata> = {};
      const topics = attributes.map(item => {
        const topic = sanitizeTopic(item.fullTopic);
        const attribute = deriveAttribute(item, topic);
        const asset = resolveFromAncestors(item, nodesById, "asset");
        const objectType = resolveFromAncestors(item, nodesById, "objectType");
        const objectId = resolveFromAncestors(item, nodesById, "objectId");
        const dataGroup = item.dataGroup ?? undefined;

        metaByTopic[topic] = { attribute, asset, objectType, objectId, dataGroup };
        return topic;
      });

      const result = { topics, metaByTopic };
      await writeCache(result);
      return result;
    } catch (err) {
      const cached = await readCache();
      if (cached) {
        logger.warn(`Using cached active topics due to GraphQL/auth error: ${errorMessage(err)}`);
        return cached;
      }
      throw err;
    }
  }
}
