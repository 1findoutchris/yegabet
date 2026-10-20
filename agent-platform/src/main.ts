import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { join } from "node:path";
import { ConfigError, loadEnv } from "./config/env";
import { configureWeb } from "./web";

async function bootstrap(): Promise<void> {
  let env;
  try {
    env = loadEnv(process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    // Octhera signs the exact bytes it sends; the wallet checks them (plan 07).
    rawBody: true,
  });
  // Railway's proxy sets X-Forwarded-For; trust it so req.ip is the caller (rate limits, audit).
  app.set("trust proxy", 1);
  app.useLogger(app.get(Logger));
  // The web app, built into web/dist next to dist/ (Dockerfile).
  configureWeb(app, join(__dirname, "..", "web", "dist"));
  app.enableShutdownHooks();
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
