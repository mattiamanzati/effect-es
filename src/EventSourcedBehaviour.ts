import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref"
import type * as Schema from "@effect/schema/Schema"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Stream from "@effect/stream/Stream"
import * as SubscriptionRef from "@effect/stream/SubscriptionRef"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

interface Projection<State> {
  version: bigint
  state: State
}

export function make<Command, Event>(
  entityType: RecipientType.RecipientType<Command>,
  eventsSchema: Schema.Schema<any, Event>
) {
  return <State, R>(
    initialState: State,
    decide: (
      command: Command,
      state: State,
      emit: (events: Iterable<Event>) => Effect.Effect<never, never, void>
    ) => Effect.Effect<R, never, void>,
    evolve: (state: State, event: Event) => State
  ) =>
    (streamId: string, dequeue: Queue.Dequeue<Command>) =>
      Effect.gen(function*(_) {
        const eventStore = yield* _(EventStore.EventStore)
        const serialization = yield* _(Serialization.Serialization)
        const projectionRef = yield* _(
          SubscriptionRef.make<Projection<State>>({ version: BigInt(0), state: initialState })
        )

        const updateProjection = pipe(
          SubscriptionRef.get(projectionRef),
          Effect.flatMap((currentProjection) =>
            pipe(
              eventStore.readStream(streamId, currentProjection.version, true),
              Stream.runFoldEffect(
                currentProjection,
                (p, e) =>
                  Effect.map(
                    serialization.decode(e.body, eventsSchema),
                    (event) => ({ version: e.version, state: evolve(p.state, event) })
                  )
              )
            )
          ),
          Effect.flatMap((_) => SubscriptionRef.set(projectionRef, _))
        )

        const makeAppendEvent = (eventsRef: Ref.Ref<Array<Event>>) =>
          (events: Iterable<Event>) => Ref.update(eventsRef, (_) => _.concat(Array.from(events)))

        const handleCommand = (command: Command) =>
          pipe(
            SubscriptionRef.get(projectionRef),
            Effect.flatMap((currentProjection) =>
              pipe(
                Ref.make<Array<Event>>([]),
                Effect.flatMap((eventsRef) =>
                  pipe(
                    decide(command, currentProjection.state, makeAppendEvent(eventsRef)),
                    Effect.zipRight(Ref.get(eventsRef)),
                    Effect.flatMap((events) =>
                      pipe(
                        Effect.forEach(events, (_) => serialization.encode(_, eventsSchema)),
                        Effect.flatMap((byteArrays) =>
                          eventStore.persistEvents(streamId, currentProjection.version, byteArrays)
                        )
                      )
                    )
                  )
                )
              )
            )
          )

        return yield* _(pipe(
          Effect.log(`Warming up entity ${streamId}`, "Info"),
          Effect.zipRight(updateProjection),
          Effect.flatMap((_) =>
            pipe(
              Queue.take(dequeue),
              Effect.flatMap(handleCommand),
              Effect.zipRight(updateProjection),
              Effect.forever
            )
          ),
          Effect.catchAllCause(Effect.logCause("Error")),
          Effect.onInterrupt(() => Effect.log(`Shutting down entity ${streamId}`, "Info"))
        ))
      })
}
