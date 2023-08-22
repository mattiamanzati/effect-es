import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Queue from "@effect/io/Queue"
import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"
import * as Stream from "@effect/stream/Stream"
import * as fs from "fs"

export function getFileChangesStream(fileName: string) {
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

export const jsonDataSchema: Schema.Schema<JsonData, JsonData> = Schema.union(
  Schema.null,
  Schema.boolean,
  Schema.number,
  Schema.string,
  Schema.lazy(() => Schema.array(jsonDataSchema)),
  Schema.lazy(() => Schema.record(Schema.string, jsonDataSchema))
)

export const jsonDataFromString = Schema.transform(
  Schema.string,
  jsonDataSchema,
  (fa) => JSON.parse(fa),
  (fa) => JSON.stringify(fa)
)
