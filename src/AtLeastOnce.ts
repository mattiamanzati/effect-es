import { Tag } from "@effect/data/Context"
import * as Either from "@effect/data/Either"
import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Hub from "@effect/io/Hub"
import * as Layer from "@effect/io/Layer"
import * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref"
import * as Schema from "@effect/schema/Schema"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import * as Pods from "@effect/shardcake/Pods"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientBehaviour from "@effect/shardcake/RecipientBehaviour"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"

export interface AtLeastOnceDatabase {
  persistMessage(
    entityType: string,
    entityId: string,
    messageId: string,
    byteArray: ByteArray.ByteArray
  ): Effect.Effect<never, never, bigint>
}
export const AtLeastOnceDatabase = Tag<AtLeastOnceDatabase>()

export function make<A>(recipientType: RecipientType.RecipientType<A>, messageToId: (message: A) => string) {
  return <R>(behaviour: RecipientBehaviour.RecipientBehaviour<R, A>) =>
    pipe(
      behaviour,
      RecipientBehaviour.onReceive((entityId, message, next) =>
        Effect.gen(function*(_) {
          // on receiver side, upon message reception, first store it in the database and fail if not able to
          const atLeastOnceDatabase = yield* _(AtLeastOnceDatabase)
          const serialization = yield* _(Serialization.Serialization)

          const messageId = messageToId(message)
          const byteMessage = yield* _(serialization.encode(message, recipientType.schema))

          yield* _(atLeastOnceDatabase.persistMessage(recipientType.name, entityId, messageId, byteMessage))
          return yield* _(next)
        })
      )
    )
}
