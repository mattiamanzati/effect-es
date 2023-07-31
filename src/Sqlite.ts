import { Tag } from "@effect/data/Context"
import * as Effect from "@effect/io/Effect"
import * as sqlite3 from "sqlite3"
import * as Layer from "@effect/io/Layer"
import { pipe } from "@effect/data/Function"
import * as Exit from "@effect/io/Exit"
import * as Stream from "@effect/stream/Stream"

export interface SqliteConnection {
  db: sqlite3.Database
}

export const SqliteConnection = Tag<SqliteConnection>()

function withSqliteConnection(fileName: string) {
  return pipe(
    Effect.acquireUseRelease(
    Effect.sync(() => new sqlite3.Database(fileName)),
    db => Effect.succeed({ db }),
    (db) => Effect.sync(() => db.close())
  ),
  Layer.scoped(SqliteConnection)
  )
}

export function run(sql: string, args: Array<(string | number)>){
    return Effect.flatMap(SqliteConnection, ({db}) => Effect.async<never, never, number>(resume => {
        db.run(sql, args, function(err){
            if(err === null){
                resume(Effect.succeed(this.changes))
            }else{
                resume(Effect.die((err)))
            }
        })
    }))
}

export function runInTransaction<R, E, A>(fa: Effect.Effect<R, E, A>){
    return pipe(
        Effect.acquireUseRelease(
            run("BEGIN", []),
            () => fa,
            (_, exit) => Exit.isSuccess(exit) ? run("COMMIT", []) : run("ROLLBACK", [])
        )
    )
}

export function query(sql: string, args: Array<(string | number)>){
    return Stream.from
    return Effect.flatMap(SqliteConnection, ({db}) => Effect.async<never, never, number>(resume => {
        db.run(sql, args, function(err){
            if(err === null){
                resume(Effect.succeed(this.changes))
            }else{
                resume(Effect.die((err)))
            }
        })
    }))
}
