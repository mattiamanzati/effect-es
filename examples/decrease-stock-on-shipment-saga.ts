import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"
import * as PersistedMessageQueue from "@mattiamanzati/effect-es/PersistedMessageQueue"
import * as Saga from "@mattiamanzati/effect-es/Saga"
import * as Inventory from "./inventory"
import * as Order from "./order"

/* Commands */
export const Command = Schema.union(Order.Event)
export type Command = Schema.To<typeof Command>

export const DecreaseStockOnShipmentType = RecipientType.makeEntityType("DecreaseStockOnShipmentSaga", Command)
const DecreaseStockOnShipmentMessageQueue = PersistedMessageQueue.make(DecreaseStockOnShipmentType, (event) => event.id)

const eventStream = EventStore.readJournalAndDecode(Order.OrderEntityType.name, Order.Event)

export const routeEvents = Saga.createSagaRouter(
  DecreaseStockOnShipmentType,
  (event) => Option.some(event.body.productId)
)(
  eventStream
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
        }).pipe(Envelope.withOriginatingEnvelope(event), Effect.catchAllCause(Effect.logError), Effect.forever)
      )
    )
).pipe(Effect.provideSomeLayer(DecreaseStockOnShipmentMessageQueue))
