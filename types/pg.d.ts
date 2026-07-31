declare module "pg" {
  namespace pg {
    interface QueryResultRow {
      [column: string]: unknown;
    }

    interface FieldDef {
      name: string;
      tableID: number;
      columnID: number;
      dataTypeID: number;
      dataTypeSize: number;
      dataTypeModifier: number;
      format: string;
    }

    interface QueryResult<R extends QueryResultRow = QueryResultRow> {
      command: string;
      rowCount: number | null;
      oid: number;
      fields: FieldDef[];
      rows: R[];
    }

    interface QueryConfig<I extends readonly unknown[] = readonly unknown[]> {
      name?: string;
      text: string;
      values?: I;
      rowMode?: "array";
      types?: unknown;
    }

    interface PoolConfig {
      connectionString?: string;
      max?: number;
      application_name?: string;
      [key: string]: unknown;
    }

    class Client {
      query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<QueryResult<R>>;
      query<R extends QueryResultRow = QueryResultRow>(
        config: QueryConfig,
      ): Promise<QueryResult<R>>;
    }

    class PoolClient extends Client {
      release(error?: Error | boolean): void;
    }

    class Pool {
      constructor(config?: PoolConfig);
      connect(): Promise<PoolClient>;
      query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<QueryResult<R>>;
      query<R extends QueryResultRow = QueryResultRow>(
        config: QueryConfig,
      ): Promise<QueryResult<R>>;
      end(): Promise<void>;
    }
  }

  export = pg;
}
