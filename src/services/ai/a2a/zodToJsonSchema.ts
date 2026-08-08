/**
 * Minimal zod v3 -> JSON-Schema mirror, scoped to exactly the constructs this codebase's
 * schemas use (object / string / number / boolean / enum / array / optional / nullable /
 * default). Not a general-purpose converter — deliberately small rather than pulling in a
 * dependency for four shapes. Falls back to `{ type: "string" }` for anything unrecognised
 * rather than throwing, since this only ever feeds documentation/tool-declaration surfaces,
 * never validation.
 */

import {
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodEnum,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  type ZodTypeAny,
} from "zod";
import type { A2AJsonSchema } from "./types";

export function zodToJsonSchema(schema: ZodTypeAny): A2AJsonSchema {
  if (schema instanceof ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof ZodDefault) return zodToJsonSchema(schema.removeDefault());
  if (schema instanceof ZodNullable) return { ...zodToJsonSchema(schema.unwrap()), nullable: true };

  if (schema instanceof ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, A2AJsonSchema> = {};
    const required: string[] = [];
    for (const key of Object.keys(shape)) {
      const child = shape[key];
      properties[key] = zodToJsonSchema(child);
      if (!(child instanceof ZodOptional) && !(child instanceof ZodDefault)) {
        required.push(key);
      }
    }
    return { type: "object", properties, required };
  }

  if (schema instanceof ZodString) return { type: "string" };
  if (schema instanceof ZodNumber) return { type: "number" };
  if (schema instanceof ZodBoolean) return { type: "boolean" };
  if (schema instanceof ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };

  return { type: "string" };
}
