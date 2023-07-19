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
import * as EventSourcedBehaviour from "@mattiamanzati/effect-es/EventSourcedBehaviour"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

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

const Command = Schema.union(Increment_, Decrement_, GetCurrentCount_)

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
  (command, state, emit) => {
    switch (command._tag) {
      case "Increment":
        return emit([{ _tag: "Incremented", amount: command.amount }])
      case "Decrement":
        return emit([{ _tag: "Decremented", amount: command.amount }])
      case "GetCurrentCount":
        return command.replier.reply(state)
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

Effect.gen(function*(_) {
  yield* _(Sharding.registerEntity(SampleEntity, behaviour, Option.none, Option.some(Duration.millis(500))))
  const messenger = yield* _(Sharding.messenger(SampleEntity))

  yield* _(messenger.sendDiscard("counter1")({ _tag: "Increment", amount: 10 }))
  yield* _(messenger.sendDiscard("counter1")({ _tag: "Decrement", amount: 8 }))

  const current = yield* _(messenger.send("counter1")(GetCurrentCount({ _tag: "GetCurrentCount" })))
  yield* _(Effect.log(`Current count is ${current}`, "Info"))

  yield* _(Effect.sleep(Duration.millis(1000)))

  const current2 = yield* _(messenger.send("counter1")(GetCurrentCount({ _tag: "GetCurrentCount" })))
  yield* _(Effect.log(`Current count is still ${current2}! Entity replayed events!`, "Info"))
}).pipe(
  Effect.provideSomeLayer(inMemorySharding),
  Effect.provideSomeLayer(EventStore.inMemory),
  Effect.provideSomeLayer(Serialization.json),
  Effect.scoped,
  Logger.withMinimumLogLevel(LogLevel.All),
  Effect.runPromise
)
