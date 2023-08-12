import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Layer from "@effect/io/Layer"
import * as Queue from "@effect/io/Queue"
import type { Scope } from "@effect/io/Scope"
import type { ParseError } from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as Stream from "@effect/stream/Stream"
import * as fs from "fs"
import { default as sqlite3 } from "sqlite3"

function getChangesStream(fileName: string) {
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

export interface SqliteConnection {
  db: sqlite3.Database
  changes: Stream.Stream<never, never, boolean>
}

export const SqliteConnection = Tag<SqliteConnection>()

export function withSqliteConnection(fileName: string, writeable: boolean) {
  return pipe(
    Effect.acquireRelease(
      Effect.async<never, never, sqlite3.Database>((resume) => {
        const db: sqlite3.Database = new sqlite3.Database(
          fileName,
          writeable ? sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY,
          (err) => {
            if (err === null) {
              resume(Effect.succeed(db))
            } else {
              resume(Effect.die(err))
            }
          }
        )
      }),
      (db) =>
        Effect.async<never, never, void>((resume) => {
          db.close(() => resume(Effect.succeed(undefined)))
        })
    ),
    Effect.map((db) => ({ db, changes: getChangesStream(fileName) })),
    Layer.scoped(SqliteConnection)
  )
}

export function run(sql: string, args: Array<(string | number | null)>) {
  return pipe(
    prepare(sql, args),
    Effect.flatMap((statement) =>
      Effect.async<never, never, void>((resume) => {
        statement.run((err) => {
          if (err) {
            resume(Effect.die(err))
          } else {
            resume(Effect.succeed(undefined))
          }
        })
      })
    ),
    Effect.scoped
  )
}

export function runInTransaction<R, E, A>(fa: Effect.Effect<R, E, A>) {
  return pipe(
    Effect.acquireUseRelease(
      run("BEGIN", []),
      () => fa,
      (_, exit) => Exit.isSuccess(exit) ? run("COMMIT", []) : run("ROLLBACK", [])
    )
  )
}

function prepare(
  sql: string,
  args: Array<(string | number | null)>
): Effect.Effect<SqliteConnection | Scope, never, sqlite3.Statement> {
  return Effect.flatMap(SqliteConnection, ({ db }) =>
    Effect.acquireRelease(
      Effect.async<never, never, sqlite3.Statement>((resume) => {
        const statement = db.prepare(sql, args, (err) => {
          if (err) {
            resume(Effect.die(err))
          } else {
            resume(Effect.succeed(statement))
          }
        })
      }),
      (statement) =>
        Effect.async<never, never, void>((resume) => {
          statement.finalize((err) => {
            if (err) {
              resume(Effect.die(err))
            } else {
              resume(Effect.succeed(undefined))
            }
          })
        })
    ))
}

export function query<I, A>(
  sql: string,
  args: Array<(string | number | null)>,
  schema: Schema.Schema<I, A>
): Stream.Stream<SqliteConnection, ParseError, A> {
  return pipe(
    prepare(sql, args),
    Effect.map((statement) =>
      Stream.repeatEffectOption(Effect.async<never, Option.Option<never>, I>((emit) => {
        statement.get((err, row) => {
          if (err) {
            emit(Effect.die(err))
          } else {
            if (row) {
              emit(Effect.succeed(row as I))
            } else {
              emit(Effect.fail(Option.none()))
            }
          }
        })
      }))
    ),
    Stream.unwrapScoped,
    Stream.mapEffect(Schema.decode(schema))
  )
}

export const changes = pipe(
  SqliteConnection,
  Effect.map(({ changes }) => changes),
  Stream.unwrap
)
