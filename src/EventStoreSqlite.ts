import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Queue from "@effect/io/Queue"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import * as ByteArray from "@effect/shardcake/ByteArray"
import { DecodeError, EncodeError } from "@effect/shardcake/ShardError"
import type { JsonData } from "@effect/shardcake/utils"
import * as Stream from "@effect/stream/Stream"
import * as BinaryEvent from "@mattiamanzati/effect-es/BinaryEvent"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"
import * as fs from "fs"

export const EVENTS_FILE = "events.sqlite3"

const EventJournalRow = Schema.struct({
  id: Schema.string,
  sequence: Schema.BigintFromString,
  entity_type: Schema.string,
  entity_id: Schema.string,
  version: Schema.BigintFromString,
  body: Schema.string
})

/** @internal */
export function jsonStringify<I extends JsonData, A>(value: A, schema: Schema.Schema<I, A>) {
  return pipe(
    value,
    Schema.encode(schema),
    Effect.mapError((e) => EncodeError(TreeFormatter.formatErrors(e.errors))),
    Effect.map((_) => JSON.stringify(_))
  )
}

/** @internal */
export function jsonParse<I extends JsonData, A>(value: string, schema: Schema.Schema<I, A>) {
  return pipe(
    Effect.sync(() => JSON.parse(value)),
    Effect.flatMap(Schema.decode(schema)),
    Effect.mapError((e) => DecodeError(TreeFormatter.formatErrors(e.errors)))
  )
}

export function getChangesStream(fileName: string) {
  return pipe(
    Queue.unbounded<boolean>(),
    Effect.flatMap((queue) =>
      pipe(
        Effect.acquireRelease(
          Effect.sync(
            () => [fs.watchFile(fileName, () => Effect.runSync(queue.offer(true))), queue] as const
          ),
          ([watcher, queue]) =>
            Effect.zip(
              queue.shutdown(),
              Effect.sync(() => watcher.unref()),
              { concurrent: true }
            )
        ),
        Effect.map(([_, queue]) => Stream.fromQueue(queue))
      )
    ),
    Stream.unwrapScoped
  )
}

export function eventStoreSqlite(fileName: string) {
  return pipe(
    Effect.gen(function*(_) {
      yield* _(pipe(
        Sqlite.run(
          `
        CREATE TABLE IF NOT EXISTS event_journal (
          id TEXT NOT NULL, 
          sequence BIGINT NOT NULL, 
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL, 
          version BIGINT NOT NULL, 
          body TEXT NOT NULL,
          CONSTRAINT event_id PRIMARY KEY (entity_type, entity_id, version)
        )
      `,
          []
        ),
        Effect.provideSomeLayer(Sqlite.withSqliteConnection(EVENTS_FILE))
      ))

      const readJournal = (fromSequence: bigint) =>
        pipe(
          Sqlite.query(
            `
        SELECT 
          id, 
          CAST(sequence AS TEXT) AS sequence,
          entity_type,
          entity_id,
          CAST(version AS TEXT) AS version,
          body
        FROM event_journal 
        WHERE 
          sequence > ?
        ORDER BY sequence`,
            [
              String(fromSequence)
            ]
          ),
          Stream.flatMap(Schema.parse(EventJournalRow)),
          Stream.map((row) =>
            BinaryEvent.make(
              row.id,
              row.sequence,
              row.entity_type,
              row.entity_id,
              row.version,
              ByteArray.make(row.body)
            )
          ),
          Stream.provideSomeLayer(Sqlite.withSqliteConnection(fileName)),
          Stream.orDie
        )

      const readStream = (entityType: string, entityId: string, fromVersion: bigint) =>
        pipe(
          Sqlite.query(
            `
          SELECT 
            id, 
            CAST(sequence AS TEXT) AS sequence,
            entity_type,
            entity_id,
            CAST(version AS TEXT) AS version,
            body
          FROM event_journal 
          WHERE 
            entity_type = ?
            AND entity_id = ? 
            AND version > ?
          ORDER BY version ASC`,
            [
              entityType,
              entityId,
              String(fromVersion)
            ]
          ),
          Stream.flatMap(Schema.parse(EventJournalRow)),
          Stream.map((row) =>
            BinaryEvent.make(
              row.id,
              row.sequence,
              row.entity_type,
              row.entity_id,
              row.version,
              ByteArray.make(row.body)
            )
          ),
          Stream.provideSomeLayer(Sqlite.withSqliteConnection(fileName)),
          Stream.orDie
        )

      const persistEvents = (
        entityType: string,
        entityId: string,
        fromVersion: bigint,
        events: Iterable<ByteArray.ByteArray>
      ) =>
        pipe(
          Sqlite.query(
            "SELECT CAST(COALESCE(MAX(sequence), 0) AS TEXT) AS sequence FROM event_journal WHERE entity_type = ? AND entity_id = ?",
            [
              entityType,
              entityId
            ]
          ),
          Stream.runHead,
          Effect.some,
          Effect.flatMap(Schema.parse(Schema.struct({ sequence: Schema.BigintFromString }))),
          Effect.flatMap(({ sequence }) =>
            pipe(
              Effect.forEach(events, (body, idx) =>
                Effect.succeed(
                  BinaryEvent.make(
                    String(sequence + BigInt(1 + idx)),
                    sequence + BigInt(1 + idx),
                    entityType,
                    entityId,
                    fromVersion + BigInt(1 + idx),
                    body
                  )
                )),
              Effect.flatMap(Effect.forEach((binaryEvent) =>
                Sqlite.run(
                  "INSERT INTO event_journal (id, sequence, entity_type, entity_id, version, body) VALUES (?, ?, ?, ?, ?, ?)",
                  [
                    binaryEvent.id,
                    String(binaryEvent.sequence),
                    binaryEvent.entityType,
                    binaryEvent.entityId,
                    String(binaryEvent.version),
                    binaryEvent.body.value
                  ]
                )
              )),
              Effect.asUnit
            )
          ),
          Sqlite.runInTransaction,
          Effect.provideSomeLayer(Sqlite.withSqliteConnection(fileName)),
          Effect.orDie
        )

      return { readJournal, readStream, persistEvents }
    }),
    Layer.effect(EventStore.EventStore)
  )
}
