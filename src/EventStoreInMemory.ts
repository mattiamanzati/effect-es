/**
 * @since 1.0.0
 */
import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Ref from "@effect/io/Ref"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

export interface EventStoreInMemoryStorage {
  memory: Ref.Ref<Array<{ entityType: string; entityId: string; version: bigint; body: ByteArray.ByteArray }>>
}

export const EventStoreInMemoryStorage = Tag<EventStoreInMemoryStorage>()

export const inMemoryStorage = Layer.effect(
  EventStoreInMemoryStorage,
  Effect.map(Ref.make([]), (memory) => ({ memory }))
)

export const inMemory = Layer.effect(
  EventStore.EventStore,
  Effect.gen(function*(_) {
    const memoryRef = (yield* _(EventStoreInMemoryStorage)).memory

    const readJournal = (entityType: string) =>
      pipe(
        Ref.get(memoryRef),
        Effect.map(Stream.fromIterable),
        Stream.flatten(),
        Stream.filter((event) => event.entityType === entityType),
        Stream.map((event) => event.body)
      )

    const readStream = (entityType: string, entityId: string, fromVersion: bigint) =>
      pipe(
        Ref.get(memoryRef),
        Effect.map(Stream.fromIterable),
        Stream.flatten(),
        Stream.filter((event) =>
          event.entityType === entityType && event.entityId === entityId && event.version > fromVersion
        ),
        Stream.map((event) => ({ version: event.version, body: event.body }))
      )

    const persistEvent = (entityType: string, entityId: string, version: bigint, body: ByteArray.ByteArray) =>
      Ref.update(memoryRef, (_) => _.concat([{ entityType, entityId, version, body }]))

    return { readJournal, readStream, persistEvent }
  })
)
