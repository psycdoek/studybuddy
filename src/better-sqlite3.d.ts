declare module "better-sqlite3" {
  interface RunResult { changes: number; lastInsertRowid: number | bigint; }
  interface Statement {
    run(...parameters: unknown[]): RunResult;
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown[];
  }
  class Database {
    constructor(filename: string);
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
  }
  export default Database;
}
