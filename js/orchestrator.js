/**
 * AltTextAITaskOrchestrator encapsulates the logic for in-flight requests, 
 * prewarming adoption, and exact-match caching using O(1) Map lookups.
 */
export class AltTextAITaskOrchestrator {
  constructor(maxCacheSize = 5) {
    this.ongoingTasks = new Map(); // key -> taskRecord
    this.caches = new Map(); // key -> result

    // To support LRU maxCacheSize, we maintain a history of keys
    this.cacheKeys = [];
    this.maxCacheSize = maxCacheSize;
  }

  async _getKey(image, hint) {
    let imageData = "";

    if (typeof image === 'string') {
      imageData = image;
    } else if (image instanceof File || image instanceof Blob) {
      // 1. Capture metadata for a base layer of uniqueness
      const meta = `${image.name || 'blob'}-${image.size}-${image.lastModified || ''}`;

      // 2. Sample the first 10KB of the actual content
      // This catches cases where two different blobs have the same size/timestamp
      try {
        const chunk = image.slice(0, 10240); // 10KB
        const buffer = await chunk.arrayBuffer();
        // Convert buffer to a string-like format for the hash function
        const view = new Uint8Array(buffer);
        imageData = meta + view.slice(0, 100).join(''); // Use meta + first 100 bytes of the slice
      } catch (e) {
        imageData = meta; // Fallback to metadata if reading fails
      }
    } else if (image && image.src) {
      imageData = image.src;
    } else {
      imageData = String(image);
    }

    // DJB2 Hash Implementation
    let hash = 5381;
    for (let i = 0; i < imageData.length; i++) {
      hash = (hash * 33) ^ imageData.charCodeAt(i);
    }

    return `${hash >>> 0}-${hint}`;
  }

  /**
   * Main entry point to get a prediction.
   * If an identical request is in-flight, it returns the existing promise (adoption).
   * If an identical request is cached, it returns the cached result.
   * 
   * @param {any} image 
   * @param {string} hint 
   * @param {function} executor - An async function (signal) => Promise<string>
   * @param {object} options - Options bag { force: boolean, speculative: boolean }
   * @returns {Promise<{result: string, type: 'cached' | 'adopted' | 'fresh'}>}
   */
  async execute(image, hint, executor, options = { force: false, speculative: false }) {
    const key = await this._getKey(image, hint);

    if (!options.force) {
      if (this.caches.has(key)) {
        return { result: this.caches.get(key), type: 'cached' };
      }

      if (this.ongoingTasks.has(key)) {
        const ongoing = this.ongoingTasks.get(key);
        const result = await ongoing.promise;
        return { result, type: 'adopted' };
      }
    }

    // Single-task behavior logic:
    // If this is NOT speculative, it is the primary focus. Abort all unmatching tasks.
    if (!options.speculative) {
      for (const [taskKey, task] of this.ongoingTasks.entries()) {
        if (taskKey !== key) {
          task.abortController.abort();
          this.ongoingTasks.delete(taskKey);
        }
      }
    }

    // Fire new computation
    const abortController = new AbortController();
    const taskRecord = { abortController };

    const promise = (async () => {
      try {
        const result = await executor(abortController.signal);

        // Promote to cache on success
        this.caches.set(key, result);
        this.cacheKeys.push(key);

        // LRU cleanup
        if (this.cacheKeys.length > this.maxCacheSize) {
          const oldestKey = this.cacheKeys.shift();
          this.caches.delete(oldestKey);
        }

        return result;
      } finally {
        if (this.ongoingTasks.get(key) === taskRecord) {
          this.ongoingTasks.delete(key);
        }
      }
    })();

    taskRecord.promise = promise;
    this.ongoingTasks.set(key, taskRecord);

    const result = await promise;
    return { result, type: 'fresh' };
  }

  /**
   * Clears a specific item from the cache. Should be called when a 
   * result is consumed to ensure it isn't incorrectly reused later.
   */
  async consume(image, hint) {
    if (image === undefined || hint === undefined) {
      this.caches.clear();
      this.cacheKeys = [];
    } else {
      const key = await this._getKey(image, hint);
      this.caches.delete(key);
      this.cacheKeys = this.cacheKeys.filter(k => k !== key);
    }
  }

  /**
   * Manually aborts all ongoing generations.
   */
  abort() {
    for (const task of this.ongoingTasks.values()) {
      task.abortController.abort();
    }
    this.ongoingTasks.clear();
  }

  /**
   * Helper to check cache status synchronously.
   */
  async hasCache(image, hint) {
    const key = await this._getKey(image, hint);
    return this.caches.has(key);
  }

  /**
   * Get Cached Result synchronously if needed
   */
  async getCachedResult(image, hint) {
    const key = await this._getKey(image, hint);
    return this.caches.has(key) ? this.caches.get(key) : null;
  }
}
