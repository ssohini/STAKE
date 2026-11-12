import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Redis } from '@upstash/redis';
import { createAuditEntry } from './audit';
import { isConfiguredEnvValue, isServerlessRuntime } from './env';
import type { Contract } from './types';

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

export interface PayPalLookupRefs {
  customId?: string | null;
  orderId?: string | null;
  authorizationId?: string | null;
}

export interface ContractStore {
  readonly kind: 'json' | 'upstash';
  create(contract: Contract): Promise<Contract>;
  get(id: string): Promise<Contract | null>;
  update(
    id: string,
    updater: (current: Contract) => Contract
  ): Promise<Contract | null>;
  listAll(): Promise<Contract[]>;
  findByPayPalRefs(refs: PayPalLookupRefs): Promise<Contract | null>;
  /**
   * Serializes state transitions for a single contract ID (e.g., settlement or authorization)
   * so concurrent requests cannot double-capture or double-void.
   */
  withLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

interface JsonStoreFile {
  contracts: Record<string, Contract>;
}

export class JsonFileContractStore implements ContractStore {
  readonly kind = 'json' as const;
  private readonly filePath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(process.cwd(), '.data', 'contracts.json');
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async readAllUnsafe(): Promise<JsonStoreFile> {
    try {
      const raw = (await fs.readFile(this.filePath, 'utf8')).replace(
        /^\uFEFF/,
        ''
      );
      const parsed = JSON.parse(raw) as Partial<JsonStoreFile>;
      if (parsed && typeof parsed.contracts === 'object' && parsed.contracts) {
        return { contracts: parsed.contracts };
      }
      return { contracts: {} };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { contracts: {} };
      }
      throw error;
    }
  }

  private async writeAllUnsafe(data: JsonStoreFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
      const tmpPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
        throw new StorageConfigError(
          'Local JSON storage directory is read-only. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your deployment environment variables.'
        );
      }
      throw error;
    }
  }

  async create(contract: Contract): Promise<Contract> {
    return this.enqueueWrite(async () => {
      const db = await this.readAllUnsafe();
      db.contracts[contract.id] = contract;
      await this.writeAllUnsafe(db);
      return contract;
    });
  }

  async get(id: string): Promise<Contract | null> {
    const db = await this.readAllUnsafe();
    return db.contracts[id] ?? null;
  }

  async update(
    id: string,
    updater: (current: Contract) => Contract
  ): Promise<Contract | null> {
    return this.enqueueWrite(async () => {
      const db = await this.readAllUnsafe();
      const existing = db.contracts[id];
      if (!existing) return null;
      const updated = updater(existing);
      db.contracts[id] = updated;
      await this.writeAllUnsafe(db);
      return updated;
    });
  }

  async listAll(): Promise<Contract[]> {
    const db = await this.readAllUnsafe();
    return Object.values(db.contracts).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async findByPayPalRefs(refs: PayPalLookupRefs): Promise<Contract | null> {
    const db = await this.readAllUnsafe();
    if (refs.customId && db.contracts[refs.customId]) {
      return db.contracts[refs.customId];
    }
    const all = Object.values(db.contracts);
    if (refs.authorizationId) {
      const byAuth = all.find(
        (c) => c.paypalAuthorizationId === refs.authorizationId
      );
      if (byAuth) return byAuth;
    }
    if (refs.orderId) {
      const byOrder = all.find((c) => c.paypalOrderId === refs.orderId);
      if (byOrder) return byOrder;
    }
    return null;
  }

  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => gate);
    this.locks.set(id, chain);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === chain) {
        this.locks.delete(id);
      }
    }
  }
}

export class UpstashContractStore implements ContractStore {
  readonly kind = 'upstash' as const;
  private readonly redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  private contractKey(id: string): string {
    return `stake:contract:${id}`;
  }

  private indexKey(): string {
    return 'stake:contracts:ids';
  }

  private orderRefKey(orderId: string): string {
    return `stake:ref:order:${orderId}`;
  }

  private authRefKey(authId: string): string {
    return `stake:ref:auth:${authId}`;
  }

  private lockKey(id: string): string {
    return `stake:lock:${id}`;
  }

