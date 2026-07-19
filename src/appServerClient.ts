import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as readline from "node:readline";
import { EventEmitter } from "node:events";
import type { JsonRpcResponse } from "./types";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CodexAppServerClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | undefined;
  private reader: readline.Interface | undefined;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private starting: Promise<void> | undefined;

  constructor(private readonly codexPath: string) {
    super();
  }

  async start(): Promise<void> {
    if (this.process && !this.process.killed) return;
    if (this.starting) return this.starting;

    this.starting = this.startInternal().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startInternal(): Promise<void> {
    const child = spawn(this.codexPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.process = child;

    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      const message = `Codex App Server exited (${code ?? signal ?? "unknown"}).`;
      this.failAll(new Error(message));
      this.process = undefined;
      this.emit("exit", message);
    });
    child.stderr.on("data", (chunk: Buffer) => this.emit("log", chunk.toString()));

    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "codex_usage_monitor_vscode",
        title: "Codex Usage Monitor for VS Code",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
  }

  async request<T>(method: string, params?: unknown, timeoutMs = 15_000): Promise<T> {
    if (method !== "initialize") await this.start();
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is not writable.");

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  stop(): void {
    this.reader?.close();
    this.process?.kill();
    this.process = undefined;
    this.failAll(new Error("Codex App Server stopped."));
  }

  private write(message: unknown): void {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      this.emit("log", `Ignored non-JSON app-server output: ${line}`);
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if (message.method) this.emit("notification", message.method, message.params);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
