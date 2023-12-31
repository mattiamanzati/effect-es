/**
 * @since 1.0.0
 */
import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Ref from "@effect/io/Ref"
import type * as ByteArray from "@effect/sharding/ByteArray"
import * as Stream from "@effect/stream/Stream"
import type * as EventStore from "@mattiamanzati/effect-es/EventStore"

export interface EventStoreInMemoryStorage {
  memory: Ref.Ref<Array<{ entityType: string; entityId: string; version: bigint; body: ByteArray.ByteArray }>>
}

export const EventStoreInMemoryStorage = Tag<EventStoreInMemoryStorage>()

export const inMemoryStorage = Layer.effect(
  EventStoreInMemoryStorage,
  Effect.map(Ref.make([]), (memory) => ({ memory }))
)

const readJournal = (entityType: string) =>
  pipe(
    EventStoreInMemoryStorage,
    Effect.flatMap((storage) => Ref.get(storage.memory)),
    Effect.map(Stream.fromIterable),
    Stream.flatten(),
    Stream.filter((event) => event.entityType === entityType),
    Stream.map((event) => event.body)
  )

const readStream = (entityType: string, entityId: string, fromVersion: bigint) =>
  pipe(
    EventStoreInMemoryStorage,
    Effect.flatMap((storage) => Ref.get(storage.memory)),
    Effect.map(Stream.fromIterable),
    Stream.flatten(),
    Stream.filter((event) =>
      event.entityType === entityType && event.entityId === entityId && event.version > fromVersion
    ),
    Stream.map((event) => ({ version: event.version, body: event.body }))
  )

const persistEvent = (entityType: string, entityId: string, version: bigint, body: ByteArray.ByteArray) =>
  pipe(
    EventStoreInMemoryStorage,
    Effect.flatMap((storage) => Ref.update(storage.memory, (_) => _.concat([{ entityType, entityId, version, body }])))
  )

export const inMemory: EventStore.EventStore<EventStoreInMemoryStorage, never> = {
  persistEvent,
  readJournal,
  readStream
}
