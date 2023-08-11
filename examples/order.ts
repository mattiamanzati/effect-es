import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as ReadonlyArray from "@effect/data/ReadonlyArray"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"

/* Commands */
const PlaceOrder = Schema.struct({
  _tag: Schema.literal("PlaceOrder"),
  productId: Schema.string,
  amount: Schema.number
})

const ShipProduct = Schema.struct({
  _tag: Schema.literal("ShipProduct"),
  productId: Schema.string,
  amount: Schema.number
})

const OrderStatusLine = Schema.struct({
  productId: Schema.string,
  amount: Schema.number,
  shipped: Schema.number
})
type OrderStatusLine = Schema.To<typeof OrderStatusLine>

const OrderStatus = Schema.array(OrderStatusLine)
type OrderStatus = Schema.To<typeof OrderStatus>

export const [GetOrderStatus, GetOrderStatus_] = Message.schema(OrderStatus)(Schema.struct({
  _tag: Schema.literal("GetOrderStatus")
}))

export const Command = Schema.union(PlaceOrder, ShipProduct, GetOrderStatus)

/* Events */
const OrderPlaced = Schema.struct({
  _tag: Schema.literal("OrderPlaced"),
  productId: Schema.string,
  amount: Schema.number
})

const ProductShipped = Schema.struct({
  _tag: Schema.literal("ProductShipped"),
  productId: Schema.string,
  amount: Schema.number
})

export const Event = Schema.union(OrderPlaced, ProductShipped)

export const OrderEntityType = RecipientType.makeEntityType("Order", Command)

const withState = EventSourced.behaviour(OrderEntityType.name, Event, () => [] as OrderStatus, ({ event, state }) => {
  switch (event._tag) {
    case "OrderPlaced":
      return pipe(
        state,
        ReadonlyArray.filter((row) => row.productId !== event.productId),
        ReadonlyArray.append(pipe(
          state,
          ReadonlyArray.findFirst((row) => row.productId === event.productId),
          Option.match({
            onNone: () => ({ productId: event.productId, amount: event.amount, shipped: 0 }) as OrderStatusLine,
            onSome: (row) => ({ ...row, amount: row.amount + event.amount })
          })
        ))
      )
    case "ProductShipped":
      return pipe(
        state,
        ReadonlyArray.filter((row) => row.productId !== event.productId),
        ReadonlyArray.append(pipe(
          state,
          ReadonlyArray.findFirst((row) => row.productId === event.productId),
          Option.match({
            onNone: () => ({ productId: event.productId, amount: 0, shipped: event.amount }) as OrderStatusLine,
            onSome: (row) => ({ ...row, shipped: row.amount + event.amount })
          })
        ))
      )
  }
})

export const registerEntity = Sharding.registerEntity(OrderEntityType, (productId, dequeue) =>
  pipe(
    PoisonPill.takeOrInterrupt(dequeue),
    Effect.flatMap((msg) =>
      withState(productId)(({ emit, state }) => {
        switch (msg._tag) {
          case "PlaceOrder":
            return emit({ _tag: "OrderPlaced", productId: msg.productId, amount: msg.amount })
          case "ShipProduct":
            return emit({ _tag: "ProductShipped", productId: msg.productId, amount: msg.amount })
          case "GetOrderStatus":
            return msg.replier.reply(state)
        }
      })
    ),
    Effect.forever
  ))
