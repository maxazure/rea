import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { decodeAppleDispatchMetadata } from "./AppleDispatchMetadata.js";
import { NativeMacOSProvider } from "./NativeMacOSProvider.js";
import { nativeMachoTargetForFile } from "../../tests/fixtures/nativeCommands.js";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

const base = 0x100000000n;
const fixture = (middle: "valid" | "empty" | "unmapped") => {
  const bytes = Buffer.alloc(4096);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(152, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(152, 36);
  bytes.write("__DATA", 40);
  bytes.writeBigUInt64LE(base, 56);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(4096n, 80);
  bytes.writeUInt32LE(5, 92);
  bytes.writeUInt32LE(1, 96);
  bytes.write("__objc_classlist", 104);
  bytes.writeBigUInt64LE(base + 0x200n, 136);
  bytes.writeBigUInt64LE(24n, 144);
  for (const [slot, record, ro, name] of [
    [0x200, 0x400, 0x500, 0x700],
    [0x208, 0x440, 0x580, 0x720],
    [0x210, 0x480, 0x600, 0x740],
  ] as const) {
    bytes.writeBigUInt64LE(base + BigInt(record), slot);
    bytes.writeBigUInt64LE(base + BigInt(ro), record + 32);
    bytes.writeUInt32LE(2, ro);
    bytes.writeUInt32LE(16, ro + 8);
    bytes.writeBigUInt64LE(base + BigInt(name), ro + 24);
  }
  bytes.write("KeptClass\0", 0x700);
  if (middle !== "empty") bytes.write("OtherClass\0", 0x720);
  if (middle === "unmapped") bytes.writeBigUInt64LE(base + 0x9000n, 0x208);
  bytes.write("LaterClass\0", 0x740);
  return bytes;
};
const source = { path: "fixture.macho", sha256: "a".repeat(64) };
const retained = {
  objc_classes: [{ name: "KeptClass" }, { name: "LaterClass" }],
};

describe("empty Objective-C class names", () => {
  it("retains siblings and identifies the malformed class-list entry", () => {
    const result = decodeAppleDispatchMetadata(fixture("empty"), 100, source);
    expect(result).toMatchObject(retained);
    expect(result.objc_classes).toHaveLength(2);
    expect(result.coverage).toContainEqual(
      expect.objectContaining({
        facet: "objc_class_method_ivar_metadata",
        status: "partial",
        reason: expect.stringMatching(/0x100000208.*empty/u),
        examined: 3,
        decoded: 2,
      }),
    );
  });
  it("keeps valid classes complete and unmapped entries partial", () => {
    const valid = decodeAppleDispatchMetadata(fixture("valid"), 100, source);
    expect(valid.objc_classes.map(({ name }) => name)).toEqual([
      "KeptClass",
      "OtherClass",
      "LaterClass",
    ]);
    expect(valid.coverage).toContainEqual(
      expect.objectContaining({
        facet: "objc_class_method_ivar_metadata",
        status: "complete",
      }),
    );
    const unmapped = decodeAppleDispatchMetadata(
      fixture("unmapped"),
      100,
      source,
    );
    expect(unmapped).toMatchObject(retained);
    expect(unmapped.coverage).toContainEqual(
      expect.objectContaining({
        facet: "objc_class_method_ivar_metadata",
        status: "partial",
        reason: expect.stringContaining("0x100009020"),
      }),
    );
  });
  it("preserves partial metadata through the digest-bound provider without commands", async () => {
    const directory = await createTestTempDirectory("rea-empty-class-");
    const bytes = fixture("empty");
    const path = join(directory, "fixture.macho");
    const run = async () => {
      throw new Error("Static metadata must not run a command");
    };
    await writeFile(path, bytes);
    const client = new NativeMacOSProvider({}, { run }, "darwin").createClient(
      await nativeMachoTargetForFile(path),
    );
    onTestFinished(async () => {
      expect((await client.close()).ok).toBe(true);
    });
    const result = await client.execute("inspect_native_dispatch_metadata", {
      max_records: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({ result: { result: retained } });
    expect(await readFile(path)).toEqual(bytes);
  });
});
