import * as Effect from "@effect-ts/core/Effect"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as BinaryEvent from "@mattiamanzati/effect-es/BinaryEvent"
import * as EventSourced from "@mattiamanzati/effect-es/EventSourced"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

const [ProcessEvent_, ProcessEvent] = Message.schema(Schema.boolean)(Schema.struct({
  _tag: Schema.literal("ProcessEvent"),
  event: BinaryEvent.schema
}))

const Command = Schema.union(ProcessEvent_)
type Command = Schema.To<typeof Command>

export function makeWorkflowRecipientType(name: string) {
  return RecipientType.makeEntityType(name, Command)
}

const EventProcessed = Schema.struct({
  _tag: Schema.literal("EventProcessed"),
  sequence: Schema.bigint
})

const Event = Schema.union(EventProcessed)

interface WorkflowState {
  lastSequence: bigint
}

export function makeWorkflowBehaviour(recipientType: RecipientType.RecipientType<Command>) {
  return EventSourced.behaviour(EventSourced.make(recipientType, Event))(
    {
      lastSequence: BigInt(0)
    } as WorkflowState,
    ({ command, emit, state }) => {
      switch (command._tag) {
        case "ProcessEvent":
          if (state.lastSequence > command.event.sequence) return Effect.unit
      }
    },
    ({ event, state }) => ({ lastSequence: event.sequence > state.lastSequence ? event.sequence : state.lastSequence })
  )
}
