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
   * Reads the events from the stream starting from the specified version
   */
  readStream(
    streamId: string,
    fromVersion: bigint,
    closeOnEnd: boolean
  ): Stream.Stream<never, never, BinaryEvent.BinaryEvent>

  /**
   * Persists a list of events in a transaction, ensuring sequence is mantained
   */
  persistEvents(
    streamId: string,
    currentVersion: bigint,
    events: Iterable<ByteArray.ByteArray>
  ): Effect.Effect<never, never, void>
}

export const inMemory = pipe(
  Effect.gen(function*(_) {
    const sequenceRef = yield* _(Ref.make(BigInt(1)))
    const memoryRef = yield* _(Ref.make<Array<BinaryEvent.BinaryEvent>>([]))

    const readStream = (streamId: string, fromVersion: bigint) =>
      pipe(
        Ref.get(memoryRef),
        Effect.map((events) => events.filter((e) => e.streamId === streamId && e.version > fromVersion)),
        Effect.map((_) => Stream.fromIterable(_)),
        Stream.flatten
      )

    const persistEvents = (streamId: string, fromVersion: bigint, events: Iterable<ByteArray.ByteArray>) =>
      pipe(
        events,
        Effect.forEach((body, idx) =>
          pipe(
            Ref.getAndUpdate(sequenceRef, (_) => _ + BigInt(1)),
            Effect.map((sequence) =>
              BinaryEvent.make(sequence.toString(), sequence, streamId, fromVersion + BigInt(idx), body)
            )
          )
        ),
        Effect.flatMap((items) => Ref.update(memoryRef, (_) => _.concat(items)))
      )

    return { readStream, persistEvents }
  }),
  Layer.effect(EventStore)
)
