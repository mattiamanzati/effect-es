/**
 * @since 1.0.0
 */
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Ref from "@effect/io/Ref/Synchronized"
import type * as Schema from "@effect/schema/Schema"
import * as Serialization from "@effect/sharding/Serialization"
import * as Stream from "@effect/stream/Stream"
import type * as EventStore from "@mattiamanzati/effect-es/EventStore"

export interface EventSourcedEvolveArgs<Event, State> {
  state: State
  event: Event
  entityId: string
}

interface Projection<State> {
  version: bigint
  state: State
}

export interface EventSourcedArgs<Event, State> {
  currentState: Effect.Effect<never, never, State>
  append: (...events: Array<Event>) => Effect.Effect<never, never, void>
}

export function make<I, Event, State, R, E>(
  entityType: string,
  eventsSchema: Schema.Schema<I, Event>,
  initialState: (entityId: string) => State,
  evolve: (args: EventSourcedEvolveArgs<Event, State>) => State,
  eventStore: EventStore.EventStore<R, E>
) {
  const readJournal = Effect.gen(function*(_) {
    const serialization = yield* _(Serialization.Serialization)

    return pipe(eventStore.readJournal(entityType), Stream.mapEffect((_) => serialization.decode(_, eventsSchema)))
  }).pipe(Stream.unwrap)

  const updateEffect = (entityId: string) =>
    <R, E>(
      fn: (args: EventSourcedArgs<Event, State>) => Effect.Effect<R, E, void>
    ) =>
      Effect.gen(function*(_) {
        const serialization = yield* _(Serialization.Serialization)
        const projectionRef = yield* _(
          Ref.make<Projection<State>>({ version: BigInt(0), state: initialState(entityId) })
        )
        const eventsRef = yield* _(Ref.make<Array<Event>>([]))

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
            )
          ))

        const append = (...newEvents: Array<Event>) => Ref.update(eventsRef, (events) => events.concat(newEvents))

        const currentState = pipe(
          Ref.get(projectionRef),
          Effect.map((_) => _.state)
        )

        return yield* _(pipe(
          updateProjection,
          Effect.flatMap((currentProjection) =>
            pipe(
              fn({ append, currentState }),
              Effect.zipRight(
                pipe(
                  Ref.get(eventsRef),
                  Effect.flatMap((events) => Effect.forEach(events, (_) => serialization.encode(_, eventsSchema))),
                  Effect.map((byteArrays) =>
                    byteArrays.map((body, idx) => ({
                      entityType,
                      entityId,
                      version: currentProjection.version + BigInt(idx + 1),
                      body
                    }))
                  )
                )
              )
            )
          )
        ))
      })

  return { updateEffect, readJournal }
}
