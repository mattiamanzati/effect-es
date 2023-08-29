/**
 * @since 1.0.0
 */
import type * as ByteArray from "@effect/sharding/ByteArray"
import type * as Stream from "@effect/stream/Stream"

/**
 * @since 1.0.0
 * @category models
 */
export interface EventStore<R, E> {
  /**
   * Reads all the events from the journal of given type and subscribes to updates.
   */
  readJournal(
    entityType: string
  ): Stream.Stream<R, E, ByteArray.ByteArray>

  /**
   * Reads the events from the entity stream starting from the specified version, closes the stream when there are no more events.
   */
  readStream(
    entityType: string,
    entityId: string,
    fromVersion: bigint
  ): Stream.Stream<R, E, { version: bigint; body: ByteArray.ByteArray }>

  /**
   * Persists an event into the stream
   */
  persistEvent(
    entityType: string,
    entityId: string,
    version: bigint,
    body: ByteArray.ByteArray
  ): Stream.Stream<R, E, void>
}
