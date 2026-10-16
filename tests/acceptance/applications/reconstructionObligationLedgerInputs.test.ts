import { expect } from "vitest";

import {
  proofEvidence,
  request,
  reviewedObligation,
} from "../../../src/application/ReconstructionObligationLedger.fixture.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import {
  createResidualUnknown,
  recordUnknownInputSchema,
} from "../../../src/domain/residualUnknown.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "classifies ledger input constraints with actionable details through %s",
  async (surface, { cli }) => {
    const proof = proofEvidence("review");
    const missingId = `ev_${"a".repeat(64)}`;
    const missingUnknown = createResidualUnknown(
      recordUnknownInputSchema.parse({
        question: "What remains unknown?",
        domain: "ledger-input",
        severity: "medium",
        required_authority: null,
        required_confidence: "derived",
        required_environment: null,
        recommended_probes: [],
        relationships: [],
      }),
      missingId,
      "b".repeat(64),
    );
    const valid = request([proof], {
      reviewed_obligations: [
        reviewedObligation("reviewed.fixture", proof.evidence_id),
      ],
    });
    const canonical = createEvidenceBundle([proof, proofEvidence("other")]);
    const scenarios = [
      {
        input: {
          ...valid,
          reviewed_obligations: [
            reviewedObligation("reviewed.fixture", missingId),
          ],
        },
        message: `Reviewed obligation Evidence is missing: ${missingId}`,
      },
      {
        input: {
          ...valid,
          evidence_bundle: createEvidenceBundle([proof, proof]),
        },
        message: "Evidence bundle contains duplicate record IDs",
      },
      {
        input: {
          ...valid,
          evidence_bundle: createEvidenceBundle([proof], [missingUnknown]),
        },
        message: `Residual unknown references missing evidence ${missingId}`,
      },
      {
        input: {
          ...valid,
          evidence_bundle: {
            ...canonical,
            records: [...canonical.records].reverse(),
          },
        },
        message: "Evidence bundle manifests are not canonical",
      },
      {
        input: {
          ...valid,
          evidence_bundle: createEvidenceBundle([
            { ...proof, normalized_result: { passed: false } },
          ]),
        },
        message:
          "A nested value failed validation at records.0.evidence_id: Evidence semantic identifier does not match its record",
      },
    ];
    const mcp =
      surface === "stdio MCP" ? await connectLocalToolsMcp() : undefined;
    for (const { input, message } of scenarios) {
      const snapshot = JSON.stringify(input);
      let error: unknown;
      if (mcp === undefined) {
        const result = await cli.run({
          arguments: [
            "build-reconstruction-obligation-ledger",
            snapshot,
            "--json",
          ],
        });
        expect(result.exitCode).not.toBe(0);
        error = result.json;
      } else {
        const result = await mcp.call(
          "build_reconstruction_obligation_ledger",
          input,
        );
        expect(result.isError).toBe(true);
        error = parseMcpToolError(result).error;
      }
      expect.soft(error).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        retryable: true,
        details: {
          operation: "build_reconstruction_obligation_ledger",
          issues: [{ path: [], reason: "invalid_value", message }],
        },
      });
      expect(JSON.stringify(input)).toBe(snapshot);
    }
    const success =
      mcp === undefined
        ? (
            await cli.run({
              arguments: [
                "build-reconstruction-obligation-ledger",
                JSON.stringify(valid),
                "--json",
              ],
            })
          ).json
        : (await mcp.call("build_reconstruction_obligation_ledger", valid))
            .structuredContent;
    expect(success).toMatchObject({
      normalized_result: {
        summary: { total: 1 },
        obligations: [
          {
            obligation_id: "reviewed.fixture",
            authority_references: [{ evidence_id: proof.evidence_id }],
          },
        ],
      },
    });
  },
);
