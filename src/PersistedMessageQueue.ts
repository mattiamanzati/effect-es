// import { Tag } from "@effect/data/Context"
// import type * as HashSet from "@effect/data/HashSet"
// import * as Effect from "@effect/io/Effect"
// import * as Layer from "@effect/io/Layer"
// import * as Queue from "@effect/io/Queue"
// import type * as BinaryMessage from "@effect/shardcake/BinaryMessage"
// import type * as ByteArray from "@effect/shardcake/ByteArray"
// import * as MessageQueue from "@effect/shardcake/MessageQueue"
// import * as PoisonPill from "@effect/shardcake/PoisonPill"
// import type * as RecipientType from "@effect/shardcake/RecipientType"
// import * as Serialization from "@effect/shardcake/Serialization"
// import type { Throwable } from "@effect/shardcake/ShardError"
// import type * as ShardId from "@effect/shardcake/ShardId"
// import type * as Stream from "@effect/stream/Stream"

// interface OutOfOrder {
//   _tag: "OutOfOrder"
// }

// export interface PersistedMessageQueueStorage {
//   pullUnprocessedMessages(
//     shardIds: HashSet.HashSet<ShardId.ShardId>
//   ): Stream.Stream<never, never, BinaryMessage.BinaryMessage>
//   ackProcessed(
//     entityType: string,
//     entityId: string,
//     messageId: string
//   ): Effect.Effect<never, OutOfOrder, void>
//   persistMessage(
//     entityType: string,
//     entityId: string,
//     messageId: string,
//     byteArray: ByteArray.ByteArray
//   ): Effect.Effect<never, Throwable, void>
// }
// export const PersistedMessageQueueStorage = Tag<PersistedMessageQueueStorage>()

// export interface AcknoledgeMessage<A> {
//   ackProcessed(
//     entityId: string,
//     message: A
//   ): Effect.Effect<never, OutOfOrder, void>
// }

// export declare function acknoledge<A>(
//   entityId: string,
//   message: A
// ): Effect.Effect<AcknoledgeMessage<A>, never, void>

// export const make = <A>(
//   recipientType: RecipientType.RecipientType<A>,
//   messageToId: (message: A) => string
// ) => {
//   const messageQueueLayer = Layer.effect(
//     MessageQueue.MessageQueue,
//     Effect.gen(function*(_) {
//       const storage = yield* _(PersistedMessageQueueStorage)
//       const serialization = yield* _(Serialization.Serialization)

//       return {
//         _id: MessageQueue.TypeId as any,
//         make: (currentRecipient, entityId) =>
//           Effect.gen(function*(_) {
//             const dequeue = yield* _(Queue.unbounded<A | PoisonPill.PoisonPill>())

//             const offer = (message: A | PoisonPill.PoisonPill): Effect.Effect<never, Throwable, void> =>
//               Effect.gen(function*(_) {
//                 // if message is not a PoisonPill, persist to the database
//                 if (!PoisonPill.isPoisonPill(message)) {
//                   const messageId = messageToId(message)
//                   const byteArray = yield* _(serialization.encode(message, recipientType.schema))
//                   yield* _(
//                     storage.persistMessage(recipientType.name, entityId, messageId, byteArray)
//                   )
//                 }
//                 // offer to the queue
//                 yield* _(Queue.offer(dequeue, message))
//               })

//             return ({ offer, dequeue }) as any
//           })
//       }
//     })
//   )

//   const ackMessageLayer: Layer.Layer<never, never, AcknoledgeMessage<A>> = 1 as any

//   return Layer.merge(messageQueueLayer, ackMessageLayer)
// }
