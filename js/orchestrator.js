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

  _getKey(image, hint) {
    // Determine the string representation
    const imageStr = typeof image === 'string' ? image : (image && image.src ? image.src : String(image));
    // Super simple hash (djb2 style) for the image string to save memory
    let hash = 5381;
    for (let i = 0; i < imageStr.length; i++) {
        hash = (hash * 33) ^ imageStr.charCodeAt(i);
    }
    // Combine hash with hint
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
    const key = this._getKey(image, hint);

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
  consume(image, hint) {
    if (image === undefined || hint === undefined) {
      this.caches.clear();
      this.cacheKeys = [];
    } else {
      const key = this._getKey(image, hint);
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
  hasCache(image, hint) {
    const key = this._getKey(image, hint);
    return this.caches.has(key);
  }

  /**
   * Get Cached Result synchronously if needed
   */
  getCachedResult(image, hint) {
    const key = this._getKey(image, hint);
    return this.caches.has(key) ? this.caches.get(key) : null;
  }
}
