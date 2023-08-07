import { pipe } from "@effect/data/Function"
import * as Option from "@effect/data/Option"
import * as ReadonlyArray from "@effect/data/ReadonlyArray"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import * as Sharding from "@effect/shardcake/Sharding"
import * as Stream from "@effect/stream/Stream"
import * as EventStore from "@mattiamanzati/effect-es/EventStore"

interface WorkflowEvent<Msg> {
  sequence: bigint
  senderId: string
  event: Msg
}

export interface Workflow<Msg> {
  recipient: RecipientType.EntityType<WorkflowEvent<Msg>>
  activation: (msg: Msg) => Option.Option<string>
  watches: Array<RecipientType.EntityType<Msg>>
}

export function makeWorkflow<Msg>(
  name: string,
  watches: Array<RecipientType.EntityType<Msg>>,
  activation: (msg: Msg) => Option.Option<string>
): Workflow<Msg> {
  const recipient = RecipientType.makeEntityType(
    name,
    Schema.struct({
      sequence: Schema.BigintFromString,
      senderId: Schema.string,
      event: Schema.union(...watches.map((_) => _.schema))
    })
  )

  return ({ recipient, activation, watches })
}

export function singleton<A>(workflows: Array<Workflow<A>>) {
  return Effect.gen(function*(_) {
    const eventStore = yield* _(EventStore.EventStore)
    const serialization = yield* _(Serialization.Serialization)
    const sharding = yield* _(Sharding.Sharding)

    return pipe(
      eventStore.readJournal(BigInt(0), false),
      Stream.mapEffect((binaryEvent) =>
        Effect.forEach(workflows, (workflow) =>
          pipe(
            ReadonlyArray.findFirst(workflow.watches, (recipient) => recipient.name === binaryEvent.entityType),
            Option.match({
              onNone: () => Effect.unit,
              onSome: (activationRecipient) =>
                pipe(
                  serialization.decode(binaryEvent.body, activationRecipient.schema),
                  Effect.flatMap((event) =>
                    pipe(
                      workflow.activation(event),
                      Option.match({
                        onNone: () => Effect.unit,
                        onSome: (workflowId) =>
                          pipe(
                            sharding.messenger(workflow.recipient).sendDiscard(workflowId)({
                              event,
                              senderId: binaryEvent.entityId,
                              sequence: binaryEvent.sequence
                            })
                          )
                      })
                    )
                  )
                )
            })
          ))
      )
    )
  })
}
