import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"

/* Commands */
const Increase = Schema.struct({
  _tag: Schema.literal("Increase"),
  amount: Schema.number
})

const Decrease = Schema.struct({
  _tag: Schema.literal("Decrease"),
  amount: Schema.number
})

export const [GetCurrentStock_, GetCurrentStock] = Message.schema(Schema.number)(Schema.struct({
  _tag: Schema.literal("GetCurrentStock")
}))

export const Command = Schema.union(Increase, Decrease, GetCurrentStock_)

/* Events */
const Incremented = Schema.struct({
  _tag: Schema.literal("Incremented"),
  amount: Schema.number
})

const Decremented = Schema.struct({
  _tag: Schema.literal("Decremented"),
  amount: Schema.number
})

export const Event = Schema.union(Incremented, Decremented)

export const InventoryEntityType = RecipientType.makeEntityType("Inventory", Command)

const withState = EventSourced.behaviour(InventoryEntityType.name, Event, () => 0, ({ event, state }) => {
  switch (event._tag) {
    case "Incremented":
      return state + event.amount
    case "Decremented":
      return state + event.amount
  }
})

export const registerEntity = Sharding.registerEntity(InventoryEntityType, (productId, dequeue) =>
  pipe(
    PoisonPill.takeOrInterrupt(dequeue),
    Effect.flatMap((msg) =>
      withState(productId)(({ emit, state }) => {
        switch (msg._tag) {
          case "Increase":
            return emit({ _tag: "Incremented", amount: msg.amount })
          case "Decrease":
            return emit({ _tag: "Decremented", amount: msg.amount })
          case "GetCurrentStock":
            return msg.replier.reply(state)
        }
      })
    ),
    Effect.forever
  ))
