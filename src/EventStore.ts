/**
 * @since 1.0.0
 */
import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Ref from "@effect/io/Ref"
import type * as Schema from "@effect/schema/Schema"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import type { JsonData } from "@effect/shardcake/JsonData"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Stream from "@effect/stream/Stream"

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId = "@mattiamanzati/effect-es/EventStore"

/**
 * @since 1.0.0
 * @category context
 */
export const EventStore = Tag<EventStore>(TypeId)

export interface EventStoreUncommittedEvent {
  entityType: string
  entityId: string
  version: bigint
  body: ByteArray.ByteArray
}

/**
 * @since 1.0.0
 * @category models
 */
export interface EventStore {
  /**
   * Reads all the events from the journal of given type and subscribes to updates.
   */
  readJournal(
    entityType: string
  ): Stream.Stream<never, never, ByteArray.ByteArray>

  /**
   * Reads the events from the entity stream starting from the specified version, closes the stream when there are no more events.
   */
  readStream(
    entityType: string,
    entityId: string,
    fromVersion: bigint
  ): Stream.Stream<never, never, { version: bigint; body: ByteArray.ByteArray }>
}

export function readJournalAndDecode<I extends JsonData, A>(entityType: string, schema: Schema.Schema<I, A>) {
  return Effect.gen(function*(_) {
    const eventStore = yield* _(EventStore)
    const serialization = yield* _(Serialization.Serialization)

    return pipe(eventStore.readJournal(entityType), Stream.mapEffect((_) => serialization.decode(_, schema)))
  }).pipe(Stream.unwrap, Stream.orDie)
}

export const inMemory = pipe(
  Effect.gen(function*(_) {
    const memoryRef = yield* _(Ref.make<Array<EventStoreUncommittedEvent>>([]))

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

    const persistEvents = (
      entityType: string,
      entityId: string,
      fromVersion: bigint,
      events: Iterable<ByteArray.ByteArray>
    ) =>
      pipe(
        events,
        Effect.forEach((body, idx) =>
          Effect.succeed({ entityType, entityId, version: fromVersion + BigInt(1 + idx), body })
        ),
        Effect.flatMap((items) => Ref.update(memoryRef, (_) => _.concat(items)))
      )

    return { readJournal, readStream, persistEvents }
  }),
  Layer.effect(EventStore)
)
