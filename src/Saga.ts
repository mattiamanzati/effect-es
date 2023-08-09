import { pipe } from "@effect/data/Function"
import * as HashMap from "@effect/data/HashMap"
import * as HashSet from "@effect/data/HashSet"
import * as Option from "@effect/data/Option"
import * as ReadonlyArray from "@effect/data/ReadonlyArray"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Stream from "@effect/stream/Stream"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"

interface SagaManagerState<Msg> {
  // sagaId
  runningIds: HashSet.HashSet<string>
  // eventId -> sagasId
  pendingEventsId: HashMap.HashMap<string, HashSet.HashSet<string>>
  // eventId -> payload
  events: HashMap.HashMap<string, Msg>
}

function initialState<Msg>(): SagaManagerState<Msg> {
  return {
    runningIds: HashSet.empty(),
    pendingEventsId: HashMap.empty(),
    events: HashMap.empty()
  }
}

function addReceiver(sagaId: string) {
  return <Msg>(state: SagaManagerState<Msg>): SagaManagerState<Msg> => {
    return ({
      ...state,
      runningIds: HashSet.add(sagaId)(state.runningIds)
    })
  }
}

function removeReceiver(sagaId: string) {
  return <Msg>(state: SagaManagerState<Msg>): SagaManagerState<Msg> => {
    return ({
      ...state,
      runningIds: HashSet.remove(sagaId)(state.runningIds),
      pendingEventsId: HashMap.remove(sagaId)(state.pendingEventsId)
    })
  }
}

function addEvent<Msg>(eventId: string, event: Msg) {
  return (state: SagaManagerState<Msg>): SagaManagerState<Msg> => {
    return ({
      ...state,
      events: HashMap.set(state.events, eventId, event),
      pendingEventsId: HashMap.set(state.pendingEventsId, eventId, state.runningIds)
    })
  }
}

function addAcknoledgment(sagaId: string, eventId: string) {
  return <Msg>(state: SagaManagerState<Msg>): SagaManagerState<Msg> => {
    const hashSet = pipe(
      HashMap.get(state.pendingEventsId, eventId),
      Option.match({
        onNone: () => HashSet.empty<string>(),
        onSome: HashSet.remove(sagaId)
      })
    )

    // everyone acknoledged, remove the entry
    if (HashSet.size(hashSet) === 0) {
      return ({
        ...state,
        events: HashMap.remove(state.events, eventId),
        pendingEventsId: HashMap.remove(state.pendingEventsId, eventId)
      })
    }

    // there are still missing acknoledge
    return ({
      ...state,
      pendingEventsId: HashMap.set(state.pendingEventsId, eventId, hashSet)
    })
  }
}

function nextPendingEvent<Msg>(
  excludeEventId: string,
  state: SagaManagerState<Msg>
) {
  return pipe(
    HashMap.keySet(state.pendingEventsId),
    HashSet.filter((eventId) => eventId !== excludeEventId),
    ReadonlyArray.fromIterable,
    ReadonlyArray.head,
    Option.flatMap((eventId) => HashMap.get(state.events, eventId))
  )
}

function forkSendEventToSagas<Msg>(
  recipientType: RecipientType.EntityType<Msg>,
  event: Msg,
  sagasId: HashSet.HashSet<string>
) {
  return pipe(
    sagasId,
    Effect.forEach((sagaId) =>
      pipe(
        Sharding.messenger(recipientType),
        Effect.flatMap((messenger) => messenger.sendDiscard(sagaId)(event))
      )
    ),
    Effect.forkDaemon,
    Effect.asUnit
  )
}

