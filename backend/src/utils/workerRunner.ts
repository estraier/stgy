import { Logger } from "pino";

export class WorkerLifecycle {
  private active = true;

  get isActive(): boolean {
    return this.active;
  }

  stop(): void {
    this.active = false;
  }

  setupStandaloneShutdown(
    logger: Logger,
    cleanup?: () => Promise<void> | void
  ): void {
    const onSignal = async (signal: string) => {
      if (!this.active) return;
      this.active = false;
      logger.info(`Received ${signal}, shutting down...`);

      if (cleanup) {
        try {
          await cleanup();
        } catch (e) {
          logger.error(`Cleanup error: ${e}`);
        }
      }

      process.exit(0);
    };

    process.on("SIGINT", () => onSignal("SIGINT"));
    process.on("SIGTERM", () => onSignal("SIGTERM"));
  }
}

export function runIfMain(
  currentModule: NodeModule,
  fn: () => Promise<void>,
  logger: Logger,
  lifecycle: WorkerLifecycle,
  cleanup?: () => Promise<void> | void
) {
  if (require.main === currentModule) {
    lifecycle.setupStandaloneShutdown(logger, cleanup);
    fn().catch((e) => {
      logger.error(`Fatal error: ${e}`);
      process.exit(1);
    });
  }
}
