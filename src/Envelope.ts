import { Tag } from "@effect/data/Context"
import * as Option from "@effect/data/Option"
import * as Clock from "@effect/io/Clock"
import * as Effect from "@effect/io/Effect"
import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"
import * as Random from "@effect/io/Random"
import * as DeterministicRandom from "@effect/data/DeterministicRandom"

export interface Envelope<A> {
  id: string
  body: A
  createdAt: Date
  causationId: Option.Option<string>
  correlationId: Option.Option<string>
}

export interface RelatedEnvelope {
  envelope: Envelope<any>
}

const RelatedEnvelope = Tag<RelatedEnvelope>()

export function provideRelatedEnvelope(envelope: Envelope<any>){
  return Effect.provideService(RelatedEnvelope, { envelope })
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

export const deterministicUUID = (randomState: DeterministicRandom.PCGRandomState): readonly [string, DeterministicRandom.PCGRandomState] => {
  const random = new DeterministicRandom.PCGRandom()
  random.setState(randomState)
  // @ts-expect-error
  const uuid = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(
    /[018]/g,
    (c: any) => (c ^ (random.integer(256) & (15 >> (c / 4)))).toString(16)
  )
  return [uuid, random.getState()]
}

const makeUUID = Effect.gen(function*(_){
  const a = yield* _(Random.nextIntBetween(0, 255))
  const b = yield* _(Random.nextIntBetween(0, 255))
  const c = yield* _(Random.nextIntBetween(0, 255))
  const d = yield* _(Random.nextIntBetween(0, 255))
  return deterministicUUID([a, b, c, d])[0]
})

export function make<const A>(id: string, body: A, createdAt: Date) {
    const result: Envelope<A> =  ({
      id,
      body,
      createdAt,
      correlationId: Option.none(),
      causationId: Option.none()
    })

    return result
}

export function relatedTo(originating: Envelope<any>){
  return <A>(fa: Envelope<A>): Envelope<A> => ({
    ...fa,
    causationId: Option.some(originating.id), 
    correlationId: Option.orElse(originating.correlationId, () => Option.some(originating.id))
  })
}

export function makeEffect<const A>(body: A) {
  return Effect.gen(function*(_){
    const id = yield* _(makeUUID)
    const nowMillis = yield* _(Clock.currentTimeMillis)
    const originating = yield* _(Effect.serviceOption(RelatedEnvelope))

    const base = make(id, body, new Date(nowMillis))

    return Option.match(originating, {
      onNone: () => base,
      onSome: ({ envelope }) => relatedTo(envelope)(base)
    })
  })
}

export function makeRelatedEffect<const A>(body: A){
  return Effect.flatMap(
    RelatedEnvelope,
    ({ envelope }) => Effect.map(makeEffect(body), relatedTo(envelope))
  )
}

export function matchTag<A extends Envelope<{ _tag: PropertyKey }>>(
  msg: A
): <F extends { [Tag in A["body"]["_tag"]]: (body: Extract<A, Envelope<{ _tag: Tag }>>) => any }>(
  cases: F
) => ReturnType<F[keyof F]> {
  return (cases) => (cases as any)[msg.body._tag](msg)
}
