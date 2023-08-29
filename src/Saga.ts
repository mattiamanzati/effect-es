import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import type * as RecipientType from "@effect/sharding/RecipientType"
import * as Sharding from "@effect/sharding/Sharding"
import * as Stream from "@effect/stream/Stream"

export function createSagaRouter<Msg>(
  sagaRecipientType: RecipientType.EntityType<Msg>,
  eventToSagaId: (event: Msg) => Option.Option<string>
) {
  return <R, E>(stream: Stream.Stream<R, E, Msg>) => {
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
