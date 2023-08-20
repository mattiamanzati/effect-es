import * as Duration from "@effect/data/Duration"
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
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as EventStoreSqlite from "@mattiamanzati/effect-es/EventStoreSqlite"
import * as DecreaseStockOnShipment from "./decrease-stock-on-shipment-saga"
import * as Inventory from "./inventory"
import * as Order from "./order"

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
  yield* _(DecreaseStockOnShipment.registerSaga)
  yield* _(DecreaseStockOnShipment.routeEvents)
  yield* _(Sharding.registerScoped)

  const orderMessenger = yield* _(Sharding.messenger(Order.OrderEntityType))
  const inventoryMessenger = yield* _(Sharding.messenger(Inventory.InventoryEntityType))

  // add first line order
  const msg1 = yield* _(Envelope.makeEffect({ _tag: "PlaceOrder", productId: "product1", amount: 10 }))
  yield* _(orderMessenger.sendDiscard("order1")(msg1))

  // add second line order
  const msg2 = yield* _(Envelope.makeEffect({ _tag: "PlaceOrder", productId: "product2", amount: 8 }))
  yield* _(orderMessenger.sendDiscard("order1")(msg2))

  // loh current status
  const msg3 = yield* _(Envelope.makeEffect({ _tag: "GetOrderStatus" }))
  const current = yield* _(orderMessenger.send("order1")(Order.GetOrderStatus_(msg3)))
  yield* _(Effect.logInfo(`Order status is ${JSON.stringify(current)}`))

  // buy some items in the warehouse
  const msg4 = yield* _(Envelope.makeEffect({ _tag: "Increase", amount: 12 }))
  yield* _(inventoryMessenger.sendDiscard("product1")(msg4))

  // ship some items
  const msg5 = yield* _(Envelope.makeEffect({ _tag: "ShipProduct", productId: "product1", amount: 10 }))
  yield* _(orderMessenger.sendDiscard("order1")(msg5))

  yield* _(Effect.sleep(Duration.millis(10000)))
}).pipe(
  Effect.provideSomeLayer(inMemorySharding),
  Effect.provideSomeLayer(EventStoreSqlite.eventStoreSqlite("events.sqlite3")),
  Effect.provideSomeLayer(Serialization.json),
  Effect.scoped,
  Logger.withMinimumLogLevel(LogLevel.Info),
  Effect.catchAllCause(Effect.logError),
  Effect.runPromise
)
