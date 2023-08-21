import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref/Synchronized"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import * as MessageQueue from "@effect/shardcake/MessageQueue"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Stream from "@effect/stream/Stream"

export interface PersistedMessageQueueStorage {
  getLastSequence(
    entityType: string,
    entityId: string
  ): Effect.Effect<never, never, bigint>
  getMessageSequence(
    entityType: string,
    entityId: string,
    messageId: string
  ): Effect.Effect<never, never, Option.Option<bigint>>
  pullMessages(
    entityType: string,
    entityId: string,
    fromSequence: bigint
  ): Stream.Stream<never, never, ByteArray.ByteArray>
  persistMessage(
    entityType: string,
    entityId: string,
    messageId: string,
    byteArray: ByteArray.ByteArray
  ): Effect.Effect<never, never, void>
}
export const PersistedMessageQueueStorage = Tag<PersistedMessageQueueStorage>()

export const make = <A>(
  recipientType: RecipientType.RecipientType<A>,
  messageToId: (message: A) => string
) =>
  Layer.effect(
    MessageQueue.MessageQueue,
    Effect.gen(function*(_) {
      const storage = yield* _(PersistedMessageQueueStorage)
      const serialization = yield* _(Serialization.Serialization)

      return {
        _id: MessageQueue.TypeId as any,
        make: (_, entityId) =>
          Effect.gen(function*(_) {
            const entityScope = yield* _(Effect.scope)
            const lastStoredSequence = yield* _(storage.getLastSequence(recipientType.name, entityId))
            const lastSequence = yield* _(Ref.make(lastStoredSequence))
            const dequeue = yield* _(Queue.unbounded<A | PoisonPill.PoisonPill>())

            const offer = (message: A | PoisonPill.PoisonPill): Effect.Effect<never, never, void> =>
              pipe(
                Ref.modifyEffect(lastSequence, (fromSequence) =>
                  Effect.gen(function*(_) {
                    // do nothing for the poisonpill (no persistence)
                    if (PoisonPill.isPoisonPill(message)) {
                      yield* _(Queue.offer(dequeue, message))
                      return [false, fromSequence] as const
                    }

                    // first check if already persisted
                    const messageId = messageToId(message)
                    const persistedMessageSequence = yield* _(
                      storage.getMessageSequence(recipientType.name, entityId, messageId)
                    )
                    // if not persisted, persist it to the storage and offer to the queue
                    if (Option.isNone(persistedMessageSequence)) {
                      const byteArray = yield* _(serialization.encode(message, recipientType.schema))
                      yield* _(
                        storage.persistMessage(recipientType.name, entityId, messageId, byteArray)
                      )
                      yield* _(Queue.offer(dequeue, message))
                      return [false, fromSequence + BigInt(1)]
                    }
                    // TODO: detecting pessimistic?
                    const messageSequence = persistedMessageSequence.value
                    const isDequeueEmpty = yield* _(Queue.isEmpty(dequeue))
                    if (messageSequence !== BigInt(1) + fromSequence && isDequeueEmpty) {
                      return [true, fromSequence] as const
                    }

                    return [false, fromSequence] as const
                  })),
                Effect.flatMap((shouldRunPessimistic) =>
                  // if pessimistic is detected, start it
                  shouldRunPessimistic ? Effect.forkIn(pessimistic, entityScope) : Effect.unit
                ),
                Effect.catchAllCause(Effect.logError)
              )

            // ask the storage for the pending messages and put them in the queue
            const pessimistic = pipe(
              Ref.get(lastSequence),
              Effect.map((fromSequence) =>
                pipe(
                  storage.pullMessages(recipientType.name, entityId, fromSequence),
                  Stream.mapEffect((byteArray) => serialization.decode(byteArray, recipientType.schema)),
                  Stream.mapEffect(offer)
                )
              ),
              Stream.unwrap,
              Stream.runDrain,
              Effect.catchAllCause(Effect.logError)
            )

            // restore pending messages inside the queue from the storage upon creation
            yield* _(pessimistic)

            return ({ offer, dequeue }) as any
          })
      }
    })
  )