export function make<Msg>(sagaType: RecipientType.EntityType<Msg>, makeId: (msg: Msg) => string) {
  const AckReception = Schema.struct({
    _tag: Schema.literal("AckReception"),
    sagaId: Schema.string,
    eventId: Schema.string
  })

  const StartSaga = Schema.struct({
    _tag: Schema.literal("StartSaga"),
    sagaId: Schema.string
  })

  const CompleteSaga = Schema.struct({
    _tag: Schema.literal("CompleteSaga"),
    sagaId: Schema.string
  })

  const BroadcastEvent = Schema.struct({
    _tag: Schema.literal("BroadcastEvent"),
    event: sagaType.schema
  })

  const Command = Schema.union(AckReception, StartSaga, CompleteSaga, BroadcastEvent)

  const SagaManagerEntity = RecipientType.makeEntityType("SagaManager(" + sagaType.name + ")", Command)

  const SendStarted = Schema.struct({
    _tag: Schema.literal("SendStarted"),
    eventId: Schema.string,
    event: sagaType.schema
  })

  const AckReceived = Schema.struct({
    _tag: Schema.literal("AckReceived"),
    sagaId: Schema.string,
    eventId: Schema.string
  })

  const SagaStarted = Schema.struct({
    _tag: Schema.literal("SagaStarted"),
    sagaId: Schema.string
  })

  const SagaCompleted = Schema.struct({
    _tag: Schema.literal("SagaCompleted"),
    sagaId: Schema.string
  })

  const Event = Schema.union(SendStarted, AckReceived, SagaStarted, SagaCompleted)

  const SagaManager = EventSourced.make(SagaManagerEntity, Event)

  const behaviour = EventSourced.behaviour(SagaManager)(
    initialState<Msg>(),
    ({ command, emit, state }) => {
      switch (command._tag) {
        case "StartSaga":
          return emit([{ _tag: "SagaStarted", sagaId: command.sagaId }])
        case "CompleteSaga":
          return emit([{ _tag: "SagaCompleted", sagaId: command.sagaId }])
        case "AckReception":
          return pipe(
            emit([{
              _tag: "AckReceived",
              sagaId: command.sagaId,
              eventId: command.eventId
            }]),
            // begin sending next event if any
            Effect.zipLeft(pipe(
              nextPendingEvent(command.eventId, state),
              Option.match({
                onNone: () => Effect.unit,
                onSome: (event) => forkSendEventToSagas(sagaType, event, HashSet.fromIterable([command.sagaId]))
              })
            ))
          )
        case "BroadcastEvent":
          return pipe(
            emit([{ _tag: "SendStarted", event: command.event, eventId: makeId(command.event) }]),
            // immediately attempt to send event
            Effect.zipLeft(forkSendEventToSagas(sagaType, command.event, state.runningIds))
          )
      }
    },
    ({ event, state }) => {
      switch (event._tag) {
        case "SagaStarted":
          return addReceiver(event.sagaId)(state)
        case "SagaCompleted":
          return removeReceiver(event.sagaId)(state)
        case "SendStarted":
          return addEvent(event.eventId, event.event)(state)
        case "AckReceived":
          return addAcknoledgment(event.sagaId, event.eventId)(state)
      }
    }
  )

  function startSaga(sagaId: string) {
    return pipe(
      Sharding.messenger(SagaManagerEntity),
      Effect.flatMap((messenger) => messenger.sendDiscard("manager")({ _tag: "StartSaga", sagaId }))
    )
  }

  function completeSaga(sagaId: string) {
    return pipe(
      Sharding.messenger(SagaManagerEntity),
      Effect.flatMap((messenger) => messenger.sendDiscard("manager")({ _tag: "CompleteSaga", sagaId }))
    )
  }

  function broadcastEvent(event: Msg) {
    return pipe(
      Sharding.messenger(SagaManagerEntity),
      Effect.flatMap((messenger) => messenger.sendDiscard("manager")({ _tag: "BroadcastEvent", event }))
    )
  }

  const registerManager = Sharding.registerEntity(SagaManagerEntity, behaviour)

  function registerSingleton(producer: Stream.Stream<never, never, Msg>) {
    const behaviour = pipe(
      producer,
      Stream.mapEffect(broadcastEvent),
      Stream.runDrain,
      Effect.catchAllCause(Effect.logError)
    )
    return Sharding.registerSingleton(SagaManagerEntity.name, behaviour)
  }

  return { startSaga, completeSaga, broadcastEvent, registerSingleton, registerManager }
}
