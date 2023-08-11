/**
 * @since 1.0.0
 */
import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Ref from "@effect/io/Ref"
import type { JsonData } from "@effect/shardcake/JsonData"
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

/**
 * @since 1.0.0
 * @category models
 */
export interface EventStore {
  /**
   * Reads the events from the entity stream starting from the specified version, closes the stream when there are no more events.
   */
  readStream(
    entityType: string,
    entityId: string,
    fromVersion: bigint
  ): Stream.Stream<never, never, readonly [version: bigint, event: JsonData]>

  /**
   * Persists a list of events in a transaction, ensuring sequence is mantained
   */
  persistEvents(
    entityType: string,
    entityId: string,
    currentVersion: bigint,
    events: Iterable<JsonData>
  ): Effect.Effect<never, never, void>
}

interface InMemoryEntry {
  entityType: string
  entityId: string
  version: bigint
  body: JsonData
}

export const inMemory = pipe(
  Effect.gen(function*(_) {
    const memoryRef = yield* _(Ref.make<Array<InMemoryEntry>>([]))

    const readStream = (entityType: string, entityId: string, fromVersion: bigint) =>
      pipe(
        Ref.get(memoryRef),
        Effect.map((events) =>
          events.filter((e) => e.entityType === entityType && e.entityId === entityId && e.version > fromVersion)
        ),
        Effect.map((_) => pipe(Stream.fromIterable(_), Stream.map((_) => [_.version, _.body] as const))),
        Stream.flatten()
      )

    const persistEvents = (
      entityType: string,
      entityId: string,
      fromVersion: bigint,
      events: Iterable<JsonData>
    ) =>
      pipe(
        events,
        Effect.forEach((body, idx) =>
          Effect.succeed(
            {
              entityType,
              entityId,
              version: fromVersion + BigInt(1 + idx),
              body
            }
          )
        ),
        Effect.flatMap((items) => Ref.update(memoryRef, (_) => _.concat(items)))
      )

    return { readStream, persistEvents }
  }),
  Layer.effect(EventStore)
)
