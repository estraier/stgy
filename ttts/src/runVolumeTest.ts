import { Command } from "commander";
import { SearchService, SearchConfig } from "./services/search";
import { Config } from "./config";
import path from "path";

const program = new Command();

interface PrepareOptions {
  documents: string;
  words: string;
  vocab: string;
  gamma: string;
  iteration: string;
  autoCommit?: string;
  baseDir?: string;
  duration?: string;
  recordPositions: string;
}

interface SearchOptions {
  query?: string;
  limit: string;
  times: string;
}

function generateDocument(wordCount: number, vocabSize: number, gamma: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const raw = Math.random();
    const corrected = Math.pow(raw, 1 / gamma);
    const index = Math.floor(corrected * vocabSize);
    words.push(`w${index}`);
  }
  return words.join(" ");
}

function logMemoryUsage(label: string): void {
  const used = process.memoryUsage().heapUsed / 1024 / 1024;
  console.log(`[Memory] ${label}: ${used.toFixed(2)} MB`);
}

async function runPrepare(opts: PrepareOptions): Promise<void> {
  const baseSearchConfig = Config.resources[0].search;
  const config: SearchConfig = {
    ...baseSearchConfig,
    baseDir: opts.baseDir ? path.resolve(opts.baseDir) : baseSearchConfig.baseDir,
    bucketDurationSeconds: opts.duration
      ? parseInt(opts.duration, 10)
      : baseSearchConfig.bucketDurationSeconds,
    autoCommitUpdateCount: opts.autoCommit
      ? parseInt(opts.autoCommit, 10)
      : baseSearchConfig.autoCommitUpdateCount,
    recordPositions: opts.recordPositions === "true",
  };

  const service = new SearchService(config);
  await service.open();

  console.log("Cleaning up existing index files...");
  const existingFiles = await service.listFiles();
  for (const file of existingFiles) {
    await service.removeFile(file.startTimestamp);
  }
  console.log(`Cleaned up ${existingFiles.length} files.`);

  const iterations = parseInt(opts.iteration, 10);
  const docCountPerIter = parseInt(opts.documents, 10);
  const wordCount = parseInt(opts.words, 10);
  const vocabSize = parseInt(opts.vocab, 10);
  const gamma = parseFloat(opts.gamma);

  console.log("=== Volume Test Prepare Start ===");
  console.log(`Base Directory: ${config.baseDir}`);
  console.log(
    `Vocab Size    : ${vocabSize}, Gamma: ${gamma}, Auto-Commit: ${config.autoCommitUpdateCount}`,
  );
  logMemoryUsage("At Start");

  const startTimeAll = Date.now();
  let currentSimulatedTime = Math.floor(Date.now() / 1000);

  for (let iter = 1; iter <= iterations; iter++) {
    console.log(`\n--- Iteration ${iter}/${iterations} ---`);
    const iterStartTime = Date.now();

    const bucketTs =
      Math.floor(currentSimulatedTime / config.bucketDurationSeconds) *
      config.bucketDurationSeconds;
    const initialFiles = await service.listFiles();
    const initialShard = initialFiles.find((f) => f.startTimestamp === bucketTs);
    const initialCount = initialShard ? initialShard.countDocuments : 0;

    for (let i = 0; i < docCountPerIter; i++) {
      const docId = `iter${iter}-doc${i}`;
      const body = generateDocument(wordCount, vocabSize, gamma);
      if (i === 0) console.log(`Sample: ${body.substring(0, 100)}...`);
      await service.addDocument(docId, currentSimulatedTime, body, "en");
    }

    process.stdout.write("  Flushing buffer to disk... ");
    await service.flushAll();
    console.log("Done.");

    while (true) {
      const files = await service.listFiles();
      const latest = files.find((f) => f.startTimestamp === bucketTs);
      const currentCount = latest ? latest.countDocuments : 0;
      const incrementalCount = currentCount - initialCount;

      if (incrementalCount >= docCountPerIter) {
        process.stdout.write(`\r  Indexing... [${incrementalCount}/${docCountPerIter}] Done.\n`);
        break;
      }
      process.stdout.write(`\r  Indexing... [${incrementalCount}/${docCountPerIter}] `);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`Iteration ${iter} took ${((Date.now() - iterStartTime) / 1000).toFixed(2)}s`);
    const filesAfter = await service.listFiles();
    const currentShard = filesAfter.find((f) => f.startTimestamp === bucketTs);
    if (currentShard) {
      console.log(
        `Latest Shard Info: File: ${currentShard.filename}, Docs: ${currentShard.countDocuments}, Size: ${(currentShard.fileSize / 1024).toFixed(1)} KB`,
      );
    }
    logMemoryUsage(`After Iteration ${iter}`);
    currentSimulatedTime += config.bucketDurationSeconds;
  }

  const totalElapsed = (Date.now() - startTimeAll) / 1000;
  const finalFiles = await service.listFiles();
  const totalSize = finalFiles.reduce((acc, f) => acc + f.fileSize, 0);
  const totalDocs = finalFiles.reduce((acc, f) => acc + f.countDocuments, 0);

  console.log("\n=== Final Results ===");
  console.log(
    `Total Time: ${totalElapsed.toFixed(2)}s, Docs: ${totalDocs}, Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`,
  );

  await service.close();
  process.exit(0);
}