  async create(contract: Contract): Promise<Contract> {
    const pipeline = this.redis.pipeline();
    pipeline.set(this.contractKey(contract.id), contract);
    pipeline.sadd(this.indexKey(), contract.id);
    if (contract.paypalOrderId) {
      pipeline.set(this.orderRefKey(contract.paypalOrderId), contract.id);
    }
    if (contract.paypalAuthorizationId) {
      pipeline.set(this.authRefKey(contract.paypalAuthorizationId), contract.id);
    }
    await pipeline.exec();
    return contract;
  }

  async get(id: string): Promise<Contract | null> {
    const contract = await this.redis.get<Contract>(this.contractKey(id));
    return contract ?? null;
  }

  async update(
    id: string,
    updater: (current: Contract) => Contract
  ): Promise<Contract | null> {
    const current = await this.get(id);
    if (!current) return null;
    const updated = updater(current);
    const pipeline = this.redis.pipeline();
    pipeline.set(this.contractKey(id), updated);
    if (updated.paypalOrderId) {
      pipeline.set(this.orderRefKey(updated.paypalOrderId), updated.id);
    }
    if (updated.paypalAuthorizationId) {
      pipeline.set(this.authRefKey(updated.paypalAuthorizationId), updated.id);
    }
    await pipeline.exec();
    return updated;
  }

  async listAll(): Promise<Contract[]> {
    const ids = await this.redis.smembers<string[]>(this.indexKey());
    if (!ids || ids.length === 0) return [];
    const keys = ids.map((id) => this.contractKey(id));
    const records = await this.redis.mget<(Contract | null)[]>(...keys);
    return records
      .filter((c): c is Contract => Boolean(c))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findByPayPalRefs(refs: PayPalLookupRefs): Promise<Contract | null> {
    if (refs.customId) {
      const direct = await this.get(refs.customId);
      if (direct) return direct;
    }
    if (refs.authorizationId) {
      const contractId = await this.redis.get<string>(
        this.authRefKey(refs.authorizationId)
      );
      if (contractId) {
        const found = await this.get(contractId);
        if (found) return found;
      }
    }
    if (refs.orderId) {
      const contractId = await this.redis.get<string>(
        this.orderRefKey(refs.orderId)
      );
      if (contractId) {
        const found = await this.get(contractId);
        if (found) return found;
      }
    }
    return null;
  }

  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const key = this.lockKey(id);
    const token = crypto.randomUUID();
    const maxAttempts = 25;

    let acquired = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.redis.set(key, token, {
        nx: true,
        px: 20_000,
      });
      if (result === 'OK') {
        acquired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (!acquired) {
      throw new Error(
        `Contract ${id} is currently being processed by another request. Please retry.`
      );
    }

    try {
      return await fn();
    } finally {
      // Only delete if we still own the lock token.
      const currentOwner = await this.redis.get<string>(key);
      if (currentOwner === token) {
        await this.redis.del(key);
      }
    }
  }
}

export function isUpstashConfigured(): boolean {
  return (
    isConfiguredEnvValue(process.env.UPSTASH_REDIS_REST_URL) &&
    isConfiguredEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

let singletonStore: ContractStore | null = null;

export function getContractStore(): ContractStore {
  if (singletonStore) return singletonStore;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (isConfiguredEnvValue(url) && isConfiguredEnvValue(token)) {
    singletonStore = new UpstashContractStore(url.trim(), token.trim());
    return singletonStore;
  }

  if (isServerlessRuntime()) {
    throw new StorageConfigError(
      'Serverless deployment requires Upstash Redis. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel Environment Variables and redeploy.'
    );
  }

  singletonStore = new JsonFileContractStore();
  return singletonStore;
}

export function resetContractStoreForTests(): void {
  singletonStore = null;
}

/**
 * Helper to append audit entries safely without breaking immutability of prior entries.
 */
export function withAuditEntries(
  contract: Contract,
  entries: ReturnType<typeof createAuditEntry>[]
): Contract {
  if (entries.length === 0) return contract;
  return {
    ...contract,
    auditTrail: [...contract.auditTrail, ...entries],
  };
}
