import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import { DecodeError, EncodeError } from "@effect/shardcake/ShardError"
import type { JsonData } from "@effect/shardcake/utils"
import * as Stream from "@effect/stream/Stream"
import * as BinaryEvent from "@mattiamanzati/effect-es/BinaryEvent"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as fs from "fs"

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

function appendJsonData<I extends JsonData, A>(fileName: string, schema: Schema.Schema<I, A>, data: A) {
  return pipe(
    jsonStringify(data, schema),
    Effect.flatMap((data) => Effect.sync(() => fs.appendFileSync(fileName, data + "\n"))),
    Effect.orDie
  )
}

function readJsonData<I extends JsonData, A>(fileName: string, schema: Schema.Schema<I, A>, empty: A) {
  return pipe(
    Effect.sync(() => fs.existsSync(fileName)),
    Effect.flatMap((exists) =>
      exists
        ? pipe(
          Effect.sync(() => fs.readFileSync(fileName)),
          Effect.flatMap((data) => jsonParse(data.toString(), schema))
        )
        : Effect.succeed(empty)
    ),
    Effect.orDie
  )
}

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

export const eventStoreFile = pipe(
  Effect.gen(function*(_) {
    const sequenceRef = yield* _(Ref.make(BigInt(1)))
    const memoryRef = yield* _(Ref.make<Array<BinaryEvent.BinaryEvent>>([]))

    const readStream = (streamId: string, fromVersion: bigint) =>
      pipe(
        S
      )

    const persistEvents = (streamId: string, fromVersion: bigint, events: Iterable<ByteArray.ByteArray>) =>
      pipe(
        events,
        Effect.forEach((body, idx) =>
          pipe(
            Ref.getAndUpdate(sequenceRef, (_) => _ + BigInt(1)),
            Effect.map((sequence) =>
              BinaryEvent.make(sequence.toString(), sequence, streamId, fromVersion + BigInt(1 + idx), body)
            )
          )
        ),
        Effect.flatMap(Effect.forEach((binaryEvent) => appendJsonData("events.json", BinaryEvent.schema, binaryEvent)))
      )

    return { readStream, persistEvents }
  }),
  Layer.effect(EventStore)
)
