import { Command } from "commander";
import { SearchService, SearchConfig } from "./services/search";
import { Config } from "./config";
import { createLogger } from "./utils/logger";
import path from "path";
import fs from "fs/promises";

const program = new Command();
const logger = createLogger({ file: "volume-test" });

// Protectedメソッドを公開するための継承クラス
class VolumeTestSearchService extends SearchService {
  public async addDocumentDirect(
    docId: string,
    timestamp: number,
    bodyText: string,
    locale: string,
    attrs: string | null = null,
  ) {
    if (this.workerRunning) {
      throw new Error("Worker must be stopped to use direct access!");
    }
    await this.addDocument(docId, timestamp, bodyText, locale, attrs);
  }

  public async optimizeAll() {
    const files = await this.listIndexFiles();
    for (const file of files) {
      await this.optimizeShard(file.startTimestamp);
    }
  }

  public async synchronizeAll() {
    await this.synchronizeAllShards();
  }

  public async removeIndexFileDirect(timestamp: number) {
    // 内部状態（Shards Map）のクリーンアップと物理削除を行う
    await this.removeIndexFile(timestamp);
  }
}

interface PrepareOptions {
  documents: string;
  words: string;
  vocab: string;
  gamma: string;
  iteration: string;
  autoCommit?: string;
  baseDir?: string;
  recordPositions: string;
  recordContents: string;
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
  const baseSearchConfig = Config.resources[0];

  const flushInterval = opts.autoCommit
    ? parseInt(opts.autoCommit, 10)
    : baseSearchConfig.autoCommitUpdateCount;

  const config: SearchConfig = {
    ...baseSearchConfig,
    baseDir: opts.baseDir ? path.resolve(opts.baseDir) : baseSearchConfig.baseDir,
    autoCommitUpdateCount: Number.MAX_SAFE_INTEGER,
    recordPositions: opts.recordPositions === "true",
    recordContents: opts.recordContents !== "false",
  };

  const service = new VolumeTestSearchService(config, logger);

  // Workerを起動せずにオープン（全シャードがメモリにロードされる）
  await service.open({ startWorker: false });

  console.log("Cleaning up existing index files...");

  // 既存ファイルを1つずつ丁寧に削除（DB接続を閉じてからファイル削除）
  const existingFiles = await service.listIndexFiles(false);
  for (const file of existingFiles) {
    await service.removeIndexFileDirect(file.startTimestamp);
  }
  console.log(`Cleaned up ${existingFiles.length} files.`);

