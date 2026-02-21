// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { DATA_DIR } from '../config';

export interface Checkpoint {
  id: string;
  session_id: string;
  user_input: string;
  assistant_output: string;
  timestamp: string;
  extracted: boolean;
}

export class CheckpointLog {
  private filePath: string;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.filePath = `${dataDir}/checkpoints.jsonl`;
  }

  /** Serialize file writes to prevent read-modify-write races */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn);
    this.writeLock = next.then(() => {}, () => {});
    return next;
  }

  async save(
    sessionId: string,
    userInput: string,
    assistantOutput: string
  ): Promise<string> {
    const id = crypto.randomUUID();
    const checkpoint: Checkpoint = {
      id,
      session_id: sessionId,
      user_input: userInput,
      assistant_output: assistantOutput,
      timestamp: new Date().toISOString(),
      extracted: false,
    };
    await this.serialize(() =>
      appendFile(this.filePath, JSON.stringify(checkpoint) + '\n')
    );
    return id;
  }

  async markExtracted(id: string): Promise<void> {
    await this.serialize(async () => {
      if (!existsSync(this.filePath)) return;
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.length > 0);
      const updated = lines.map((line: string) => {
        try {
          const cp = JSON.parse(line) as Checkpoint;
          if (cp.id === id) cp.extracted = true;
          return JSON.stringify(cp);
        } catch {
          return line;
        }
      });
      await writeFile(this.filePath, updated.join('\n') + '\n');
    });
  }

  async getUnextracted(): Promise<Checkpoint[]> {
    if (!existsSync(this.filePath)) return [];
    const content = await readFile(this.filePath, 'utf-8');
    const results: Checkpoint[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const cp = JSON.parse(line) as Checkpoint;
        if (!cp.extracted) results.push(cp);
      } catch { /* skip malformed lines */ }
    }
    return results;
  }

  async getAll(): Promise<Checkpoint[]> {
    if (!existsSync(this.filePath)) return [];
    const content = await readFile(this.filePath, 'utf-8');
    const results: Checkpoint[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line) as Checkpoint);
      } catch { /* skip malformed lines */ }
    }
    return results;
  }
}

/** Single shared instance — all modules must use this to ensure write lock coordination */
export const checkpointLog = new CheckpointLog(DATA_DIR);
