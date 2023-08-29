import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as ReadonlyArray from "@effect/data/ReadonlyArray"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/sharding/Message"
import * as PoisonPill from "@effect/sharding/PoisonPill"
import type { RecipientContext } from "@effect/sharding/RecipientBehaviour"
import * as RecipientType from "@effect/sharding/RecipientType"
import * as Sharding from "@effect/sharding/Sharding"
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"
import * as EventStoreSqlite from "@mattiamanzati/effect-es/EventStoreSqlite"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"

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

export const OrderJournal = EventSourced.make(
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
  },
  EventStoreSqlite.sqlLite
)

const handleCommand = ({ entityId: orderId, reply }: RecipientContext<Command>, command: Command) =>
  OrderJournal.updateEffect(orderId)(({ append, currentState }) =>
    Envelope.matchTag(command)({
      PlaceOrder: (body) =>
        pipe(
          Envelope.makeRelatedEffect({
            _tag: "OrderPlaced",
            orderId,
            productId: body.body.productId,
            amount: body.body.amount
          }),
          Effect.flatMap(append),
          Effect.zipLeft(
            Effect.logInfo("Adding " + body.body.amount + " of " + body.body.productId + " to " + orderId)
          )
        ),
      ShipProduct: (body) =>
        pipe(
          Envelope.makeRelatedEffect({
            _tag: "ProductShipped",
            orderId,
            productId: body.body.productId,
            amount: body.body.amount
          }),
          Effect.flatMap(append),
          Effect.zipLeft(
            Effect.logInfo("Shipping " + body.body.amount + " of " + body.body.productId + " to " + orderId)
          )
        ),
      GetOrderStatus: (msg) => pipe(currentState, Effect.flatMap((_) => reply(msg, _)))
    }).pipe(
      Effect.unified
    )
  ).pipe(
    Envelope.provideRelatedEnvelope(command),
    Sqlite.commitTransaction
  )

export const registerEntity = Sharding.registerEntity(OrderEntityType, (ctx) =>
  pipe(
    PoisonPill.takeOrInterrupt(ctx.dequeue),
    Effect.flatMap((command) => handleCommand(ctx, command)),
    Effect.forever,
    Effect.orDie
  ))