  // 念のためディレクトリ自体のクリーンアップと再作成（ゴミファイル除去）
  await service.close();
  await fs.rm(config.baseDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(config.baseDir, { recursive: true });

  // 再オープン
  await service.open({ startWorker: false });

  const iterations = parseInt(opts.iteration, 10);
  const docCountPerIter = parseInt(opts.documents, 10);
  const wordCount = parseInt(opts.words, 10);
  const vocabSize = parseInt(opts.vocab, 10);
  const gamma = parseFloat(opts.gamma);

  console.log("=== Volume Test Prepare Start ===");
  console.log(`Base Directory: ${config.baseDir}`);
  console.log(`Vocab Size    : ${vocabSize}, Gamma: ${gamma}, Flush Interval: ${flushInterval}`);
  console.log(`Positions     : ${config.recordPositions}, Contents: ${config.recordContents}`);
  logMemoryUsage("At Start");

  const startTimeAll = Date.now();
  let currentSimulatedTime = Math.floor(Date.now() / 1000);
  let totalGeneratedSize = 0;

  for (let iter = 1; iter <= iterations; iter++) {
    console.log(`\n--- Iteration ${iter}/${iterations} ---`);
    const iterStartTime = Date.now();

    const bucketTs =
      Math.floor(currentSimulatedTime / config.bucketDurationSeconds) *
      config.bucketDurationSeconds;

    for (let i = 0; i < docCountPerIter; i++) {
      const docId = `iter${iter}-doc${i}`;
      const body = generateDocument(wordCount, vocabSize, gamma);
      totalGeneratedSize += Buffer.byteLength(body);

      if (i === 0) console.log(`  Sample: ${body.substring(0, 100)}...`);

      await service.addDocumentDirect(docId, currentSimulatedTime, body, "en");

      if ((i + 1) % flushInterval === 0) {
        await service.synchronizeAll();
        process.stdout.write(`\r  Progress: [${i + 1}/${docCountPerIter}] Flushed.`);
      }
    }

    await service.synchronizeAll();
    process.stdout.write(`\r  Progress: [${docCountPerIter}/${docCountPerIter}] Done.   \n`);

    console.log(`Iteration ${iter} took ${((Date.now() - iterStartTime) / 1000).toFixed(2)}s`);

    const filesAfter = await service.listIndexFiles(true);
    const currentShard = filesAfter.find((f) => f.startTimestamp === bucketTs);
    if (currentShard) {
      const fileMB = (currentShard.fileSize / 1024 / 1024).toFixed(2);
      const walMB = (currentShard.walSize / 1024 / 1024).toFixed(2);
      const totalDbMB = (currentShard.totalDatabaseSize / 1024 / 1024).toFixed(2);
      const indexMB = (currentShard.indexSize / 1024 / 1024).toFixed(2);
      const cntMB = (currentShard.contentSize / 1024 / 1024).toFixed(2);

      console.log(
        `Latest Shard Info: Docs: ${currentShard.countDocuments}` +
          `\n    - Physical File: ${fileMB} MB (WAL: ${walMB} MB)` +
          `\n    - Logical DB   : ${totalDbMB} MB` +
          `\n    - Index (FTS)  : ${indexMB} MB` +
          `\n    - Content      : ${cntMB} MB`,
      );
    }
    logMemoryUsage(`After Iteration ${iter}`);

    currentSimulatedTime += config.bucketDurationSeconds;
  }

  const totalElapsed = (Date.now() - startTimeAll) / 1000;

  console.log("\nOptimizing all shards...");
  await service.optimizeAll();

  const finalFiles = await service.listIndexFiles(true);
  const totalDocs = finalFiles.reduce((acc, f) => acc + f.countDocuments, 0);
  const totalIndex = finalFiles.reduce((acc, f) => acc + f.indexSize, 0);
  const totalContent = finalFiles.reduce((acc, f) => acc + f.contentSize, 0);

  await service.close();

  let finalDiskUsage = 0;
  const dirFiles = await fs.readdir(config.baseDir);
  for (const file of dirFiles) {
    if (
      file.startsWith(config.namePrefix) &&
      (file.endsWith(".db") || file.endsWith("-wal") || file.endsWith("-shm"))
    ) {
      const stats = await fs.stat(path.join(config.baseDir, file));
      finalDiskUsage += stats.size;
    }
  }

  console.log("\n=== Final Results ===");
  console.log(`Total Time : ${totalElapsed.toFixed(2)}s`);
  console.log(`Total Docs : ${totalDocs}`);
  console.log(
    `Total Text : ${(totalGeneratedSize / 1024 / 1024).toFixed(2)} MB (Generated raw text)`,
  );
  console.log(`Total Index: ${(totalIndex / 1024 / 1024).toFixed(2)} MB (Logical)`);
  console.log(`Total Body : ${(totalContent / 1024 / 1024).toFixed(2)} MB (Logical)`);
  console.log(
    `Final Disk : ${(finalDiskUsage / 1024 / 1024).toFixed(2)} MB (Physical after close)`,
  );

  process.exit(0);
}

async function runSearch(opts: SearchOptions): Promise<void> {
  const baseSearchConfig = Config.resources[0];
  const service = new SearchService(baseSearchConfig, logger);
  await service.open({ startWorker: false });

  const query = opts.query || "w0";
  const times = parseInt(opts.times, 10);
  const limit = parseInt(opts.limit, 10) === 0 ? 1000000 : parseInt(opts.limit, 10);

  console.log(`=== Search Benchmark: "${query}" ===`);
  console.log(`Limit: ${opts.limit === "0" ? "Unlimited (Count mode)" : limit}, Trials: ${times}`);

  const files = await service.listIndexFiles(false);
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
  .option("--auto-commit <number>", "Flush interval (docs)", "10000")
  .option("--base-dir <path>", "Directory path")
  .option("--record-positions <string>", "Record positions", "false")
  .option("--record-contents <string>", "Record contents", "true")
  .action((opts: PrepareOptions) => runPrepare(opts));

program
  .command("search")
  .option("--query <string>", "Search query", "w0")
  .option("--limit <number>", "Limit per search (0 for unlimited)", "100")
  .option("--times <number>", "Number of trials", "100")
  .action((opts: SearchOptions) => runSearch(opts));

program.parse(process.argv);
