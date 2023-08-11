// import { pipe } from "@effect/data/Function"
// import * as Effect from "@effect/io/Effect"
// import * as Schema from "@effect/schema/Schema"
// import * as Message from "@effect/shardcake/Message"
// import * as PoisonPill from "@effect/shardcake/PoisonPill"
// import * as RecipientType from "@effect/shardcake/RecipientType"
// import * as Sharding from "@effect/shardcake/Sharding"
// import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"
// import * as PersistedEvent from "@mattiamanzati/effect-es/PersistedEvent"
// import * as Saga from "@mattiamanzati/effect-es/Saga"
// import * as Inventory from "./inventory"
// import * as Order from "./order"
// import * as EventStore from "@mattiamanzati/effect-es/EventStore"
// import * as Option from "@effect/data/Option"
// import * as Stream from "@effect/stream/Stream"

// /* Commands */
// export const Command = Schema.union(PersistedEvent.schema(Schema.literal(Inventory.InventoryEntityType.name), Inventory.Event), PersistedEvent.schema(Schema.literal(Order.OrderEntityType.name), Order.Event))

// export const WarnStockSagaType = RecipientType.makeEntityType("WarnStockSaga", Command)

// const eventJournal = pipe(
//     EventStore.EventStore,
//     Stream.flatMap(eventStore => eventStore.readJournal),
//     Stream.filter(Schema.is(Command)),
//     Stream.mapEffect(_ => Schema.encode(PersistedEvent.schema(Schema.string, PersistedEvent.jsonDataSchema))(_)),
//     Stream.mapEffect(_ => Schema.decode(Command)(_)),
// )
// export const routeEvents = Saga.register(WarnStockSagaType)(event => {
//     const payload = event.body
//     switch(payload._tag){
//         case "Decremented":
//         case "Incremented":
//             return Option.some(event.entityId)
//         case "OrderPlaced":
//         case "ProductShipped":
//             return Option.some(payload.productId)
//     }
// }, eventJournal)

// export const registerSaga = Sharding.registerEntity(WarnStockSagaType, (sagaId, dequeue) =>
//   pipe(
//     PoisonPill.takeOrInterrupt(dequeue),
//     Effect.flatMap((msg) =>

//     ),
//     Effect.forever
//   ))
