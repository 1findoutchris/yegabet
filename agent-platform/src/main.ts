import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { ConfigError, loadEnv } from "./config/env";

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

  const app = await NestFactory.create(AppModule.forRoot(env), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
