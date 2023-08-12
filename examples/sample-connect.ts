import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Logger from "@effect/io/Logger"
import * as LogLevel from "@effect/io/Logger/Level"
import * as Pods from "@effect/shardcake/Pods"
import * as PodsHealth from "@effect/shardcake/PodsHealth"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Sharding from "@effect/shardcake/Sharding"
import * as ShardingConfig from "@effect/shardcake/ShardingConfig"
import * as ShardingImpl from "@effect/shardcake/ShardingImpl"
import * as ShardManagerClient from "@effect/shardcake/ShardManagerClient"
import * as Storage from "@effect/shardcake/Storage"
import * as EventStoreSqlite from "@mattiamanzati/effect-es/EventStoreSqlite"
import * as Inventory from "./inventory"
import * as Order from "./order"
import * as WarnStockSaga from "./warn-stock-saga"

const inMemorySharding = pipe(
  ShardingImpl.live,
  Layer.use(PodsHealth.noop),
  Layer.use(Pods.noop),
  Layer.use(Storage.memory),
  Layer.use(Serialization.json),
  Layer.use(ShardManagerClient.local),
  Layer.use(ShardingConfig.withDefaults({ simulateRemotePods: false }))
)

Effect.gen(function*(_) {
  yield* _(Inventory.registerEntity)
  yield* _(Order.registerEntity)
  yield* _(WarnStockSaga.registerSaga)
  yield* _(WarnStockSaga.routeEvents)
  yield* _(Sharding.registerScoped)

  const messenger = yield* _(Sharding.messenger(Order.OrderEntityType))

  yield* _(messenger.sendDiscard("order1")({ _tag: "PlaceOrder", productId: "product1", amount: 10 }))
  yield* _(messenger.sendDiscard("order1")({ _tag: "PlaceOrder", productId: "product2", amount: 8 }))

  const current = yield* _(messenger.send("order1")(Order.GetOrderStatus_({ _tag: "GetOrderStatus" })))
  yield* _(Effect.logInfo(`Order status is ${JSON.stringify(current)}`))
}).pipe(
  Effect.provideSomeLayer(inMemorySharding),
  Effect.provideSomeLayer(EventStoreSqlite.eventStoreSqlite("events.sqlite3")),
  Effect.provideSomeLayer(Serialization.json),
  Effect.scoped,
  Logger.withMinimumLogLevel(LogLevel.All),
  Effect.catchAllCause(Effect.logError),
  Effect.runPromise
)
