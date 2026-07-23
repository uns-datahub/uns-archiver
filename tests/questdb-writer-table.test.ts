import assert from "node:assert/strict";
import test from "node:test";
import type { Sender } from "@questdb/nodejs-client";
import { QuestDBWriter } from "../src/writers/questDbWriter.js";

type WriterCall = [method: string, name?: string, value?: unknown];

class FakeQuestDbSender {
  readonly calls: WriterCall[] = [];

  table(name: string): this {
    this.calls.push(["table", name]);
    return this;
  }

  symbol(name: string, value: unknown): this {
    this.calls.push(["symbol", name, value]);
    return this;
  }

  booleanColumn(name: string, value: unknown): this {
    this.calls.push(["booleanColumn", name, value]);
    return this;
  }

  timestampColumn(name: string, value: unknown): this {
    this.calls.push(["timestampColumn", name, value]);
    return this;
  }

  stringColumn(name: string, value: unknown): this {
    this.calls.push(["stringColumn", name, value]);
    return this;
  }

  floatColumn(name: string, value: unknown): this {
    this.calls.push(["floatColumn", name, value]);
    return this;
  }

  intColumn(name: string, value: unknown): this {
    this.calls.push(["intColumn", name, value]);
    return this;
  }

  arrayColumn(name: string, value: unknown): this {
    this.calls.push(["arrayColumn", name, value]);
    return this;
  }

  async at(value: unknown): Promise<void> {
    this.calls.push(["at", undefined, value]);
  }

  async flush(): Promise<void> {
    this.calls.push(["flush"]);
  }

  async close(): Promise<void> {}
}

test("writes canonical object columns while preserving symbol and UoM behavior", async () => {
  const sender = new FakeQuestDbSender();
  const writer = new QuestDBWriter(sender as unknown as Sender);

  await writer.writeUnsPacket(
    {
      version: "2.0.0",
      message: {
        table: {
          time: "2026-07-19T12:00:00.000Z",
          columns: {
            state: { type: "symbol", value: "RUNNING" },
            power: { type: "double", value: 42.1, uom: "kW" },
            note: { type: "string", value: "stable" },
            optional: { type: "double", value: null },
          },
        },
      },
    } as never,
    "uns_measurements",
    "plant/line-1/equipment/main/measurements",
  );

  const stateSymbolIndex = sender.calls.findIndex(
    ([method, name]) => method === "symbol" && name === "state",
  );
  const firstFieldIndex = sender.calls.findIndex(
    ([method]) => method === "booleanColumn",
  );

  assert.ok(stateSymbolIndex >= 0);
  assert.ok(firstFieldIndex > stateSymbolIndex, "symbol columns must be written before fields");
  assert.ok(
    sender.calls.some(
      ([method, name, value]) =>
        method === "floatColumn" && name === "power" && value === 42.1,
    ),
  );
  assert.ok(
    sender.calls.some(
      ([method, name, value]) =>
        method === "stringColumn" && name === "power_uom" && value === "kW",
    ),
  );
  assert.ok(
    sender.calls.some(
      ([method, name, value]) =>
        method === "stringColumn" && name === "note" && value === "stable",
    ),
  );
  assert.equal(sender.calls.some(([, name]) => name === "optional"), false);
  assert.equal(sender.calls.at(-1)?.[0], "flush");
});
