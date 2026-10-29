import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { expect, it } from "vitest";
import { splitIncurBuiltinArguments } from "../../../src/cliBuiltinArguments.js";
import { Parser, z } from "incur";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const registrationFixture = async () => {
  const home = await createTestTempDirectory("rea-mcp-json-");
  const bin = join(home, "bin");
  const log = join(home, "runner.jsonl");
  const script = join(home, "runner.cjs");
  await mkdir(bin);
  await writeFile(log, "");
  await writeFile(
    script,
    `require("node:fs").appendFileSync(process.env.REA_TEST_RUNNER_LOG,
JSON.stringify(process.argv.slice(2)) + "\\n");
console.log("│ ✓ Fixture {client}: fixture │");
if (process.env.REA_TEST_RUNNER_FAIL) {
  console.error('fixture failure {"not":"a result"}');
  process.exitCode = 23;
}
`,
  );
  for (const runner of ["npx", "bun", "bunx", "pnpx"])
    await writeFile(
      join(bin, process.platform === "win32" ? `${runner}.cmd` : runner),
      process.platform === "win32"
        ? `@echo off\r\n"%REA_TEST_NODE%" "%REA_TEST_RUNNER_SCRIPT%" %*\r\n`
        : `#!/bin/sh\nexec "$REA_TEST_NODE" "$REA_TEST_RUNNER_SCRIPT" "$@"\n`,
      { mode: 0o700 },
    );
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    PATH: [bin, process.env.PATH ?? ""].join(delimiter),
    REA_TEST_NODE: process.execPath,
    REA_TEST_RUNNER_SCRIPT: script,
    REA_TEST_RUNNER_LOG: log,
    npm_config_user_agent: "npm/11 node/v24.22.1",
    npm_execpath: "",
  };
  for (const key of [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "TMPDIR",
  ]) {
    environment[key] = join(home, key);
    await mkdir(environment[key]!);
  }
  return {
    home,
    log,
    environment,
    settings: join(home, ".config", "amp", "settings.json"),
  };
};

cliTest(
  "JSON registration emits one document and preserves real Amp settings",
  async ({ cli }) => {
    const fixture = await registrationFixture();
    await mkdir(join(fixture.home, ".config", "amp"), { recursive: true });
    const original = JSON.stringify({
      other: true,
      "amp.mcpServers": {
        rea: { command: "old", env: { KEEP: "value" } },
        peer: { command: "peer" },
      },
    });
    await writeFile(fixture.settings, original);
    for (const arguments_ of [
      ["mcp", "add", "--agent", "amp", "--json"],
      ["--format=json", "mcp", "add", "--agent=amp"],
      ["mcp", "--format", "json", "add", "--agent", "amp", "--full-output"],
    ]) {
      const result = await cli.run({
        arguments: [...arguments_, "--command", "fixture {server} --mcp"],
        cwd: fixture.home,
        environment: fixture.environment,
        timeoutMs: 20_000,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        name: "rea",
        command: "fixture {server} --mcp",
        agents: ["Amp"],
      });
      expect(result.stdout.split("\n")).toHaveLength(2);
      expect(result.stdout).not.toContain("\x1b");
      expect(JSON.parse(await readFile(fixture.settings, "utf8"))).toEqual({
        other: true,
        "amp.mcpServers": {
          rea: {
            command: "fixture",
            args: ["{server}", "--mcp"],
            env: { KEEP: "value" },
          },
          peer: { command: "peer" },
        },
      });
    }
    expect(await readFile(`${fixture.settings}.rea.backup`, "utf8")).toBe(
      original,
    );
    expect(await readFile(fixture.log, "utf8")).toBe("");
  },
);

