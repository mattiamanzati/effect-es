import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"

export const jsonDataSchema: Schema.Schema<JsonData, JsonData> = Schema.union(
  Schema.null,
  Schema.boolean,
  Schema.number,
  Schema.string,
  Schema.lazy(() => Schema.array(jsonDataSchema)),
  Schema.lazy(() => Schema.record(Schema.string, jsonDataSchema))
)

export const jsonDataFromString = Schema.transform(
  Schema.string,
  jsonDataSchema,
  (fa) => JSON.parse(fa),
  (fa) => JSON.stringify(fa)
)
