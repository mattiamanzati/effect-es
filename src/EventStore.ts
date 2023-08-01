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
import * as BinaryEvent from "@mattiamanzati/effect-es/BinaryEvent"

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

/**
 * @since 1.0.0
 * @category models
 */
export interface EventStore {
  /**
   * Reads all the events starting from the specified sequence
   */
  readJournal(
    fromSequence: bigint,
    closeOnEnd: boolean
  ): Stream.Stream<never, never, BinaryEvent.BinaryEvent>

  /**
   * Reads the events from the entity stream starting from the specified version
   */
  readStream(
    entityType: string,
    entityId: string,
    fromVersion: bigint
  ): Stream.Stream<never, never, BinaryEvent.BinaryEvent>

  /**
   * Persists a list of events in a transaction, ensuring sequence is mantained
   */
  persistEvents(
    streamType: string,
    streamId: string,
    currentVersion: bigint,
    events: Iterable<ByteArray.ByteArray>
  ): Effect.Effect<never, never, void>
}

export const inMemory = pipe(
  Effect.gen(function*(_) {
    const sequenceRef = yield* _(Ref.make(BigInt(1)))
    const memoryRef = yield* _(Ref.make<Array<BinaryEvent.BinaryEvent>>([]))

    const readJournal = (fromSequence: bigint) =>
      pipe(
        Ref.get(memoryRef),
        Effect.map((events) => events.filter((e) => e.sequence > fromSequence)),
        Effect.map((_) => Stream.fromIterable(_)),
        Stream.flatten()
      )

    const readStream = (entityType: string, entityId: string, fromVersion: bigint) =>
      pipe(
        Ref.get(memoryRef),
        Effect.map((events) =>
          events.filter((e) => e.entityType === entityType && e.entityId === entityId && e.version > fromVersion)
        ),
        Effect.map((_) => Stream.fromIterable(_)),
        Stream.flatten()
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
          pipe(
            Ref.getAndUpdate(sequenceRef, (_) => _ + BigInt(1)),
            Effect.map((sequence) =>
              BinaryEvent.make(sequence.toString(), sequence, entityType, entityId, fromVersion + BigInt(1 + idx), body)
            )
          )
        ),
        Effect.flatMap((items) => Ref.update(memoryRef, (_) => _.concat(items)))
      )

    return { readJournal, readStream, persistEvents }
  }),
  Layer.effect(EventStore)
)
