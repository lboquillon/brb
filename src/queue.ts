// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


import { createLogger } from './lib/logger';

const log = createLogger('queue');

type Job = () => Promise<void>;

export class JobQueue {
  private jobs: Job[] = [];
  private draining = false;

  get pending() {
    return this.jobs.length;
  }

  add(job: Job) {
    this.jobs.push(job);
    void this.drain();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!;
        try {
          await job();
        } catch (err) {
          log.error('Job failed:', err);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

export const queue = new JobQueue();
