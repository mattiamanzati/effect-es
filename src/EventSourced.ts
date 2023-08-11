/**
 * @since 1.0.0
 */
import * as Data from "@effect/data/Data"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Ref from "@effect/io/Ref/Synchronized"
import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

interface EventSourcedArgs<Event, State> {
  state: State
  emit: <A extends Array<Event>>(...events: A) => Effect.Effect<never, never, void>
}

interface EventSourcedEvolveArgs<Event, State> {
  state: State
  event: Event
  entityId: string
}

interface Projection<State> {
  version: bigint
  state: State
}

export function behaviour<I extends JsonData, Event, State>(
  entityType: string,
  eventsSchema: Schema.Schema<I, Event>,
  initialState: (entityId: string) => State,
  evolve: (args: EventSourcedEvolveArgs<Event, State>) => State
) {
  return (entityId: string) =>
    <R, E, A>(body: (args: EventSourcedArgs<Event, State>) => Effect.Effect<R, E, A>) =>
      Effect.gen(function*(_) {
        const eventStore = yield* _(EventStore.EventStore)
        const projectionRef = yield* _(
          Ref.make<Projection<State>>({ version: BigInt(0), state: initialState(entityId) })
        )

        const updateProjection = Ref.updateAndGetEffect(projectionRef, (currentProjection) =>
          pipe(
            eventStore.readStream(entityType, entityId, currentProjection.version),
            Stream.runFoldEffect(
              currentProjection,
              (p, [version, e]) =>
                Effect.map(
                  Schema.decode(eventsSchema)(e as any),
                  (event) => ({ version, state: evolve({ ...p, entityId, event }) })
                )
            ),
            Effect.catchTag("ParseError", () => Effect.succeed(currentProjection))
          ))

        const makeAppendEvent = (eventsRef: Ref.Synchronized<Array<Event>>) =>
          (...events: Array<Event>) => Ref.update(eventsRef, (_) => _.concat(Array.from(events)))

        return yield* _(pipe(
          updateProjection,
          Effect.flatMap((currentProjection) =>
            pipe(
              Ref.make<Array<Event>>([]),
              Effect.flatMap((eventsRef) =>
                pipe(
                  body({ state: currentProjection.state, emit: makeAppendEvent(eventsRef) }),
                  Effect.tap(() =>
                    pipe(
                      Ref.get(eventsRef),
                      Effect.flatMap((events) => Effect.forEach(events, (_) => Schema.encode(eventsSchema)(_))),
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
}

/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId = "@mattiamanzati/effect-es/EventSourced"

/**
 * @since 1.0.0
 * @category symbols
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category models
 */
export interface EventSourced<Command, Event> {
  _id: TypeId
  recipientType: RecipientType.RecipientType<Command>
  eventsSchema: Schema.Schema<any, Event>
}

/**
 * @since 1.0.0
 * @category constructors
 */
export function make<Command, Event>(
  recipientType: RecipientType.RecipientType<Command>,
  eventsSchema: Schema.Schema<any, Event>
): EventSourced<Command, Event> {
  return Data.struct({ _id: TypeId, recipientType, eventsSchema })
}
