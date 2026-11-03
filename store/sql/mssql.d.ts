// A3: the part of the mssql package (12.x, MIT; it ships no types) that store/sql/sqlserver.ts uses.
declare module "mssql" {
  export type ISqlType = { type: unknown };
  export const NVarChar: ((length?: number) => ISqlType) & ISqlType;
  export const VarChar: ((length?: number) => ISqlType) & ISqlType;
  export const Int: ISqlType;
  export const BigInt: ISqlType;
  export const Float: ISqlType;
  export const Bit: ISqlType;
  export const DateTime2: ((scale?: number) => ISqlType) & ISqlType;
  export const Date: ISqlType;
  export const MAX: number;

  export type ColumnMetadata = { name: string; type: unknown; index: number };
  export type IRecordSet<T> = T[] & { columns: Record<string, ColumnMetadata> };
  export type IResult<T> = { recordset: IRecordSet<T>; recordsets: IRecordSet<T>[]; rowsAffected: number[] };

  export class Request {
    constructor(parent?: ConnectionPool | Transaction);
    input(name: string, type: ISqlType, value: unknown): Request;
    query<T = Record<string, unknown>>(sql: string): Promise<IResult<T>>;
    batch<T = Record<string, unknown>>(sql: string): Promise<IResult<T>>;
  }
  export class Transaction {
    constructor(pool: ConnectionPool);
    begin(isolation?: number): Promise<Transaction>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }
  export const ISOLATION_LEVEL: { READ_COMMITTED: number; SERIALIZABLE: number; SNAPSHOT: number };

  export type config = {
    server: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    authentication?: { type: string; options: Record<string, unknown> };
    pool?: { max?: number; min?: number; idleTimeoutMillis?: number };
    options?: { encrypt?: boolean; trustServerCertificate?: boolean; useUTC?: boolean; appName?: string; enableArithAbort?: boolean };
    connectionTimeout?: number;
    requestTimeout?: number;
  };
  export class ConnectionPool {
    constructor(config: config);
    connect(): Promise<ConnectionPool>;
    close(): Promise<void>;
    readonly connected: boolean;
    on(event: "error", listener: (e: unknown) => void): this;
  }
  const mssql: {
    ConnectionPool: typeof ConnectionPool;
    Request: typeof Request;
    Transaction: typeof Transaction;
    NVarChar: typeof NVarChar;
    VarChar: typeof VarChar;
    Int: typeof Int;
    BigInt: typeof BigInt;
    Float: typeof Float;
    Bit: typeof Bit;
    DateTime2: typeof DateTime2;
    Date: typeof Date;
    MAX: number;
    ISOLATION_LEVEL: typeof ISOLATION_LEVEL;
  };
  export default mssql;
}
