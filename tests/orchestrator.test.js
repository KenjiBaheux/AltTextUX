import { AltTextAITaskOrchestrator } from '../js/orchestrator.js';
import assert from 'assert';

console.log("Running AltTextAITaskOrchestrator Tests...");

// Helper to simulate an async LLM with an abort signal
function createMockExecutor(resultText, msDelay = 50) {
  return async (signal) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(resultText), msDelay);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          const err = new Error("AbortError");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function testHeader(name) {
    console.log(`\n--- Test: ${name} ---`);
  }

  try {
    testHeader("Fresh prediction executes and caches");
    const engine = new AltTextAITaskOrchestrator();
    const result1 = await engine.execute("img1", "hint1", createMockExecutor("res1", 10));
    assert.strictEqual(result1.type, "fresh");
    assert.strictEqual(result1.result, "res1");
    assert.strictEqual(await engine.hasCache("img1", "hint1"), true);
    passed++;
  } catch(e) { console.error(e); failed++; }

  try {
    testHeader("Multi-Cache Tracks Distinct Predictions");
    const engine = new AltTextAITaskOrchestrator();
    await engine.execute("img1", "hint1", createMockExecutor("res1", 10));
    await engine.execute("img2", "hint2", createMockExecutor("res2", 10));
    
    assert.strictEqual(await engine.hasCache("img1", "hint1"), true);
    assert.strictEqual(await engine.hasCache("img2", "hint2"), true);
    assert.strictEqual(await engine.getCachedResult("img1", "hint1"), "res1");
    assert.strictEqual(await engine.getCachedResult("img2", "hint2"), "res2");
    passed++;
  } catch(e) { console.error(e); failed++; }

  try {
    testHeader("Forced execution bypasses Cache/Adoption");
    const engine = new AltTextAITaskOrchestrator();
    await engine.execute("img1", "hint1", createMockExecutor("res1", 10));
    
    // Forced should not read cache
    const forcedReq = await engine.execute("img1", "hint1", createMockExecutor("res_forced", 10), { force: true });
    assert.strictEqual(forcedReq.type, "fresh");
    assert.strictEqual(forcedReq.result, "res_forced");
    
    // It should push over the cache with the newest though!
    assert.strictEqual(await engine.getCachedResult("img1", "hint1"), "res_forced");
    passed++;
  } catch(e) { console.error(e); failed++; }

  try {
    testHeader("Concurrent tasks don't indiscriminately abort (One-step-ahead)");
    const engine = new AltTextAITaskOrchestrator();
    
    const p1 = engine.execute("img1", "hint1", createMockExecutor("res1", 50), { speculative: true });
    const p2 = engine.execute("img2", "hint2", createMockExecutor("res2", 50), { speculative: true });
    
    const res = await Promise.all([p1, p2]);
    assert.strictEqual(res[0].result, "res1");
    assert.strictEqual(res[1].result, "res2");
    assert.strictEqual(await engine.hasCache("img1", "hint1"), true);
    assert.strictEqual(await engine.hasCache("img2", "hint2"), true);
    passed++;
  } catch(e) { console.error(e); failed++; }

  try {
    testHeader("Consumption clears only the specific cache");
    const engine5 = new AltTextAITaskOrchestrator();
    await engine5.execute("img1", "hint1", createMockExecutor("res1", 10));
    await engine5.execute("img2", "hint2", createMockExecutor("res2", 10));
    
    await engine5.consume("img1", "hint1");
    // img1 is cleared, img2 remains
    assert.strictEqual(await engine5.hasCache("img1", "hint1"), false);
    assert.strictEqual(await engine5.hasCache("img2", "hint2"), true);
    
    // Next request for img1 should be fresh
    const nextReq = await engine5.execute("img1", "hint1", createMockExecutor("res_new", 10));
    assert.strictEqual(nextReq.type, "fresh");
    assert.strictEqual(nextReq.result, "res_new");
    passed++;
  } catch(e) { console.error(e); failed++; }

  try {
    testHeader("File objects with different properties have distinct keys");
    const engine6 = new AltTextAITaskOrchestrator();
    
    // Mock File-like objects
    const file1 = { name: "image1.jpg", size: 1024, lastModified: 1000, constructor: { name: 'File' } };
    const file2 = { name: "image2.jpg", size: 2048, lastModified: 2000, constructor: { name: 'File' } };
    
    // Note: since I'm using plain objects for mock, I need to ensure _getKey handles them.
    // In my implementation: 
    // } else if (image instanceof File || image instanceof Blob) {
    //   imageStr = `${image.name || 'blob'}-${image.size}-${image.lastModified || ''}`;
    // } 
    // If I use plain objects, they won't be instanceof File.
    // Let's create actual Blob/File if possible, or adjust test to match implementation.
    
    const realFile1 = new Blob(["content1"], { type: "image/jpeg" });
    realFile1.name = "image1.jpg";
    realFile1.lastModified = 1000;
    
    const realFile2 = new Blob(["content2"], { type: "image/jpeg" });
    realFile2.name = "image2.jpg";
    realFile2.lastModified = 2000;
 
    await engine6.execute(realFile1, "hint", createMockExecutor("res1", 10));
    const result2 = await engine6.execute(realFile2, "hint", createMockExecutor("res2", 10));
    
    assert.strictEqual(result2.type, "fresh"); // Should NOT be adopted/cached from realFile1
    assert.strictEqual(await engine6.hasCache(realFile1, "hint"), true);
    assert.strictEqual(await engine6.hasCache(realFile2, "hint"), true);
    passed++;
  } catch(e) { console.error(e); failed++; }

  console.log(`\n============================`);
  console.log(`Tests Run: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`============================`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
