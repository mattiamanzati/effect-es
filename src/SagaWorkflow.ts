// import type * as DeterministicRandom from "@effect/data/DeterministicRandom"
// import { pipe } from "@effect/data/Function"
// import * as Effect from "@effect/io/Effect"
// import * as Schema from "@effect/schema/Schema"
// import type { JsonData } from "@effect/sharding/JsonData"
// import type * as Message from "@effect/sharding/Message"
// import type * as RecipientType from "@effect/sharding/RecipientType"
// import * as ReplyId from "@effect/sharding/ReplyId"
// import * as Sharding from "@effect/sharding/Sharding"
// import * as Envelope from "@mattiamanzati/effect-es/Envelope"

// /** @internal */
// export class SingleShotGen<T, A> implements Generator<T, A> {
//   called = false

//   constructor(readonly self: T) {
//   }

//   next(a: A): IteratorResult<T, A> {
//     return this.called ?
//       ({
//         value: a,
//         done: true
//       }) :
//       (this.called = true,
//         ({
//           value: this.self,
//           done: false
//         }))
//   }

//   return(a: A): IteratorResult<T, A> {
//     return ({
//       value: a,
//       done: true
//     })
//   }

//   throw(e: unknown): IteratorResult<T, A> {
//     throw e
//   }

//   [Symbol.iterator](): Generator<T, A> {
//     return new SingleShotGen<T, A>(this.self)
//   }
// }

// export class SagaWorkflowGen<R, E, A> {
//   readonly _R!: () => R
//   readonly _E!: () => E
//   readonly _A!: () => A

//   constructor(readonly value: SagaWorkflow<R, E, A>) {
//   }

//   [Symbol.iterator](): Generator<SagaWorkflowGen<R, E, A>, A> {
//     return new SingleShotGen(this) as any
//   }
// }

// interface SagaWorkflowAdapter {
//   <R, E, A>(op: SagaWorkflow<R, E, A>): SagaWorkflowGen<R, E, A>
// }

// interface ActivityOp<R, E, A> {
//   _tag: "ActivityOp"
//   id: string
//   schema: Schema.Schema<any, A>
//   effect: Effect.Effect<R, E, A>
// }

// interface DeterministicOp<A> {
//   _tag: "DeterministicOp"
//   fn: (random: DeterministicRandom.PCGRandomState) => readonly [A, DeterministicRandom.PCGRandomState]
// }

// interface ConsumeOp<R, A> {
//   _tag: "ConsumeOp"
//   fn: (event: R) => A
// }

// interface FlatMapOp<R, E, A> {
//   _tag: "FlatMapOp"
//   fa: SagaWorkflow<any, any, any>
//   fn: (value: any) => SagaWorkflow<R, E, A>
// }

// type SagaWorkflow<R, E, A> = FlatMapOp<R, E, A> | ActivityOp<R, E, A> | DeterministicOp<A> | ConsumeOp<R, A>

// export function deterministic<A>(
//   fn: (random: DeterministicRandom.PCGRandomState) => readonly [A, DeterministicRandom.PCGRandomState]
// ): SagaWorkflow<never, never, A> {
//   return ({ _tag: "DeterministicOp", fn })
// }

// export function activity<R, E, I extends JsonData, A>(
//   id: string,
//   schema: Schema.Schema<I, A>,
//   effect: Effect.Effect<R, E, A>
// ): SagaWorkflow<R, E, A> {
//   return ({ _tag: "ActivityOp", id, schema, effect })
// }

// export function flatMap<R, E, A, R2, E2, B>(
//   fa: SagaWorkflow<R, E, A>,
//   fn: (value: A) => SagaWorkflow<R2, E2, B>
// ): SagaWorkflow<R | R2, E | E2, B> {
//   return ({ _tag: "FlatMapOp", fa, fn })
// }

// export function nextUUID() {
//   return deterministic(Envelope.deterministicUUID)
// }

// export function sendDiscard<A>(
//   id: string,
//   recipientType: RecipientType.EntityType<A>,
//   entityId: string,
//   message: A
// ) {
//   return activity(
//     id,
//     Schema.null,
//     pipe(
//       Sharding.messenger(recipientType),
//       Effect.flatMap((messenger) => messenger.sendDiscard(entityId)(message)),
//       Effect.as(null)
//     )
//   )
// }

// export function send<A extends Message.Message<any>>(
//   id: string,
//   recipientType: RecipientType.EntityType<A>,
//   entityId: string,
//   message: (replyId: ReplyId.ReplyId) => A
// ) {
//   return activity(
//     id,
//     message(ReplyId.make(id)).replier.schema,
//     pipe(
//       Sharding.messenger(recipientType),
//       Effect.flatMap((messenger) => messenger.send(entityId)(message))
//     )
//   )
// }

// export declare function make<Eff extends SagaWorkflowGen<any, any, any>, AEff>(
//   f: (resume: SagaWorkflowAdapter) => Generator<Eff, AEff, any>
// ): AEff
