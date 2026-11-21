import type { Db } from 'mongodb'

export type TestDocument = Record<string, unknown>
export function readField(doc: TestDocument, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as TestDocument)[key] : undefined,
      doc,
    )
}
const comparable = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value)
function matches(doc: TestDocument, filter: TestDocument): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or' || key === '$and' || key === '$nor') {
      const results = (expected as TestDocument[]).map((part) => matches(doc, part))
      return key === '$or'
        ? results.some(Boolean)
        : key === '$and'
          ? results.every(Boolean)
          : !results.some(Boolean)
    }
    const value = readField(doc, key)
    if (expected instanceof Date) return value instanceof Date && +value === +expected
    if (expected && typeof expected === 'object')
      return Object.entries(expected).every(([operator, operand]) => {
        switch (operator) {
          case '$exists':
            return (value !== undefined) === operand
          case '$in':
            return (operand as unknown[]).includes(value)
          case '$nin':
            return !(operand as unknown[]).includes(value)
          case '$ne':
            return value !== operand
          case '$gt':
            return comparable(value) > comparable(operand)
          case '$gte':
            return comparable(value) >= comparable(operand)
          case '$lt':
            return comparable(value) < comparable(operand)
          case '$lte':
            return comparable(value) <= comparable(operand)
          default:
            throw new Error(`Unsupported test query: ${operator}`)
        }
      })
    return expected === null ? value == null : value === expected
  })
}
function update(doc: TestDocument, change: TestDocument) {
  for (const operator of ['$set', '$unset'])
    for (const [path, value] of Object.entries((change[operator] ?? {}) as TestDocument)) {
      const parts = path.split('.')
      const last = parts.pop()!
      let target = doc
      for (const part of parts) target = (target[part] ??= {}) as TestDocument
      if (operator === '$set') target[last] = value
      else delete target[last]
    }
}

/** Query-aware fake for isolated route tests; actual transactions are covered by integration tests. */
export function memoryDatabase(data: Record<string, TestDocument[]>): Db {
  return {
    collection(name: string) {
      const rows = (data[name] ??= [])
      return {
        async findOne(filter: TestDocument) {
          return structuredClone(rows.find((row) => matches(row, filter)) ?? null)
        },
        find(
          filter: TestDocument,
          options: { sort?: Record<string, number>; limit?: number } = {},
        ) {
          let found = rows.filter((row) => matches(row, filter)).map((row) => structuredClone(row))
          const cursor = {
            sort(sort: Record<string, number>) {
              found.sort((a, b) => {
                for (const [key, direction] of Object.entries(sort)) {
                  const left = readField(a, key)
                  const right = readField(b, key)
                  const compare =
                    left == null
                      ? right == null
                        ? 0
                        : -1
                      : right == null
                        ? 1
                        : typeof left === 'string' && typeof right === 'string'
                          ? left.localeCompare(right)
                          : comparable(left) - comparable(right)
                  if (compare) return compare * direction
                }
                return 0
              })
              return cursor
            },
            limit(limit: number) {
              found = found.slice(0, limit)
              return cursor
            },
            project() {
              return cursor
            },
            async toArray() {
              return found
            },
            async *[Symbol.asyncIterator]() {
              yield* found
            },
          }
          if (options.sort) cursor.sort(options.sort)
          if (options.limit) cursor.limit(options.limit)
          return cursor
        },
        async updateOne(filter: TestDocument, change: TestDocument) {
          const row = rows.find((item) => matches(item, filter))
          if (!row) return { matchedCount: 0, modifiedCount: 0 }
          update(row, change)
          return { matchedCount: 1, modifiedCount: 1 }
        },
        async findOneAndUpdate(filter: TestDocument, change: TestDocument) {
          const row = rows.find((item) => matches(item, filter))
          if (!row) return null
          update(row, change)
          return structuredClone(row)
        },
        async insertOne(doc: TestDocument) {
          rows.push(structuredClone(doc))
        },
        async deleteOne(filter: TestDocument) {
          const index = rows.findIndex((row) => matches(row, filter))
          if (index >= 0) rows.splice(index, 1)
          return { deletedCount: index >= 0 ? 1 : 0 }
        },
      }
    },
  } as unknown as Db
}
