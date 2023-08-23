import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Envelope from "@mattiamanzati/effect-es/Envelope"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"
import * as EventStoreSqlite from "@mattiamanzati/effect-es/EventStoreSqlite"
import * as Sqlite from "@mattiamanzati/effect-es/Sqlite"

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

export const InventoryJournal = EventSourced.make(
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
  },
  EventStoreSqlite.sqlLite
)

const handleCommand = (productId: string, command: Command) =>
  InventoryJournal.updateEffect(productId)(({ append, currentState }) => {
    return Envelope.matchTag(command)({
      Increase: (body) =>
        pipe(
          Envelope.makeRelatedEffect({ _tag: "Incremented", productId, amount: body.body.amount }),
          Effect.flatMap(append),
          Effect.zipLeft(Effect.logInfo("Inventory of " + productId + " increasing by " + body.body.amount))
        ),
      Decrease: (body) =>
        pipe(
          Envelope.makeRelatedEffect({ _tag: "Decremented", productId, amount: body.body.amount }),
          Effect.flatMap(append),
          Effect.zipLeft(Effect.logInfo("Inventory of " + productId + " decreasing by " + body.body.amount))
        ),
      GetCurrentStock: (body) => Effect.flatMap(currentState, body.replier.reply)
    }).pipe(Effect.unified)
  }).pipe(
    Envelope.provideRelatedEnvelope(command),
    Sqlite.commitTransaction
  )

export const registerEntity = Sharding.registerEntity(InventoryEntityType, (productId, dequeue) =>
  pipe(
    PoisonPill.takeOrInterrupt(dequeue),
    Effect.flatMap((command) => handleCommand(productId, command)),
    Effect.forever,
    Effect.orDie
  ))
