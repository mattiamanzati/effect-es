import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Layer from "@effect/io/Layer"
import * as Stream from "@effect/stream/Stream"
import { default as sqlite3 } from "sqlite3"

export interface SqliteConnection {
  db: sqlite3.Database
}

export const SqliteConnection = Tag<SqliteConnection>()

export function withSqliteConnection(fileName: string) {
  return pipe(
    Effect.acquireRelease(
      Effect.async<never, never, sqlite3.Database>((resume) => {
        const db: sqlite3.Database = new sqlite3.Database(
          fileName,
          sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
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
    Effect.map((db) => ({ db })),
    Layer.scoped(SqliteConnection)
  )
}

export function run(sql: string, args: Array<(string | number | null | bigint)>) {
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

function prepare(sql: string, args: Array<(string | number | null | bigint)>) {
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

export function query(sql: string, args: Array<(string | number | null | bigint)>) {
  return pipe(
    prepare(sql, args),
    Effect.map((statement) =>
      Stream.repeatEffectOption(Effect.async<never, Option.Option<void>, unknown>((emit) => {
        statement.get((err, row) => {
          if (err) {
            emit(Effect.die(err))
          } else {
            if (row) {
              emit(Effect.succeed(row))
            } else {
              emit(Effect.fail(Option.none()))
            }
          }
        })
      }))
    ),
    Stream.unwrapScoped
  )
}
