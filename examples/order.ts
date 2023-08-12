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

export const OrderEntityType = RecipientType.makeEntityType("Order", Command)

const OrderJournal = EventSourced.behaviour(
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

export const registerEntity = Sharding.registerEntity(OrderEntityType, (orderId, dequeue) =>
  pipe(
    PoisonPill.takeOrInterrupt(dequeue),
    Effect.flatMap((msg) =>
      Envelope.process(msg)((envelope) =>
        Envelope.matchTag(msg)({
          PlaceOrder: (msg) =>
            OrderJournal.emit(
              envelope({ _tag: "OrderPlaced", orderId, productId: msg.body.productId, amount: msg.body.amount })
            ),
          ShipProduct: (msg) =>
            OrderJournal.emit(
              envelope({ _tag: "ProductShipped", orderId, productId: msg.body.productId, amount: msg.body.amount })
            ),
          GetOrderStatus: (msg) => pipe(OrderJournal.state, Effect.flatMap(msg.replier.reply))
        }).pipe(Effect.unified, OrderJournal.eventTransaction(orderId))
      )
    ),
    Effect.forever
  ))
