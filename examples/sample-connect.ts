import * as Duration from "@effect/data/Duration"
import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Logger from "@effect/io/Logger"
import * as LogLevel from "@effect/io/Logger/Level"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as Pods from "@effect/shardcake/Pods"
import * as PodsHealth from "@effect/shardcake/PodsHealth"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Sharding from "@effect/shardcake/Sharding"
import * as ShardingConfig from "@effect/shardcake/ShardingConfig"
import * as ShardingImpl from "@effect/shardcake/ShardingImpl"
import * as ShardManagerClient from "@effect/shardcake/ShardManagerClient"
import * as Storage from "@effect/shardcake/Storage"
import * as StreamMessage from "@effect/shardcake/StreamMessage"
import * as Stream from "@effect/stream/Stream"
import * as EventSourcedBehaviour from "@mattiamanzati/effect-es/EventSourcedBehaviour"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as EventStoreSqlite from "@mattiamanzati/effect-es/EventStoreSqlite"

const inMemorySharding = pipe(
  ShardingImpl.live,
  Layer.use(PodsHealth.noop),
  Layer.use(Pods.noop),
  Layer.use(Storage.memory),
  Layer.use(Serialization.json),
  Layer.use(ShardManagerClient.local),
  Layer.use(ShardingConfig.withDefaults({ simulateRemotePods: false }))
)

/* Commands */
const Increment_ = Schema.struct({
  _tag: Schema.literal("Increment"),
  amount: Schema.number
})

const Decrement_ = Schema.struct({
  _tag: Schema.literal("Decrement"),
  amount: Schema.number
})

const [GetCurrentCount_, GetCurrentCount] = Message.schema(Schema.number)(
  Schema.struct({
    _tag: Schema.literal("GetCurrentCount")
  })
)

const [SubscribeCount_, SubscribeCount] = StreamMessage.schema(Schema.number)(
  Schema.struct({
    _tag: Schema.literal("SubscribeCount")
  })
)

const Command = Schema.union(Increment_, Decrement_, GetCurrentCount_, SubscribeCount_)

/* Events */
const Incremented_ = Schema.struct({
  _tag: Schema.literal("Incremented"),
  amount: Schema.number
})

const Decremented_ = Schema.struct({
  _tag: Schema.literal("Decremented"),
  amount: Schema.number
})

const Event = Schema.union(Incremented_, Decremented_)

const SampleEntity = RecipientType.makeEntityType("SampleEntity", Command)

const behaviour = EventSourcedBehaviour.make(SampleEntity, Event)(
  0,
  (command, state, emit, changes) => {
    switch (command._tag) {
      case "Increment":
        return emit([{ _tag: "Incremented", amount: command.amount }])
      case "Decrement":
        return emit([{ _tag: "Decremented", amount: command.amount }])
      case "GetCurrentCount":
        return command.replier.reply(state)
      case "SubscribeCount":
        return command.replier.reply(changes)
    }
  },
  (state, event) => {
    switch (event._tag) {
      case "Incremented":
        return state + event.amount
      case "Decremented":
        return state - event.amount
    }
  }
)

const processManager = pipe(
  EventStore.EventStore,
  Effect.map((eventStore) =>
    pipe(
      eventStore.readJournal(BigInt(0), false),
      Stream.tap((e) => Effect.logInfo("process-manager event " + e.id))
    )
  ),
  Stream.unwrapScoped,
  Stream.runDrain,
  Effect.catchAllCause(Effect.logError)
)

Effect.gen(function*(_) {
  yield* _(Sharding.registerEntity(SampleEntity, behaviour, Option.some(Duration.millis(500))))
  yield* _(Sharding.registerSingleton(
    "process-manager",
    processManager
  ))
  yield* _(Sharding.registerScoped)

  const messenger = yield* _(Sharding.messenger(SampleEntity))

  const changes = yield* _(messenger.sendStream("counter1")(SubscribeCount({ _tag: "SubscribeCount" })))
  yield* _(changes.pipe(Stream.tap((_) => Effect.logInfo(`Count updated to ${_}`)), Stream.runDrain, Effect.fork))

  yield* _(messenger.sendDiscard("counter1")({ _tag: "Increment", amount: 10 }))
  yield* _(messenger.sendDiscard("counter1")({ _tag: "Decrement", amount: 8 }))

  const current = yield* _(messenger.send("counter1")(GetCurrentCount({ _tag: "GetCurrentCount" })))
  yield* _(Effect.logInfo(`Current count is ${current}`))

  yield* _(Effect.sleep(Duration.millis(1000)))

  const current2 = yield* _(messenger.send("counter1")(GetCurrentCount({ _tag: "GetCurrentCount" })))
  yield* _(Effect.logInfo(`Current count is still ${current2}! Entity replayed events!`))
}).pipe(
  Effect.provideSomeLayer(inMemorySharding),
  Effect.provideSomeLayer(EventStoreSqlite.eventStoreSqlite("events.sqlite3")),
  Effect.provideSomeLayer(Serialization.json),
  Effect.scoped,
  Logger.withMinimumLogLevel(LogLevel.All),
  Effect.runPromise
)
