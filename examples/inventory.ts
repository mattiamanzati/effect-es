import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"

/* Commands */
const Increase = Envelope.schema(Schema.struct({
  _tag: Schema.literal("Increase"),
  amount: Schema.number
}))

const Decrease = Envelope.schema(Schema.struct({
  _tag: Schema.literal("Decrease"),
  amount: Schema.number
}))

export const [GetCurrentStock_, GetCurrentStock] = Message.schema(Schema.number)(Envelope.schema(Schema.struct({
  _tag: Schema.literal("GetCurrentStock")
})))

export const Command = (Schema.union(Increase, Decrease, GetCurrentStock_))
export type Command = Schema.To<typeof Command>

/* Events */
const Incremented = Schema.struct({
  _tag: Schema.literal("Incremented"),
  productId: Schema.string,
  amount: Schema.number
})

const Decremented = Schema.struct({
  _tag: Schema.literal("Decremented"),
  productId: Schema.string,
  amount: Schema.number
})

export const Event = Envelope.schema(Schema.union(Incremented, Decremented))

export const InventoryEntityType = RecipientType.makeEntityType("Inventory", Command)

const withState = EventSourced.behaviour(InventoryEntityType.name, Event, () => 0, ({ event, state }) => {
  const body = event.body
  switch (body._tag) {
    case "Incremented":
      return state + body.amount
    case "Decremented":
      return state + body.amount
  }
})

export const registerEntity = Sharding.registerEntity(InventoryEntityType, (productId, dequeue) =>
  pipe(
    PoisonPill.takeOrInterrupt(dequeue),
    Effect.flatMap((msg) =>
      Envelope.process(msg)((envelope) =>
        withState(productId)(({ emit, state }) =>
          Envelope.matchTag(msg)({
            Increase: (body) => emit(envelope({ _tag: "Incremented", productId, amount: body.body.amount })),
            Decrease: (body) => emit(envelope({ _tag: "Incremented", productId, amount: body.body.amount })),
            GetCurrentStock: (body) => body.replier.reply(state)
          })
        )
      )
    ),
    Effect.forever
  ))