cliTest(
  "JSON runner registration preserves options, results, and failure status",
  async ({ cli }) => {
    const fixture = await registrationFixture();
    for (const fail of [false, true]) {
      const result = await cli.run({
        arguments: [
          "mcp",
          "add",
          "--agent",
          "claude-code",
          "--agent",
          "cursor",
          "-c",
          "fixture {server}",
          "--no-global",
          "--json",
        ],
        cwd: fixture.home,
        environment: {
          ...fixture.environment,
          REA_TEST_RUNNER_FAIL: fail ? "1" : "",
        },
        timeoutMs: 20_000,
      });
      expect(result.exitCode, result.stderr).toBe(fail ? 1 : 0);
      expect(result.stderr).toBe("");
      const document = JSON.parse(result.stdout);
      if (fail)
        expect(document).toMatchObject({
          code: "MCP_ADD_FAILED",
          message: expect.stringContaining(
            'fixture failure {"not":"a result"}',
          ),
        });
      else
        expect(document).toEqual({
          name: "rea",
          command: "fixture {server}",
          agents: ["Fixture {client}"],
        });
    }
    const calls = (await readFile(fixture.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toEqual(
      Array.from({ length: 2 }, () => [
        "add-mcp",
        "fixture {server}",
        "--name",
        "rea",
        "-y",
        "-a",
        "claude-code",
        "-a",
        "cursor",
      ]),
    );
    await expect(access(fixture.settings)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest(
  "JSON errors before and after Amp registration remain one document",
  async ({ cli }) => {
    for (const initial of ["invalid JSON", "{}"]) {
      const fixture = await registrationFixture();
      await mkdir(join(fixture.home, ".config", "amp"), { recursive: true });
      await writeFile(fixture.settings, initial);
      const result = await cli.run({
        arguments: ["mcp", "add", "--agent", "amp", "--command", " ", "--json"],
        cwd: fixture.home,
        environment: fixture.environment,
        timeoutMs: 20_000,
      });
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(await readFile(fixture.settings, "utf8")).toBe(initial);
      expect(await readFile(fixture.log, "utf8")).toBe("");
    }
  },
);

cliTest(
  "ordinary and adjacent registration output modes retain their presentation",
  async ({ cli }) => {
    const fixture = await registrationFixture();
    for (const flags of [
      [],
      ["--full-output"],
      ["--format", "toon"],
      ["--format", "yaml"],
      ["--format", "md"],
      ["--format", "jsonl"],
    ]) {
      const result = await cli.run({
        arguments: ["mcp", "add", "--agent", "amp", ...flags],
        cwd: fixture.home,
        environment: fixture.environment,
        timeoutMs: 20_000,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "Registering MCP server...\r\x1b[K✓ Registered rea as MCP server",
      );
      expect(result.stdout).toContain("Agents can now use rea tools.");
    }
    for (const flag of ["--help", "--schema", "--version"]) {
      const result = await cli.run({
        arguments: ["mcp", "add", "--agent", "amp", flag, "--json"],
        cwd: fixture.home,
        environment: fixture.environment,
        timeoutMs: 20_000,
      });
      expect(result.exitCode).toBe(flag === "--schema" ? 1 : 0);
      expect(result.stdout).not.toContain("Registered rea");
    }
    expect(await readFile(fixture.log, "utf8")).toBe("");
  },
);

cliTest(
  "boolean global forms cannot hide JSON registration",
  async ({ cli }) => {
    const fixture = await registrationFixture();
    for (const flag of [
      "--timings",
      "--no-timings",
      "--timings=false",
      "--timings=true",
      "--timings=other",
    ]) {
      for (const position of [0, 1, 2]) {
        const arguments_ = [
          "mcp",
          "add",
          "--agent",
          "amp",
          "--command",
          "fixture-server",
          "--json",
        ];
        arguments_.splice(position, 0, flag);
        const result = await cli.run({
          arguments: arguments_,
          cwd: fixture.home,
          environment: fixture.environment,
          timeoutMs: 20_000,
        });
        expect(result.exitCode, arguments_.join(" ")).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          name: "rea",
          command: "fixture-server",
          agents: ["Amp"],
        });
      }
    }
    expect(await readFile(fixture.log, "utf8")).toBe("");
  },
);

it("timing global splitting preserves output values and the global terminator", () => {
  const cases = [
    ["--filter-output", "--no-timings", "mcp", "add"],
    ["--format", "--timings=false", "mcp", "add"],
    ["mcp", "add", "--", "--timings=false", "--no-timings", "--timings"],
    ["--command", "--timings=false", "mcp", "add"],
  ];
  for (const tokens of cases) {
    const builtinOnly = tokens.filter((_, index) => index !== 0 && index !== 1);
    const input =
      tokens[0] === "--filter-output" || tokens[0] === "--format"
        ? builtinOnly
        : tokens;
    expect(splitIncurBuiltinArguments(tokens).command).toEqual(
      Parser.parseGlobals(
        input,
        z.object({ timings: z.boolean().default(false) }),
      ).rest,
    );
  }
});
