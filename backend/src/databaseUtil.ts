import { generatePasswordHash, checkPasswordHash, bytesToHex, hexToBytes } from "./utils/format";
import type { ListUsersInput } from "./models/user";
import type { ListPostsInput } from "./models/post";

const rawArgs = process.argv.slice(2);
const printLogs = rawArgs.includes("--print-logs");
const args = rawArgs.filter((arg) => arg !== "--print-logs");

const logger = {
  info: (msg: any) => {
    if (printLogs) {
      console.error(`[INFO] ${msg}`);
    }
  },
  error: (msg: any) => {
    console.error(`[ERROR] ${msg}`);
  },
};

async function main() {
  if (args.length < 1) {
    console.log(`Usage:
  ts-node src/databaseUtil.ts hash <password> [hash]
  ts-node src/databaseUtil.ts user-list [offset limit order] [--print-logs]
  ts-node src/databaseUtil.ts post-list [offset limit order] [--print-logs]
`);
    process.exit(1);
  }

  if (!printLogs) {
    process.env.LOG_LEVEL = "error";
    process.env.PINO_LOG_LEVEL = "error";
  }

  const { connectPgWithRetry, connectRedisWithRetry } = await import("./utils/servers");
  const { UsersService } = await import("./services/users");
  const { PostsService } = await import("./services/posts");

  const command = args[0];
  switch (command) {
    case "hash": {
      const password = args.length > 1 ? args[1] : null;
      const hash = args.length > 2 ? args[2] : null;
      if (password && hash) {
        const array = hexToBytes(hash);
        if (array === null) {
          throw new Error("malformed hex text");
        }
        if (await checkPasswordHash(password, array)) {
          console.log("ok");
        } else {
          throw new Error("mismatch");
        }
      } else if (password) {
        const hex = bytesToHex(await generatePasswordHash(password));
        console.log(hex);
      } else {
        throw new Error("password is required");
      }
      break;
    }
    case "user-list": {
      const pgClient = await connectPgWithRetry();
      const redis = await connectRedisWithRetry();
      try {
        const usersService = new UsersService(pgClient, redis);
        const input: ListUsersInput = {
          offset: args.length > 1 ? parseInt(args[1]) : undefined,
          limit: args.length > 2 ? parseInt(args[2]) : undefined,
          order:
            args.length > 3
              ? args[3] === "asc"
                ? "asc"
                : args[3] === "desc"
                  ? "desc"
                  : args[3] === "social"
                    ? "social"
                    : undefined
              : undefined,
        };
        const users = await usersService.listUsers(input);
        console.log(JSON.stringify(users, null, 2));
      } finally {
        await redis.quit();
        await pgClient.end();
        logger.info("disconnected");
      }
      break;
    }
    case "post-list": {
      const pgClient = await connectPgWithRetry();
      const redis = await connectRedisWithRetry();
      try {
        const postsService = new PostsService(pgClient, redis);
        const input: ListPostsInput = {
          offset: args.length > 1 ? parseInt(args[1]) : undefined,
          limit: args.length > 2 ? parseInt(args[2]) : undefined,
          order:
            args.length > 3
              ? args[3] === "asc"
                ? "asc"
                : args[3] === "desc"
                  ? "desc"
                  : undefined
              : undefined,
        };
        const posts = await postsService.listPosts(input);
        console.log(JSON.stringify(posts, null, 2));
      } finally {
        await redis.quit();
        await pgClient.end();
        logger.info("disconnected");
      }
      break;
    }
    default: {
      throw new Error(`Unknown command: ${command}`);
    }
  }
}

main().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
