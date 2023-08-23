/**
 * @since 1.0.0
 */
import { Tag } from "@effect/data/Context"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import type * as Stream from "@effect/stream/Stream"

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

  /**
   * Persists an event into the stream
   */
  persistEvent(
    entityType: string,
    entityId: string,
    version: bigint,
    body: ByteArray.ByteArray
  ): Stream.Stream<never, never, void>
}
