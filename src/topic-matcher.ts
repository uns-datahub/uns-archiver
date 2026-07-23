import { AppConfig } from "@uns-kit/core/config/app-config.js";

export class TopicMatcher {
  static findStorage(config: AppConfig, topic: string) {
    for (const archiver of config.questdb.dataStorage) {
      if (this.matches(archiver.topic, topic)) {
        return archiver;
      }
    }
    return null;
  }
  /**
   * Matches a topic with a topic filter, using MQTT rules.
   * @param topicFilter The MQTT topic filter (may contain `#` or `+` wildcards).
   * @param topic The topic to test against the filter.
   * @returns `true` if the topic matches the filter, `false` otherwise.
   */
  static matches(topicFilter: string, topic: string): boolean {
    const filterSegments = topicFilter.split('/');
    const topicSegments = topic.split('/');

    for (let i = 0; i < filterSegments.length; i++) {
      const filterSegment = filterSegments[i];

      // Match `#` wildcard
      if (filterSegment === '#') {
        return true; // `#` matches everything that follows
      }

      // Match `+` wildcard
      if (filterSegment === '+') {
        if (topicSegments[i] === undefined) {
          return false; // `+` should match exactly one level
        }
      } else {
        // Exact match required
        if (filterSegment !== topicSegments[i]) {
          return false;
        }
      }
    }

    // Ensure there are no unmatched segments in the topic
    return filterSegments.length === topicSegments.length;
  }

  /**
   * Finds the table associated with a matching topic.
   * @param config The configuration object containing topics and their associated tables.
   * @param topic The topic to match.
   * @returns The table name if a match is found, otherwise `null`.
   */
  static findTable(config: AppConfig, topic: string): string | null {
    const storage = this.findStorage(config, topic);
    return storage?.tablePrefix ?? null;
  }
}
