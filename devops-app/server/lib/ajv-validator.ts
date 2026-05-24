import AjvConstructor from "ajv";
import addFormats from "ajv-formats";

const ajv = new AjvConstructor({ allErrors: true, strict: false });
addFormats(ajv);

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string[]> | null;
}

export function validateParams(
  schema: Record<string, unknown>,
  params: unknown,
): ValidationResult {
  try {
    const validate = ajv.compile(schema);
    const valid = validate(params);

    if (valid) {
      return { valid: true, errors: null };
    }

    const errors: Record<string, string[]> = {};
    if (validate.errors) {
      for (const err of validate.errors) {
        const field = err.instancePath ? err.instancePath.slice(1) : (err.params as Record<string, unknown>)?.missingProperty ?? "root";
        if (!errors[field as string]) errors[field as string] = [];
        (errors[field as string] as string[]).push(err.message ?? "Validation failed");
      }
    }

    return { valid: false, errors };
  } catch (err) {
    return {
      valid: false,
      errors: { root: [`Schema compilation failed: ${err instanceof Error ? err.message : String(err)}`] },
    };
  }
}

export { ajv };
