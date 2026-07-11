declare const domainBrand: unique symbol

export type Brand<Value, Name extends string> = Value & {
  readonly [domainBrand]: Name
}

export function brandValue<Value, Name extends string>(value: Value): Brand<Value, Name> {
  return value as Brand<Value, Name>
}
