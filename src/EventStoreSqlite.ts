import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Ref from "@effect/io/Ref"
import * as Schema from "@effect/schema/Schema"
import * as ByteArray from "@effect/sharding/ByteArray"
import * as Stream from "@effect/stream/Stream"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"

// reads the entire journal for an entity type
const readJournal = (entityType: string) =>
  Effect.gen(function*(_) {
    const cursorRef = yield* _(Ref.make<number>(0))

    return pipe(
      Stream.succeed(true),
      Stream.merge(Sqlite.changes),
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
        ), { bufferSize: 1, switch: true })
    )
  }).pipe(Stream.unwrap)

// reads the stream for an entity
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
    )
  )

// persists an event into the stream
const persistEvent = (
  entityType: string,
  entityId: string,
  version: bigint,
  body: ByteArray.ByteArray
) =>
  Sqlite.run(
    "INSERT INTO event_journal (entityType, entityId, version, body) VALUES (?, ?, ?, ?)",
    [
      entityType,
      entityId,
      String(version),
      body.value
    ]
  )

export const sqlLite = { readStream, readJournal, persistEvent }

export const setupTable = Sqlite.run(
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
)
