import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as ReadonlyArray from "@effect/data/ReadonlyArray"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"
import * as PersistedMessageQueue from "@mattiamanzati/effect-es/PersistedMessageQueue"

/* Commands */
const PlaceOrder = Envelope.schema(Schema.struct({
  _tag: Schema.literal("PlaceOrder"),
  productId: Schema.string,
  amount: Schema.number
}))

const ShipProduct = Envelope.schema(Schema.struct({
  _tag: Schema.literal("ShipProduct"),
  productId: Schema.string,
  amount: Schema.number
}))

const OrderStatusLine = Schema.struct({
  productId: Schema.string,
  amount: Schema.number,
  shipped: Schema.number
})
type OrderStatusLine = Schema.To<typeof OrderStatusLine>

const OrderStatus = Schema.array(OrderStatusLine)
type OrderStatus = Schema.To<typeof OrderStatus>

export const [GetOrderStatus, GetOrderStatus_] = Message.schema(OrderStatus)(Envelope.schema(Schema.struct({
  _tag: Schema.literal("GetOrderStatus")
})))

export const Command = (Schema.union(PlaceOrder, ShipProduct, GetOrderStatus))
export type Command = Schema.To<typeof Command>

export const OrderEntityType = RecipientType.makeEntityType("Order", Command)
const OrderMessageQueue = PersistedMessageQueue.make(OrderEntityType, (command) => command.id)

/* Events */
const OrderPlaced = Envelope.schema(Schema.struct({
  _tag: Schema.literal("OrderPlaced"),
  orderId: Schema.string,
  productId: Schema.string,
  amount: Schema.number
}))

const ProductShipped = Envelope.schema(Schema.struct({
  _tag: Schema.literal("ProductShipped"),
  orderId: Schema.string,
  productId: Schema.string,
  amount: Schema.number
}))

export const Event = (Schema.union(OrderPlaced, ProductShipped))

const OrderJournal = EventSourced.make(
  OrderEntityType.name,
  Event,
  () => [] as OrderStatus,
  ({ event, state }) => {
    const body = event.body
    switch (body._tag) {
      case "OrderPlaced":
        return pipe(
          state,
          ReadonlyArray.filter((row) => row.productId !== body.productId),
          ReadonlyArray.append(pipe(
            state,
            ReadonlyArray.findFirst((row) => row.productId === body.productId),
            Option.match({
              onNone: () => ({ productId: body.productId, amount: body.amount, shipped: 0 }) as OrderStatusLine,
              onSome: (row) => ({ ...row, amount: row.amount + body.amount })
            })
          ))
        )
      case "ProductShipped":
        return pipe(
          state,
          ReadonlyArray.filter((row) => row.productId !== body.productId),
          ReadonlyArray.append(pipe(
            state,
            ReadonlyArray.findFirst((row) => row.productId === body.productId),
            Option.match({
              onNone: () => ({ productId: body.productId, amount: 0, shipped: body.amount }) as OrderStatusLine,
              onSome: (row) => ({ ...row, shipped: row.amount + body.amount })
            })
          ))
        )
    }
  }
)

export const registerEntity = pipe(
  Sharding.registerEntity(OrderEntityType, (orderId, dequeue) =>
    pipe(
      PoisonPill.takeOrInterrupt(dequeue),
      Effect.flatMap((command) =>
        Envelope.matchTag(command)({
          PlaceOrder: (msg) =>
            pipe(
              Envelope.makeEffect({
                _tag: "OrderPlaced",
                orderId,
                productId: msg.body.productId,
                amount: msg.body.amount
              }),
              Effect.flatMap(OrderJournal.append),
              Effect.zipLeft(
                Effect.logInfo("Adding " + msg.body.amount + " of " + msg.body.productId + " to " + orderId)
              )
            ),
          ShipProduct: (msg) =>
            pipe(
              Envelope.makeEffect({
                _tag: "ProductShipped",
                orderId,
                productId: msg.body.productId,
                amount: msg.body.amount
              }),
              Effect.flatMap(OrderJournal.append),
              Effect.zipLeft(
                Effect.logInfo("Shipping " + msg.body.amount + " of " + msg.body.productId + " to " + orderId)
              )
            ),
          GetOrderStatus: (msg) => pipe(OrderJournal.currentState, Effect.flatMap(msg.replier.reply))
        }).pipe(Effect.unified, OrderJournal.commitOrRetry(orderId), Envelope.withOriginatingEnvelope(command))
      ),
      Effect.forever
    )),
  Effect.provideSomeLayer(OrderMessageQueue)
)
