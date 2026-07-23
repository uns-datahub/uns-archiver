import { NonRetryableError } from "../errors.js";

export type CanonicalTableColumn = {
  type: string;
  value: unknown;
  uom?: string;
};

export type CanonicalTableColumnEntry = [name: string, column: CanonicalTableColumn];

/**
 * Assert the canonical shape returned by @uns-kit/core 3.x parsing.
 * Legacy arrays must be normalized by UnsPacket before they reach the writer.
 */
export function canonicalTableColumnEntries(
  columns: unknown,
  tableName = "unknown",
): CanonicalTableColumnEntry[] {
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) {
    throw new NonRetryableError(
      `Table.columns must be a canonical object for table '${tableName}'`,
    );
  }

  const entries = Object.entries(columns as Record<string, unknown>);
  if (entries.length === 0) {
    throw new NonRetryableError(`Table.columns is missing or empty for table '${tableName}'`);
  }

  return entries.map(([name, rawColumn]) => {
    if (!rawColumn || typeof rawColumn !== "object" || Array.isArray(rawColumn)) {
      throw new NonRetryableError(
        `Invalid column definition '${name}' in table '${tableName}'`,
      );
    }

    const column = rawColumn as Record<string, unknown>;
    if (typeof column.type !== "string" || !("value" in column)) {
      throw new NonRetryableError(
        `Invalid column definition '${name}' in table '${tableName}'`,
      );
    }
    if (column.uom !== undefined && typeof column.uom !== "string") {
      throw new NonRetryableError(
        `Invalid UoM for column '${name}' in table '${tableName}'`,
      );
    }

    return [
      name,
      {
        type: column.type,
        value: column.value,
        ...(column.uom === undefined ? {} : { uom: column.uom }),
      },
    ];
  });
}
