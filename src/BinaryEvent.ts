/**
 * @since 1.0.0
 */
import * as Data from "@effect/data/Data"
import * as Schema from "@effect/schema/Schema"
import * as ByteArray from "@effect/shardcake/ByteArray"

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId = "@mattiamanzati/effect-es/BinaryEvent"

/**
 * @since 1.0.0
 * @category symbols
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category models
 */
export interface BinaryEvent extends Schema.To<typeof schema> {}

/**
 * Construct a new `BinaryEvent`
 *
 * @since 1.0.0
 * @category constructors
 */
export function make(
  id: string,
  sequence: bigint,
  entityType: string,
  entityId: string,
  version: bigint,
  body: ByteArray.ByteArray
): BinaryEvent {
  return Data.struct({ _id: TypeId, id, sequence, entityType, entityId, version, body })
}

/** @internal */
export function isBinaryEvent(value: unknown): value is BinaryEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "_id" in value &&
    value["_id"] === TypeId
  )
}

/**
 * This is the schema for a value.
 *
 * @since 1.0.0
 * @category schema
 */
export const schema = Schema.data(
  Schema.struct({
    _id: Schema.literal(TypeId),
    id: Schema.string,
    sequence: Schema.BigintFromString,
    entityType: Schema.string,
    entityId: Schema.string,
    version: Schema.BigintFromString,
    body: ByteArray.schema
  })
)
