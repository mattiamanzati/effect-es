/**
 * @since 1.0.0
 */
import * as Data from "@effect/data/Data"
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import type * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref"
import type * as Schema from "@effect/schema/Schema"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import type * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Stream from "@effect/stream/Stream"
import * as SubscriptionRef from "@effect/stream/SubscriptionRef"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

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

interface Projection<State> {
  version: bigint
  state: State
}

export function behaviour<Command, Event>(
  eventSourced: EventSourced<Command, Event>
) {
  return <State, R>(
    initialState: State,
    decide: (
      command: Command,
      state: State,
      emit: (events: Iterable<Event>) => Effect.Effect<never, never, void>,
      changes: Stream.Stream<never, never, State>
    ) => Effect.Effect<R, never, void>,
    evolve: (state: State, event: Event) => State
  ) =>
    (streamId: string, dequeue: Queue.Dequeue<Command | PoisonPill.PoisonPill>) =>
      Effect.gen(function*(_) {
        const eventStore = yield* _(EventStore.EventStore)
        const serialization = yield* _(Serialization.Serialization)
        const projectionRef = yield* _(
          SubscriptionRef.make<Projection<State>>({ version: BigInt(0), state: initialState })
        )
        const changes = projectionRef.changes.pipe(Stream.map((_) => _.state), Stream.changes)

        const updateProjection = pipe(
          SubscriptionRef.get(projectionRef),
          Effect.flatMap((currentProjection) =>
            pipe(
              eventStore.readStream(eventSourced.recipientType.name, streamId, currentProjection.version),
              Stream.runFoldEffect(
                currentProjection,
                (p, e) =>
                  Effect.map(
                    serialization.decode(e.body, eventSourced.eventsSchema),
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
                    decide(command, currentProjection.state, makeAppendEvent(eventsRef), changes),
                    Effect.zipRight(Ref.get(eventsRef)),
                    Effect.flatMap((events) =>
                      pipe(
                        Effect.forEach(events, (_) => serialization.encode(_, eventSourced.eventsSchema)),
                        Effect.flatMap((byteArrays) =>
                          eventStore.persistEvents(
                            eventSourced.recipientType.name,
                            streamId,
                            currentProjection.version,
                            byteArrays
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )

        return yield* _(pipe(
          Effect.logInfo(`Warming up entity ${streamId}`),
          Effect.zipRight(updateProjection),
          Effect.flatMap((_) =>
            pipe(
              PoisonPill.takeOrInterrupt(dequeue),
              Effect.flatMap(handleCommand),
              Effect.zipRight(updateProjection),
              Effect.forever
            )
          ),
          Effect.catchAllCause(Effect.logError),
          Effect.onInterrupt(() => Effect.logInfo(`Shutting down entity ${streamId}`))
        ))
      })
}
