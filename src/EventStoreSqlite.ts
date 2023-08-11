import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"
import { jsonDataFromString } from "@mattiamanzati/effect-es/utils"

export const EVENTS_FILE = "events.sqlite3"

export function eventStoreSqlite(fileName: string) {
  return pipe(
    Effect.gen(function*(_) {
      yield* _(pipe(
        Sqlite.run(
          `
        CREATE TABLE IF NOT EXISTS event_journal (
          entityType TEXT NOT NULL,
          entityId TEXT NOT NULL, 
          version BIGINT NOT NULL, 
          body TEXT NOT NULL,
          CONSTRAINT eventId PRIMARY KEY (entityType, entityId, version)
        )
      `,
          []
        ),
        Effect.provideSomeLayer(Sqlite.withSqliteConnection(EVENTS_FILE, true))
      ))

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
            Schema.struct({ version: Schema.BigintFromString, body: jsonDataFromString })
          ),
          Stream.map((row) => [row.version, row.body] as const),
          Stream.provideSomeLayer(Sqlite.withSqliteConnection(fileName, false)),
          Stream.orDie
        )

      const persistEvents = (
        entityType: string,
        entityId: string,
        fromVersion: bigint,
        events: Iterable<JsonData>
      ) =>
        pipe(
          Effect.forEach(events, (event, idx) =>
            pipe(
              Schema.encode(jsonDataFromString)(event),
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
          Effect.provideSomeLayer(Sqlite.withSqliteConnection(fileName, true)),
          Effect.orDie,
          Effect.asUnit
        )

      return { readStream, persistEvents }
    }),
    Layer.effect(EventStore.EventStore)
  )
}
