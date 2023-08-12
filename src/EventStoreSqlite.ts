import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Hub from "@effect/io/Hub"
import * as Layer from "@effect/io/Layer"
import * as Ref from "@effect/io/Ref"
import * as Schema from "@effect/schema/Schema"
import * as ByteArray from "@effect/shardcake/ByteArray"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"

export const EVENTS_FILE = "events.sqlite3"

export function eventStoreSqlite(fileName: string) {
  return pipe(
    Effect.gen(function*(_) {
      const changesHub = yield* _(Hub.unbounded<boolean>())

      yield* _(pipe(
        Sqlite.run(
          `
        CREATE TABLE IF NOT EXISTS event_journal (
          id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          entityType TEXT NOT NULL,
          entityId TEXT NOT NULL, 
          version BIGINT NOT NULL, 
          body TEXT NOT NULL,
          UNIQUE (entityType, entityId, version)
        )
      `,
          []
        ),
        Effect.provideSomeLayer(Sqlite.withSqliteConnection(EVENTS_FILE, true))
      ))

      const readJournal = (entityType: string) =>
        Effect.gen(function*(_) {
          const cursorRef = yield* _(Ref.make<number>(0))

          return pipe(
            Stream.succeed(true),
            Stream.merge(Sqlite.changes),
            Stream.merge(Stream.fromHub(changesHub)),
            Stream.mapEffect(() => Ref.get(cursorRef)),
            Stream.flatMap((cursor) =>
              pipe(
                Sqlite.query(
                  `
        SELECT 
          id,
          body
        FROM event_journal 
        WHERE entityType = ? AND id > ?
        ORDER BY id ASC`,
                  [
                    entityType,
                    cursor
                  ],
                  Schema.struct({
                    id: Schema.number,
                    body: ByteArray.schemaFromString
                  })
                ),
                Stream.tap(({ id }) => Ref.set(cursorRef, id)),
                Stream.map((event) => event.body)
              ), { bufferSize: 1, switch: true }),
            Stream.provideSomeLayer(Sqlite.withSqliteConnection(fileName, false)),
            Stream.orDie
          )
        }).pipe(Stream.unwrap)

      const readStream = (entityType: string, entityId: string, fromVersion: bigint) =>
        pipe(
          Sqlite.query(
            `
          SELECT 
            CAST(version AS TEXT) AS version,
            body
          FROM event_journal 
          WHERE 
            entityType = ?
            AND entityId = ? 
            AND version > ?
          ORDER BY event_journal.version ASC`,
            [
              entityType,
              entityId,
              String(fromVersion)
            ],
            Schema.struct({ version: Schema.BigintFromString, body: ByteArray.schemaFromString })
          ),
          Stream.provideSomeLayer(Sqlite.withSqliteConnection(fileName, false)),
          Stream.orDie
        )

      const persistEvents = (
        entityType: string,
        entityId: string,
        fromVersion: bigint,
        events: Iterable<ByteArray.ByteArray>
      ) =>
        pipe(
          Effect.forEach(events, (event, idx) =>
            pipe(
              Schema.encode(ByteArray.schemaFromString)(event),
              Effect.flatMap((body) =>
                Sqlite.run(
                  "INSERT INTO event_journal (entityType, entityId, version, body) VALUES (?, ?, ?, ?)",
                  [
                    entityType,
                    entityId,
                    String(fromVersion + BigInt(1 + idx)),
                    body
                  ]
                )
              )
            )),
          Sqlite.runInTransaction,
          Effect.zipLeft(Hub.publish(changesHub, true)),
          Effect.provideSomeLayer(Sqlite.withSqliteConnection(fileName, true)),
          Effect.orDie,
          Effect.asUnit
        )

      return { readJournal, readStream, persistEvents }
    }),
    Layer.effect(EventStore.EventStore)
  )
}