async function runSearch(opts: SearchOptions): Promise<void> {
  const baseSearchConfig = Config.resources[0].search;
  const service = new SearchService(baseSearchConfig);
  await service.open();

  const query = opts.query || "w0";
  const times = parseInt(opts.times, 10);
  const limit = parseInt(opts.limit, 10) === 0 ? 1000000 : parseInt(opts.limit, 10);

  console.log(`=== Search Benchmark: "${query}" ===`);
  console.log(`Limit: ${opts.limit === "0" ? "Unlimited (Count mode)" : limit}, Trials: ${times}`);

  const files = await service.listFiles();
  console.log(`Searching across ${files.length} shards...`);

  const results: number[] = [];
  let lastHitCount = 0;

  for (let i = 0; i < times; i++) {
    const start = process.hrtime.bigint();
    const hitIds = await service.search(query, "en", limit);
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1000000;
    results.push(elapsedMs);
    lastHitCount = hitIds.length;

    if (i === 0) {
      console.log(`First run (Cold): ${elapsedMs.toFixed(3)}ms (Hits: ${lastHitCount})`);
    }
  }

  const avgWarm =
    results.length > 1
      ? results.slice(1).reduce((a, b) => a + b, 0) / (results.length - 1)
      : results[0];

  console.log(`------------------------------`);
  console.log(`Total Hits        : ${lastHitCount}`);
  console.log(`Warm Cache (Avg) : ${avgWarm.toFixed(3)}ms`);
  console.log(`Throughput        : ${(1000 / avgWarm).toFixed(1)} QPS`);

  await service.close();
  process.exit(0);
}

program
  .name("volume-test")
  .command("prepare")
  .option("--documents <number>", "Docs per iteration", "100000")
  .option("--words <number>", "Words per doc", "200")
  .option("--vocab <number>", "Vocabulary size", "10000")
  .option("--gamma <number>", "Gamma", "0.3")
  .option("--iteration <number>", "Iterations", "2")
  .option("--auto-commit <number>", "Auto commit count")
  .option("--base-dir <path>", "Directory path")
  .option("--duration <number>", "Bucket duration seconds")
  .option("--record-positions <string>", "Record positions", "false")
  .action((opts: PrepareOptions) => runPrepare(opts));

program
  .command("search")
  .option("--query <string>", "Search query", "w0")
  .option("--limit <number>", "Limit per search (0 for unlimited)", "100")
  .option("--times <number>", "Number of trials", "10")
  .action((opts: SearchOptions) => runSearch(opts));

program.parse(process.argv);
