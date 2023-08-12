/**
 * @since 1.0.0
 */
import { Tag } from "@effect/data/Context"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Ref from "@effect/io/Ref/Synchronized"
import type * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

interface EventSourcedEvolveArgs<Event, State> {
  state: State
  event: Event
  entityId: string
}

interface Projection<State> {
  version: bigint
  state: State
}

export interface UncommittedEvents {
  currentProjection: Projection<any>
  eventsRef: Ref.Synchronized<any>
}
const UncommittedEvents = Tag<UncommittedEvents>()

export function make<I extends JsonData, Event, State>(
  entityType: string,
  eventsSchema: Schema.Schema<I, Event>,
  initialState: (entityId: string) => State,
  evolve: (args: EventSourcedEvolveArgs<Event, State>) => State
) {
  const append = (...newEvents: Array<Event>) =>
    pipe(
      UncommittedEvents,
      Effect.flatMap((_) => Ref.update(_.eventsRef, (events) => events.concat(newEvents)))
    )

  const currentState = pipe(
    UncommittedEvents,
    Effect.map((_) => _.currentProjection.state as State)
  )

  const commitOrRetry = (entityId: string) =>
    <R, E, A>(body: Effect.Effect<R | UncommittedEvents, E, A>) =>
      Effect.gen(function*(_) {
        const eventStore = yield* _(EventStore.EventStore)
        const serialization = yield* _(Serialization.Serialization)
        const projectionRef = yield* _(
          Ref.make<Projection<State>>({ version: BigInt(0), state: initialState(entityId) })
        )

        const updateProjection = Ref.updateAndGetEffect(projectionRef, (currentProjection) =>
          pipe(
            eventStore.readStream(entityType, entityId, currentProjection.version),
            Stream.runFoldEffect(
              currentProjection,
              (p, { body, version }) =>
                Effect.map(
                  serialization.decode(body, eventsSchema),
                  (event) => ({ version, state: evolve({ ...p, entityId, event }) })
                )
            ),
            Effect.orDie
          ))

        return yield* _(pipe(
          updateProjection,
          Effect.flatMap((currentProjection) =>
            pipe(
              Ref.make<Array<Event>>([]),
              Effect.flatMap((eventsRef) =>
                pipe(
                  Effect.provideService(body, UncommittedEvents, { currentProjection, eventsRef }),
                  Effect.tap(() =>
                    pipe(
                      Ref.get(eventsRef),
                      Effect.flatMap((events) => Effect.forEach(events, (_) => serialization.encode(_, eventsSchema))),
                      Effect.catchAllCause(Effect.logError),
                      Effect.flatMap((byteArrays) =>
                        eventStore.persistEvents(
                          entityType,
                          entityId,
                          currentProjection.version,
                          byteArrays || []
                        )
                      )
                    )
                  )
                )
              )
            )
          ),
          Effect.retryWhile(() => false)
        ))
      })

  return { append, currentState, commitOrRetry }
}
