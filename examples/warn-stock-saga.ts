import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Stream from "@effect/stream/Stream"
import * as AtMostOnce from "@mattiamanzati/effect-es/AtMostOnce"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as Saga from "@mattiamanzati/effect-es/Saga"
import * as Inventory from "./inventory"
import * as Order from "./order"

/* Commands */
export const Command = Schema.union(Inventory.Event, Order.Event)

export const WarnStockSagaType = RecipientType.makeEntityType("WarnStockSaga", Command)

const ifNotReceivedBefore = AtMostOnce.make(WarnStockSagaType, (event) => event.id)

const eventStream = pipe(
  EventStore.readJournalAndDecode(Inventory.InventoryEntityType.name, Inventory.Event),
  Stream.merge(EventStore.readJournalAndDecode(Order.OrderEntityType.name, Order.Event))
)

export const routeEvents = Saga.createSagaRouter(WarnStockSagaType, (event) => Option.some(event.body.productId))(
  eventStream
)

export const registerSaga = Sharding.registerEntity(WarnStockSagaType, (sagaId, dequeue) =>
  pipe(
    PoisonPill.takeOrInterrupt(dequeue),
    Effect.flatMap(ifNotReceivedBefore(sagaId)(() => Effect.unit)),
    Effect.forever
  ))
