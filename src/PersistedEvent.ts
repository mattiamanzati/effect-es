// /**
//  * @since 1.0.0
//  */
// import * as Data from "@effect/data/Data"
// import { pipe } from "@effect/data/Function"
// import * as Schema from "@effect/schema/Schema"
// import type { JsonData } from "@effect/shardcake/JsonData"

// /*
//  * @since 1.0.0
//  * @category symbols
//  */
// export const TypeId = "@mattiamanzati/effect-es/PersistedEvent"

// /**
//  * @since 1.0.0
//  * @category symbols
//  */
// export type TypeId = typeof TypeId

// /**
//  * @since 1.0.0
//  * @category models
//  */
// export type PersistedEvent<Type, Msg> = Data.Data<{
//   _id: TypeId
//   entityType: Type
//   entityId: string
//   version: bigint
//   body: Msg
// }>

// /**
//  * Construct a new `PersistedEvent`
//  *
//  * @since 1.0.0
//  * @category constructors
//  */
// export function make<Type, Msg>(
//   entityType: Type,
//   entityId: string,
//   version: bigint,
//   body: Msg
// ): PersistedEvent<Type, Msg> {
//   return Data.struct({ _id: TypeId, entityType, entityId, version, body })
// }

// /** @internal */
// export function isPersistedEvent(value: unknown): value is PersistedEvent<string, unknown> {
//   return (
//     typeof value === "object" &&
//     value !== null &&
//     "_id" in value &&
//     value["_id"] === TypeId
//   )
// }

// /**
//  * This is the schema for a value.
//  *
//  * @since 1.0.0
//  * @category schema
//  */
// export function schema<I1 extends JsonData, A1 extends string, I extends JsonData, A>(
//   entityType: Schema.Schema<I1, A1>,
//   schema: Schema.Schema<I, A>
// ) {
//   return pipe(
//     Schema.struct({
//       entityType,
//       entityId: Schema.string,
//       version: Schema.BigintFromString,
//       body: schema
//     }),
//     Schema.attachPropertySignature("_id", TypeId),
//     Schema.data
//   )
// }

// export function map<A, B>(
//   fn: (value: A) => B
// ) {
//   return <T>(fa: PersistedEvent<T, A>) => {
//     return make(fa.entityType, fa.entityId, fa.version, fn(fa.body))
//   }
// }
