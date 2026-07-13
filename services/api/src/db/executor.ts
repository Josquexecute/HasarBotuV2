import type pg from 'pg'

/**
 * Executor soyutlamasi: bir sorgu havuzda (autocommit) VEYA acik bir
 * transaction istemcisinde calisabilir. Audit yazimi ile is yazimini AYNI
 * transaction'da birlestirmek icin kullanilir; boylece basarisiz islemde yarim
 * is veya yarim audit kaydi kalmaz.
 */
export type Queryable = pg.Pool | pg.PoolClient

/**
 * Tek transaction sarmalayici: `fn` icindeki tum yazimlar atomiktir. Hata
 * durumunda ROLLBACK, basari durumunda COMMIT yapilir; istemci her durumda
 * havuza iade edilir. (Cases yazma katmani kendi BEGIN/COMMIT'ini surdurur;
 * bu yardimci auth gibi yeni cok-adimli akislar icindir.)
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
