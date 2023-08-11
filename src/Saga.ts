import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Stream from "@effect/stream/Stream"

export function register<Msg>(
  sagaRecipientType: RecipientType.EntityType<Msg>
) {
  return <R>(eventToSagaId: (event: Msg) => Option.Option<string>, stream: Stream.Stream<R, never, Msg>) => {
    const behaviour = pipe(
      stream,
      Stream.mapEffect((event) =>
        pipe(
          eventToSagaId(event),
          Option.match({
            onNone: () => Effect.unit,
            onSome: (sagaId) =>
              pipe(
                Sharding.messenger(sagaRecipientType),
                Effect.flatMap((messenger) => messenger.sendDiscard(sagaId)(event))
              )
          })
        ), { unordered: true }),
      Stream.runDrain,
      Effect.catchAllCause(Effect.logError)
    )
    return Sharding.registerSingleton("SagaManager<" + sagaRecipientType.name + ">", behaviour)
  }
}
