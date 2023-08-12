import * as Option from "@effect/data/Option"
import * as Schema from "@effect/schema/Schema"
import type { JsonData } from "@effect/shardcake/JsonData"

export interface Envelope<A> {
  id: string
  body: A
  createdAt: Date
  causationId: Option.Option<string>
  correlationId: Option.Option<string>
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

export function process(msg: Envelope<any>) {
  // TODO: creating an Envelope is actually an effect
  return <T>(fn: (make: <A>(body: A) => Envelope<A>) => T): T => {
    const makeLocal = <A>(body: A) =>
      ({
        ...make(body),
        correlationId: Option.orElse(msg.correlationId, () => Option.some(msg.id)),
        causationId: Option.some(msg.id)
      }) as Envelope<A>

    return fn(makeLocal)
  }
}

export function make<A>(body: A): Envelope<A> {
  return ({
    id: Math.random().toString(),
    body,
    createdAt: new Date(),
    correlationId: Option.none(),
    causationId: Option.none()
  })
}

export function matchTag<A extends Envelope<{ _tag: PropertyKey }>>(
  msg: A
): <F extends { [Tag in A["body"]["_tag"]]: (body: Extract<A, Envelope<{ _tag: Tag }>>) => any }>(
  cases: F
) => ReturnType<F[keyof F]> {
  return (cases) => (cases as any)[msg.body._tag](msg)
}
