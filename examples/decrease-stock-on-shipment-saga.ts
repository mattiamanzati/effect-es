import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Stream from "@effect/stream/Stream"
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as Saga from "@mattiamanzati/effect-es/Saga"
import * as Inventory from "./inventory"
import * as Order from "./order"

/* Commands */
export const Command = Schema.union(Order.Event, Inventory.Event)
export type Command = Schema.To<typeof Command>

export const DecreaseStockOnShipmentType = RecipientType.makeEntityType("DecreaseStockOnShipmentSaga", Command)

export const routeEvents = Saga.createSagaRouter(
  DecreaseStockOnShipmentType,
  (event) => Option.some(event.body.productId)
)(
  Stream.merge(Inventory.InventoryJournal.readJournal, Order.OrderJournal.readJournal)
)

export const registerSaga = Sharding.registerEntity(
  DecreaseStockOnShipmentType,
  (sagaId, dequeue) =>
    pipe(
      PoisonPill.takeOrInterrupt(dequeue),
      Effect.flatMap((event) =>
        Effect.gen(function*(_) {
          if (event.body._tag === "ProductShipped") {
            // decrease the stock upon shipping
            yield* _(Effect.logInfo("Decreasing stock of " + event.body.productId + " due to shipment"))
            const inventoryMessenger = yield* _(Sharding.messenger(Inventory.InventoryEntityType))
            const message = yield* _(
              Envelope.makeEffect({ _tag: "Decrease", amount: event.body.amount })
            )
            yield* _(inventoryMessenger.sendDiscard(event.body.productId)(message))

            // log updated stock
            const newStock = yield* _(
              inventoryMessenger.send(event.body.productId)(
                Inventory.GetCurrentStock(yield* _(Envelope.makeEffect({ _tag: "GetCurrentStock" })))
              )
            )
            yield* _(Effect.log("Stock of product " + event.body.productId + " is now " + newStock))
          }
        }).pipe(Envelope.provideRelatedEnvelope(event), Effect.catchAllCause(Effect.logError))
      ),
      Effect.forever
    )
)
