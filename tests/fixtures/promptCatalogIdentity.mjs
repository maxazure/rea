import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { PROMPT_CONTRACTS } from "../../dist/contracts/promptContracts.js";

// Each invocation owns a fresh module graph. Change the child-only contract
// before importing catalog identity or production server composition.
const prompt = PROMPT_CONTRACTS.find(
  ({ name }) => name === "investigate_feature",
);
if (prompt === undefined) throw new Error("Expected guided prompt");
if (process.argv[2] === "objective")
  prompt.objective += " Changed fixture objective.";
if (process.argv[2] === "title") prompt.title += " Changed fixture title.";

const { AnalysisProviderRegistry } =
  await import("../../dist/application/binary/AnalysisProviderRegistry.js");
const { SessionProviderRouter } =
  await import("../../dist/application/binary/SessionProviderRouter.js");
const { BinarySession } =
  await import("../../dist/application/binary/BinarySession.js");
const { createServer } = await import("../../dist/server/createServer.js");
const session = new BinarySession(
  SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
);
const server = createServer({ kind: "session", session }, { environment: {} });
const client = new Client({ name: "prompt-identity-fixture", version: "1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const rendered = await client.getPrompt({
    name: prompt.name,
    arguments: { feature: "offline search" },
  });
  const status = await client.callTool({
    name: "binary_session",
    arguments:
      process.argv[3] === undefined
        ? {}
        : { expected_catalog_digest: process.argv[3] },
  });
  if (status.isError) throw new Error(JSON.stringify(status));
  process.stdout.write(
    JSON.stringify({
      rendered,
      identity: status.structuredContent.result.server_identity,
    }),
  );
} finally {
  await client.close();
  await server.close();
  await session.close();
}
