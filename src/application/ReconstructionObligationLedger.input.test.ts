import { expect, it } from "vitest";

import { AnalysisProtocolError } from "../domain/analysisErrorCore.js";
import { request } from "./ReconstructionObligationLedger.fixture.js";
import { buildReconstructionObligationLedgerEvidenceValidated } from "./ReconstructionObligationLedgerService.js";

it.each(["bundle parser", "evaluation"] as const)(
  "preserves unexpected %s TypeErrors as protocol failures",
  (stage) => {
    const fault = new TypeError("Unexpected internal ledger failure");
    const input = request([]);
    // Inject a downstream programming fault without replacing shared modules.
    Object.defineProperty(
      stage === "bundle parser" ? input.evidence_bundle : input.manifest,
      stage === "bundle parser" ? "records" : "bindings",
      {
        get() {
          throw fault;
        },
      },
    );
    const result = buildReconstructionObligationLedgerEvidenceValidated(input);
    if (result.ok) throw new Error("Expected the injected internal fault");
    expect(result.error).toBeInstanceOf(AnalysisProtocolError);
    expect(result.error.cause).toBe(fault);
  },
);
