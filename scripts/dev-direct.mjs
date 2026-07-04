import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { startServer } = require("next/dist/server/lib/start-server");

process.env.NODE_ENV ||= "development";
process.env.__NEXT_DEV_SERVER ||= "1";
process.env.NEXT_PRIVATE_START_TIME = Date.now().toString();

if (process.env.NEXT_DEV_BUNDLER === "turbopack") {
  process.env.TURBOPACK ||= "1";
} else {
  delete process.env.TURBOPACK;
}

await startServer({
  dir: path.resolve("."),
  port: Number(process.env.PORT || 3000),
  allowRetry: false,
  isDev: true,
  hostname: process.env.HOSTNAME || "localhost",
});
