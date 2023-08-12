import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"

const AtMostOnceJournal = EventSourced.make(
  "AtMostOnce",
  Schema.string,
  () => [] as Array<string>,
  ({ event, state }) => state.concat([event])
)

export function make<A>(recipientType: RecipientType.RecipientType<A>, messageToId: (message: A) => string) {
  return (entityId: string) =>
    <R, E>(handler: (message: A) => Effect.Effect<R, E, void>) =>
      (message: A) => {
        const messageId = messageToId(message)
        return pipe(
          AtMostOnceJournal.currentState,
          Effect.map((_) => _.indexOf(messageId) > -1),
          Effect.tap(() => AtMostOnceJournal.append(messageId)),
          AtMostOnceJournal.commitOrRetry(recipientType.name + "@" + entityId),
          Effect.flatMap((alreadyReceived) => alreadyReceived ? Effect.unit : handler(message))
        )
      }
}
