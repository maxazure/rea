import type { AnalysisError } from "../analysisErrorBase.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { err, ok, type Result } from "../result.js";
import { MAX_JSON_DEPTH } from "../jsonValue.js";

interface AdmissionPolicy {
  readonly maximumDepth?: number;
  readonly value?: (value: unknown) => Result<void, AnalysisError>;
  readonly key?: (key: string) => Result<void, AnalysisError>;
}

/** Inspect borrowed data before schema reads, without cloning or invoking accessors. */
export const admitOrdinaryAnalysisData = (
  root: unknown,
  policy: AdmissionPolicy = {},
): Result<void, AnalysisError> => {
  const ancestors = new Set<object>();
  const invalid = (): Result<never, AnalysisError> =>
    err(
      new AnalysisInputError("inspect_analysis_view", undefined, [
        {
          path: ["source"],
          reason: "invalid_value",
          message:
            "Parent Evidence must contain ordinary data without cycles or accessors.",
        },
      ]),
    );
  const visit = (
    value: unknown,
    depth: number,
  ): Result<void, AnalysisError> => {
    if (
      depth > (policy.maximumDepth ?? MAX_JSON_DEPTH + 4) ||
      (typeof value === "object" && value !== null && ancestors.has(value))
    )
      return invalid();
    const admittedValue = policy.value?.(value);
    if (admittedValue !== undefined && !admittedValue.ok) return admittedValue;
    if (typeof value !== "object" || value === null) return ok(undefined);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      return invalid();
    ancestors.add(value);
    if (Array.isArray(value)) {
      // JSON validation iterates arrays and cloning uses map/species. Borrow only
      // ordinary arrays whose own members cannot replace those operations.
      if (
        prototype !== Array.prototype ||
        Object.hasOwn(value, Symbol.iterator) ||
        Object.hasOwn(value, "map") ||
        Object.hasOwn(value, "constructor")
      )
        return invalid();
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
          return invalid();
        const admitted = visit(descriptor.value, depth + 1);
        if (!admitted.ok) return admitted;
      }
    } else {
      // Schema parsers read named fields even when they are non-enumerable.
      for (const key of Object.getOwnPropertyNames(value)) {
        const admittedKey = policy.key?.(key);
        if (admittedKey !== undefined && !admittedKey.ok) return admittedKey;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
          return invalid();
        const admitted = visit(descriptor.value, depth + 1);
        if (!admitted.ok) return admitted;
      }
    }
    ancestors.delete(value);
    return ok(undefined);
  };
  return visit(root, 0);
};
