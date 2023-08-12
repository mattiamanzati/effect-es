import { Tag } from "@effect/data/Context"
import * as Option from "@effect/data/Option"
import * as Clock from "@effect/io/Clock"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"

export interface Envelope<A> {
  id: string
  body: A
  createdAt: Date
  causationId: Option.Option<string>
  correlationId: Option.Option<string>
}

export interface OriginatingEnvelope {
  envelope: Envelope<any>
}

const OriginatingEnvelope = Tag<OriginatingEnvelope>()

export function withOriginatingEnvelope(envelope: Envelope<any>){
  return Effect.provideService(OriginatingEnvelope, { envelope })
}

export function schema<I extends JsonData, A>(bodySchema: Schema.Schema<I, A>) {
  return Schema.struct({
    id: Schema.string,
    body: bodySchema,
    createdAt: Schema.Date,
    causationId: Schema.option(Schema.string),
    correlationId: Schema.option(Schema.string)
  })
}

const makeUUID = Effect.sync(() => Math.random().toString())

export function make<const A>(body: A) {
  return Effect.gen(function*(_){
    const id = yield* _(makeUUID)
    const nowMillis = yield* _(Clock.currentTimeMillis)

    const result: Envelope<A> =  ({
      id,
      body,
      createdAt: new Date(nowMillis),
      correlationId: Option.none(),
      causationId: Option.none()
    })

    return result
  })
}

export function makeRelated<const A>(body: A){
  return Effect.gen(function*(_){
    const base = yield* _(make(body))

    const result: Envelope<A> = ({...base})

    return result
  })
}

export function matchTag<A extends Envelope<{ _tag: PropertyKey }>>(
  msg: A
): <F extends { [Tag in A["body"]["_tag"]]: (body: Extract<A, Envelope<{ _tag: Tag }>>) => any }>(
  cases: F
) => ReturnType<F[keyof F]> {
  return (cases) => (cases as any)[msg.body._tag](msg)
}
