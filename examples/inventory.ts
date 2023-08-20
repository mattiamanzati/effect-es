import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as RecipientBehaviour from "@effect/shardcake/RecipientBehaviour"
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

export const Command = Schema.union(Increase, Decrease, GetCurrentStock_)
export type Command = Schema.To<typeof Command>

export const InventoryEntityType = RecipientType.makeEntityType("Inventory", Command)

/* Events */
const Incremented = Envelope.schema(Schema.struct({
  _tag: Schema.literal("Incremented"),
  productId: Schema.string,
  amount: Schema.number
}))

const Decremented = Envelope.schema(Schema.struct({
  _tag: Schema.literal("Decremented"),
  productId: Schema.string,
  amount: Schema.number
}))

export const Event = Schema.union(Incremented, Decremented)

const InventoryJournal = EventSourced.make(
  InventoryEntityType.name,
  Event,
  () => 0,
  ({ event, state }) => {
    const body = event.body
    switch (body._tag) {
      case "Incremented":
        return state + body.amount
      case "Decremented":
        return state - body.amount
    }
  }
)

const behaviour = RecipientBehaviour.process(
  InventoryEntityType.schema,
  (productId, command) =>
    Envelope.matchTag(command)({
      Increase: (body) =>
        pipe(
          Envelope.makeEffect({ _tag: "Incremented", productId, amount: body.body.amount }),
          Effect.flatMap(InventoryJournal.append),
          Effect.zipLeft(Effect.logInfo("Inventory of " + productId + " increasing by " + body.body.amount))
        ),
      Decrease: (body) =>
        pipe(
          Envelope.makeEffect({ _tag: "Decremented", productId, amount: body.body.amount }),
          Effect.flatMap(InventoryJournal.append),
          Effect.zipLeft(Effect.logInfo("Inventory of " + productId + " decreasing by " + body.body.amount))
        ),
      GetCurrentStock: (body) => Effect.flatMap(InventoryJournal.currentState, body.replier.reply)
    }).pipe(Effect.unified, InventoryJournal.commitOrRetry(productId), Envelope.withOriginatingEnvelope(command))
)

export const registerEntity = Sharding.registerEntity(InventoryEntityType, behaviour)
